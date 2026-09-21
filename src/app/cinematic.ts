/**
 * Hitstop and slow-motion, as a transform on wall-clock time (#33).
 *
 * §17.2 reserves both for reactions, boss deaths and tier-5 unlocks: *"a boss
 * killed is 400ms hitstop, slow-motion to 0.25x for 1s"*. The reservation is
 * the design's own — overused, hitstop becomes mush — so this makes a moment
 * expensive to ask for and impossible to ask for twice at once.
 *
 * **It changes when ticks run, never which ticks run.** The simulation advances
 * in whole fixed steps whatever this does, so a stage played through a boss
 * death reaches byte-identical state to one played without: the same ticks
 * happen, spread over more frames. That is the only way a cinematic can exist
 * at all in a game whose replays and balance runs must reproduce.
 *
 * Pure arithmetic over a clock it is handed, like `FixedStepLoop`, so it is
 * testable without faking timers and lives outside the simulation entirely.
 */

/** Time multiplier while the world is held still. */
const HITSTOP_SCALE = 0;

export interface CinematicOptions {
  /** How long the world holds completely still. */
  hitstopMs?: number;
  /** How long it runs slowly afterwards, and how slowly. */
  slowMotionMs?: number;
  slowMotionScale?: number;
}

export class Cinematic {
  private readonly hitstopMs: number;
  private readonly slowMotionMs: number;
  private readonly slowMotionScale: number;

  /** Wall-clock time the current moment began, or -1 when none is running. */
  private startedAt = -1;

  constructor(options: CinematicOptions = {}) {
    this.hitstopMs = options.hitstopMs ?? 400;
    this.slowMotionMs = options.slowMotionMs ?? 1000;
    this.slowMotionScale = options.slowMotionScale ?? 0.25;
  }

  /**
   * Starts a moment, or restarts one already running.
   *
   * Restarting rather than queueing: two bosses dying in the same frame is one
   * moment, not eight hundred milliseconds of hitstop.
   */
  trigger(nowMs: number): void {
    this.startedAt = nowMs;
  }

  get active(): boolean {
    return this.startedAt >= 0;
  }

  /**
   * How fast time should run at this instant, 0 through 1.
   *
   * Retires the moment once it is over, so `active` is the honest answer to
   * "is anything happening" without a second call to advance it.
   */
  scaleAt(nowMs: number): number {
    if (this.startedAt < 0) return 1;

    const elapsed = nowMs - this.startedAt;
    /* A clock that went backwards — a paused tab, a reset — ends the moment
       rather than holding the world still until it catches up. */
    if (elapsed < 0) {
      this.startedAt = -1;
      return 1;
    }
    if (elapsed < this.hitstopMs) return HITSTOP_SCALE;
    if (elapsed < this.hitstopMs + this.slowMotionMs) return this.slowMotionScale;

    this.startedAt = -1;
    return 1;
  }

  reset(): void {
    this.startedAt = -1;
  }
}
