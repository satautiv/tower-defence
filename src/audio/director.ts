import { SimEventKind } from '@sim/index';
import type { World } from '@sim/index';
import {
  BOSS_STINGERS,
  StingerThrottle,
  detuneFor,
  stingerFor,
  stingerSeconds,
} from './stingers.js';
import type { StingerRecipe } from './stingers.js';

/**
 * The part that makes a noise.
 *
 * A deliberately small slice of #44: reaction stingers and nothing else. No
 * adaptive music, no damage-type sounds, no voice, no Howler — the mixer and
 * sampled assets arrive with that issue. What exists here is the one channel
 * the reaction gate cannot run without, built on the Web Audio API the browser
 * already provides so that nothing is added to the dependency list ahead of the
 * issue that needs it.
 *
 * Everything decidable without a speaker lives in `stingers.ts` and is tested
 * there. This file owns the context, the autoplay unlock and the plumbing.
 */

/** Noise burst length. Long enough for any stinger to draw from. */
const NOISE_SECONDS = 1;

export interface AudioOptions {
  /** Replaced in tests; the browser's constructor by default. */
  createContext?: () => AudioContext;
}

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly throttle = new StingerThrottle();
  private readonly createContext: () => AudioContext;
  private plays = 0;
  private volume = 1;
  private muted = false;
  private failed = false;

  constructor(options: AudioOptions = {}) {
    this.createContext =
      options.createContext ?? (() => new (window.AudioContext ?? window.AudioContext)());
  }

  /** True once there is a context able to make a sound. */
  get ready(): boolean {
    return this.context !== null && !this.failed;
  }

  get suppressedCount(): number {
    return this.throttle.suppressedCount;
  }

  /**
   * Creates the context, or resumes one the browser suspended.
   *
   * Must be called from a real user gesture. Every mobile browser and most
   * desktop ones refuse to start audio otherwise, and a context created too
   * early is born suspended and stays that way — which presents as a game with
   * no sound and no error anywhere.
   */
  unlock(): void {
    if (this.failed) return;
    try {
      this.context ??= this.createContext();
      if (this.master === null) {
        this.master = this.context.createGain();
        this.master.gain.value = this.effectiveVolume();
        this.master.connect(this.context.destination);
        this.noise = this.makeNoise(this.context);
      }
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      /* A browser that cannot give us audio is not a browser that cannot run
         the game. Give up once, quietly, and never try again. */
      this.failed = true;
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  private effectiveVolume(): number {
    return this.muted ? 0 : this.volume;
  }

  private applyVolume(): void {
    if (this.master !== null) this.master.gain.value = this.effectiveVolume();
  }

  /**
   * Drains this frame's events and sounds what they deserve.
   *
   * One of several consumers, so it must not clear the buffer. Silent before
   * the first gesture unlocks the context, which is the browser's rule rather
   * than ours.
   */
  consume(world: World, nowMs: number): void {
    if (!this.ready || this.muted) return;
    const table = world.rules.reactions;

    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);

      /* A boss phase turning over, through the same throttle as everything
         else so a transition during a busy frame cannot stack on itself. */
      if (event.kind === SimEventKind.BossPhaseChanged) {
        const recipe = BOSS_STINGERS.phase;
        if (this.throttle.admit('boss_phase', nowMs, stingerSeconds(recipe))) this.play(recipe);
        continue;
      }

      if (event.kind === SimEventKind.EnemyDied && event.e === 1) {
        const recipe = BOSS_STINGERS.defeat;
        if (this.throttle.admit('boss_defeat', nowMs, stingerSeconds(recipe))) this.play(recipe);
        continue;
      }

      if (event.kind !== SimEventKind.ReactionTriggered) continue;

      const id = table.ids[event.a] ?? 'unknown';
      const recipe = stingerFor(id);
      if (!this.throttle.admit(id, nowMs, stingerSeconds(recipe))) continue;
      this.play(recipe);
    }
  }

  /**
   * One stinger: a pitch sweep with a noise bed under it.
   *
   * Nodes are created per sound rather than pooled. Web Audio source nodes are
   * single-use by specification — they cannot be restarted — and the browser
   * collects them when they finish, so this is the intended shape rather than
   * an allocation to feel guilty about. It also happens outside the tick loop.
   */
  private play(recipe: StingerRecipe): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) return;

    const at = context.currentTime;
    const end = at + stingerSeconds(recipe);
    const detune = detuneFor(this.plays++);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.linearRampToValueAtTime(recipe.gain, at + recipe.attack);
    /* Exponential, because a linear fade to silence is heard as a click. */
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    envelope.connect(master);

    const tone = context.createOscillator();
    tone.type = recipe.wave;
    tone.detune.value = detune;
    tone.frequency.setValueAtTime(recipe.fromHz, at);
    tone.frequency.exponentialRampToValueAtTime(Math.max(20, recipe.toHz), end);
    tone.connect(envelope);
    tone.start(at);
    tone.stop(end);

    if (recipe.noise <= 0 || this.noise === null) return;

    const bed = context.createBufferSource();
    bed.buffer = this.noise;
    const bedGain = context.createGain();
    bedGain.gain.setValueAtTime(recipe.gain * recipe.noise, at);
    bedGain.gain.exponentialRampToValueAtTime(0.0001, end);
    bed.connect(bedGain);
    bedGain.connect(master);
    bed.start(at);
    bed.stop(end);
  }

  /**
   * A second of white noise, generated once and shared.
   *
   * Deterministic rather than `Math.random`: two runs of the same replay should
   * not differ, even in something nobody can consciously hear.
   */
  private makeNoise(context: AudioContext): AudioBuffer {
    const frames = Math.floor(context.sampleRate * NOISE_SECONDS);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);

    let seed = 0x9e3779b1;
    for (let i = 0; i < frames; i++) {
      seed = (Math.imul(seed, 0x6c8e9cf5) + 0x2545f491) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  /** Between stages: forget what was recently played, keep the context. */
  reset(): void {
    this.throttle.reset();
    this.plays = 0;
  }

  destroy(): void {
    this.throttle.reset();
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.noise = null;
  }
}
