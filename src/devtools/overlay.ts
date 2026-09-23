import { ReplayRecorder } from '@sim/index';
import type { Replay, ReplayHeader, World } from '@sim/index';
import type { Layers } from '@view/layers';
import { DamageWatcher, EMPTY_LOG } from './damageLog.js';
import type { DamageLog } from './damageLog.js';
import { DebugView, NO_TOGGLES } from './debugDraw.js';
import type { DebugToggles } from './debugDraw.js';
import { freshPeaks, readDevStats, sampleCommands, samplePeaks } from './stats.js';
import type { BufferPeaks, DevStats } from './stats.js';
import { SplitTimer } from './timing.js';
import type { SplitStats } from './timing.js';

/**
 * The dev overlay's brain (#41): everything it measures, holds and can do.
 *
 * The acceptance criterion that shaped this file is **"zero measurable
 * overhead when hidden"**, and it is met by one rule applied without exception:
 * every per-frame hook tests `visible` as its first statement and returns.
 * Hidden, the overlay reads no clock, touches no world and allocates nothing —
 * which is a stronger claim than "it is fast", and one a test can make
 * deterministically rather than by timing something.
 *
 * That is why the timing calls take no arguments the caller had to compute.
 * `endSim()` stamps its own `performance.now()` *after* the guard, so a hidden
 * overlay does not pay for the reading it would throw away. The stage screen's
 * three call sites are a null check and a method call each.
 *
 * State lives here rather than in a store, and the panel reads it through
 * `useSyncExternalStore`. Two copies of "is the grid on" is one copy too many,
 * and the frame path must not go through a selector to find out.
 */

export interface DevState {
  readonly visible: boolean;
  readonly toggles: DebugToggles;
  /** 0.1x to 10x. Scales the clock the session is driven by, never a tick. */
  readonly timeScale: number;
  readonly recording: boolean;
  /** Entity id of the enemy the damage log is following, or -1. */
  readonly watching: number;
  /** True once a cheat has fired: a recording from here on is not a replay. */
  readonly cheated: boolean;
}

export const TIME_SCALES = [0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

export class StageDevtools {
  private visible = false;
  private toggles: DebugToggles = { ...NO_TOGGLES };
  private timeScale = 1;
  private cheated = false;

  private readonly timer = new SplitTimer();
  private readonly peaks: BufferPeaks = freshPeaks();
  private readonly watcher = new DamageWatcher();
  private readonly recorder = new ReplayRecorder();
  private recording = false;

  private debug: DebugView | null = null;
  /** Set when the toggles change while hidden, so the layer is cleared once. */
  private debugStale = false;

  private listeners = new Set<() => void>();
  private snapshot: DevState = this.buildState();

  /* The virtual clock the time scale rides on. Accumulated rather than derived
     from the real one, which is what makes leaving slow motion safe: a clock
     that snapped back to real time would hand the loop the second it had spent
     running at a tenth speed, and burst every tick of it into one frame. */
  private virtualNow = 0;
  private lastReal = -1;
  private tickAtFrameStart = 0;

  /** The renderer's layer stack, once the stage screen has built one. */
  attachView(layers: Layers): void {
    this.debug?.destroy();
    this.debug = new DebugView(layers);
  }

  detachView(): void {
    this.debug?.destroy();
    this.debug = null;
  }

  // ---- per-frame hooks -------------------------------------------------
  // Each one guards on `visible` first. That guard is the acceptance criterion.

  /**
   * The clock the session should be advanced to.
   *
   * Real elapsed time multiplied by the scale, accumulated — exactly the
   * bargain `Cinematic` already makes for hitstop, and for the same reason.
   * The simulation is not told: the same ticks run in the same order, spread
   * over more frames or crammed into fewer, so a stage played at a tenth speed
   * still hashes identically to one played at full speed.
   *
   * At 1x this tracks real time to within floating-point addition, so the
   * overlay existing cannot move the game's clock.
   */
  beginFrame(realNow: number, world: World): number {
    if (this.visible) {
      this.tickAtFrameStart = world.tick;
      this.timer.begin(realNow);
    }

    if (this.lastReal < 0) {
      this.lastReal = realNow;
      this.virtualNow = realNow;
      return realNow;
    }

    const elapsed = Math.max(0, realNow - this.lastReal);
    this.lastReal = realNow;
    this.virtualNow += elapsed * this.timeScale;
    return this.virtualNow;
  }

  /**
   * The loop's pre-tick hook, which is the one moment the tick's commands
   * exist: `drainCommandQueue` empties the queue at step 0.
   *
   * Both things that need that moment take it here — the replay recorder
   * because a command list is what a replay *is*, and the command-volume
   * reading because anything sampling later reads an empty queue.
   */
  beforeTick(world: World): void {
    if (this.recording) this.recorder.observe(world);
    if (!this.visible) return;
    sampleCommands(world, this.peaks);
  }

  /**
   * The boundary between simulating and drawing.
   *
   * Also where the per-frame buffers are sampled and the damage log fed: the
   * event buffer is cleared once every consumer has drained it, so anything
   * reading it off the frame reads an empty one.
   */
  endSim(world: World): void {
    if (!this.visible) return;
    this.timer.endSim(performance.now(), world.tick - this.tickAtFrameStart);
    samplePeaks(world, this.peaks);
    this.watcher.consume(world);
  }

  endFrame(world: World): void {
    if (!this.visible) {
      /* Hiding leaves the last frame's rings on the board; clear them once and
         then stop touching the renderer at all. */
      if (this.debugStale) {
        this.debugStale = false;
        this.debug?.render(world, NO_TOGGLES);
      }
      return;
    }
    /* Stamped before the debug pass, so the render figure is the game's
       rendering rather than the overlay's. */
    this.timer.end(performance.now());
    this.debug?.render(world, this.toggles);
    this.debugStale = true;
  }

  // ---- state -----------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable between changes, so `useSyncExternalStore` does not loop. */
  getState = (): DevState => this.snapshot;

  private buildState(): DevState {
    return {
      visible: this.visible,
      toggles: { ...this.toggles },
      timeScale: this.timeScale,
      recording: this.recording,
      watching: this.watcher.enemyId,
      cheated: this.cheated,
    };
  }

  private publish(): void {
    this.snapshot = this.buildState();
    for (const listener of this.listeners) listener();
  }

  toggleVisible(): void {
    this.visible = !this.visible;
    if (this.visible) this.timer.reset();
    this.publish();
  }

  setToggle(key: keyof DebugToggles, on: boolean): void {
    this.toggles = { ...this.toggles, [key]: on };
    this.publish();
  }

  setTimeScale(scale: number): void {
    this.timeScale = scale;
    this.publish();
  }

  /** Follows one enemy in the damage log. -1 stops following. */
  watch(enemyId: number): void {
    if (enemyId === this.watcher.enemyId) return;
    this.watcher.watch(enemyId);
    this.publish();
  }

  markCheated(): void {
    if (this.cheated) return;
    this.cheated = true;
    this.publish();
  }

  // ---- readings --------------------------------------------------------

  frameStats(): SplitStats {
    return this.timer.stats();
  }

  worldStats(world: World): DevStats {
    return readDevStats(world, this.peaks);
  }

  graph(sim: Float32Array, render: Float32Array): number {
    return this.timer.samples(sim, render);
  }

  damageLog(): DamageLog {
    return this.visible ? this.watcher.read() : EMPTY_LOG;
  }

  // ---- replay ----------------------------------------------------------

  startRecording(): void {
    this.recorder.reset();
    this.recording = true;
    this.publish();
  }

  /** Stops and returns the replay, or null when nothing was being recorded. */
  stopRecording(header: ReplayHeader, seed: number): Replay | null {
    if (!this.recording) return null;
    this.recording = false;
    this.publish();
    return this.recorder.finish(header, seed);
  }

  reset(): void {
    this.timer.reset();
    this.lastReal = -1;
    this.watcher.reset();
    this.recorder.reset();
    this.recording = false;
    this.peaks.events = 0;
    this.peaks.commands = 0;
    this.cheated = false;
    this.publish();
  }
}
