/**
 * The sound a reaction makes.
 *
 * Placeholder audio, synthesised rather than sampled — the same bargain
 * `art:placeholder` makes for sprites, and for the same reason: the design
 * needs the channel to exist long before anyone records anything. The full
 * audio system, with sampled stingers, adaptive music and a Howler mixer, is
 * still #44. This is the one bullet of it the reaction gate cannot run without:
 *
 * > **A unique, louder stinger per reaction** — the player should learn to
 * > recognise a Thermal Shock without looking.
 *
 * That "without looking" is the whole point. The first gate session was lost to
 * a tester who triggered a Thermal Shock while watching his gold: every channel
 * the game had was visual, and none of them reached him. Sound is the only one
 * that does not require the player to be looking at the right pixel.
 *
 * Nothing here touches an AudioContext. A recipe is data, the rate limiter is
 * arithmetic, and both are unit-tested; `director.ts` is the part that makes a
 * noise.
 */

/** How a stinger is built, in the small vocabulary an oscillator pair affords. */
export interface StingerRecipe {
  /** Where the pitch sweep starts and ends, in hertz. */
  fromHz: number;
  toHz: number;
  /** Oscillator shape. Carries most of the character. */
  wave: OscillatorType;
  /** Seconds from silence to full, and from full back to silence. */
  attack: number;
  decay: number;
  /** Peak gain before the master volume. Reactions are deliberately loud. */
  gain: number;
  /** Noise mixed under the tone, 0 to 1 — the crack, the hiss, the roar. */
  noise: number;
}

/**
 * One recipe per reaction, built to be told apart with eyes shut.
 *
 * They differ on every axis at once — direction of sweep, waveform, length and
 * noise — rather than on pitch alone, because a set of sounds distinguished
 * only by pitch is a set most people cannot distinguish.
 */
const RECIPES: Readonly<Record<string, StingerRecipe>> = {
  /* Fire meeting ice: a bright upward crack, short and glassy. */
  thermal_shock: {
    fromHz: 320,
    toHz: 1400,
    wave: 'triangle',
    attack: 0.004,
    decay: 0.34,
    gain: 0.5,
    noise: 0.35,
  },
  /* Metal going superconductive: a cold downward slide, almost pure. */
  superconduct: {
    fromHz: 900,
    toHz: 180,
    wave: 'sine',
    attack: 0.01,
    decay: 0.55,
    gain: 0.42,
    noise: 0.05,
  },
  /* Current through corroded flesh: a harsh buzz that barely moves. */
  electrolysis: {
    fromHz: 620,
    toHz: 520,
    wave: 'sawtooth',
    attack: 0.002,
    decay: 0.26,
    gain: 0.4,
    noise: 0.55,
  },
  /* Ignition: low, square, and mostly roar. */
  combustion: {
    fromHz: 150,
    toHz: 70,
    wave: 'square',
    attack: 0.006,
    decay: 0.48,
    gain: 0.46,
    noise: 0.7,
  },
  /* Something deepening rather than detonating: a soft rise, no grit. */
  amplify: { fromHz: 440, toHz: 700, wave: 'sine', attack: 0.02, decay: 0.3, gain: 0.3, noise: 0 },
};

const FALLBACK: StingerRecipe = {
  fromHz: 400,
  toHz: 800,
  wave: 'triangle',
  attack: 0.005,
  decay: 0.3,
  gain: 0.35,
  noise: 0.2,
};

/** A reaction with no recipe still makes a noise, rather than failing silently. */
export function stingerFor(reactionId: string): StingerRecipe {
  return RECIPES[reactionId] ?? FALLBACK;
}

export function stingerIds(): string[] {
  return Object.keys(RECIPES);
}

/** Total length of a stinger in seconds, attack through decay. */
export function stingerSeconds(recipe: StingerRecipe): number {
  return recipe.attack + recipe.decay;
}

/**
 * Shortest gap between two playings of the same sound, in milliseconds.
 *
 * #44's own requirement: forty enemies dying in one Thermal Shock must not
 * trigger forty death sounds. A chain reaction can resolve dozens of reactions
 * in a handful of ticks, and played unthrottled that is not a stinger, it is a
 * wall of noise that tells the player nothing.
 */
export const MIN_INTERVAL_MS = 90;

/** Most stingers allowed to overlap at once, across all reactions. */
export const MAX_CONCURRENT = 4;

/**
 * Decides what is allowed to play, and when.
 *
 * Pure arithmetic over a clock the caller supplies, so the throttling can be
 * tested exactly rather than by listening. Per-sound intervals keep one
 * reaction from machine-gunning; the concurrency cap keeps five different ones
 * from arriving at the same instant and clipping.
 */
export class StingerThrottle {
  private readonly lastPlayed = new Map<string, number>();
  /** Times at which currently sounding stingers will have finished. */
  private readonly busyUntil: number[] = [];
  private suppressed = 0;

  /** Stingers refused. Non-zero is normal in a chain, not a fault. */
  get suppressedCount(): number {
    return this.suppressed;
  }

  /**
   * Whether this sound may play now, recording it if so.
   *
   * `nowMs` comes from the caller rather than a clock read here, so a test can
   * step time precisely and the director can share one timestamp across every
   * event in a frame.
   */
  admit(id: string, nowMs: number, durationSeconds: number): boolean {
    const last = this.lastPlayed.get(id);
    if (last !== undefined && nowMs - last < MIN_INTERVAL_MS) {
      this.suppressed++;
      return false;
    }

    /* Retire anything that has finished before counting what is still going. */
    for (let i = this.busyUntil.length - 1; i >= 0; i--) {
      if ((this.busyUntil[i] as number) <= nowMs) this.busyUntil.splice(i, 1);
    }
    if (this.busyUntil.length >= MAX_CONCURRENT) {
      this.suppressed++;
      return false;
    }

    this.lastPlayed.set(id, nowMs);
    this.busyUntil.push(nowMs + durationSeconds * 1000);
    return true;
  }

  reset(): void {
    this.lastPlayed.clear();
    this.busyUntil.length = 0;
    this.suppressed = 0;
  }
}

/**
 * Pitch offset for a repeated sound, in semitone-ish cents.
 *
 * #44 asks for variation so a repeated sound does not read as a machine. Taken
 * from a counter rather than `Math.random`, so the same run sounds the same
 * twice — a replay that diverged in audio would be a replay nobody trusts.
 */
export function detuneFor(playCount: number): number {
  const steps = [0, 35, -30, 60, -55, 20];
  return steps[playCount % steps.length] as number;
}
