import { MAX_CATCHUP_STEPS, MAX_FRAME_DELTA_MS, TICK_MS } from './constants.js';

/**
 * Fixed-timestep accumulator.
 *
 * The simulation advances in whole ticks of a fixed length, never by however
 * long the last frame happened to take. Variable timesteps make physics and
 * damage-over-time depend on frame rate, which means a stage plays differently
 * on a phone than on a desktop, and a replay stops reproducing.
 *
 * This class owns no clock. `advance` is given the current time, so it is a
 * pure function of its inputs and can be tested without faking timers. The
 * caller reads the real clock — in the browser that is the timestamp that
 * requestAnimationFrame already provides.
 */

export interface Step {
  /** Simulation ticks to run before rendering this frame. */
  steps: number;
  /**
   * Fraction of a tick left over, 0..1. Render positions interpolated by this
   * amount, or a 60Hz simulation visibly stutters on a 120Hz display.
   */
  alpha: number;
  /** True if catch-up hit its cap and pending time was discarded. */
  clamped: boolean;
}

export interface LoopOptions {
  tickMs?: number;
  maxCatchupSteps?: number;
  maxFrameDeltaMs?: number;
}

export class FixedStepLoop {
  readonly tickMs: number;
  private readonly maxCatchupSteps: number;
  private readonly maxFrameDeltaMs: number;

  private accumulator = 0;
  private lastTime = 0;
  private started = false;
  private readonly result: Step = { steps: 0, alpha: 0, clamped: false };

  constructor(options: LoopOptions = {}) {
    this.tickMs = options.tickMs ?? TICK_MS;
    this.maxCatchupSteps = options.maxCatchupSteps ?? MAX_CATCHUP_STEPS;
    this.maxFrameDeltaMs = options.maxFrameDeltaMs ?? MAX_FRAME_DELTA_MS;
    if (this.tickMs <= 0) throw new RangeError('FixedStepLoop: tickMs must be positive');
  }

  /** Anchors the loop to a starting time and drops any pending time. */
  reset(nowMs: number): void {
    this.lastTime = nowMs;
    this.accumulator = 0;
    this.started = true;
  }

  /**
   * Advances to `nowMs` and reports how many ticks to run.
   *
   * `speed` multiplies the number of ticks, it does not stretch the tick. That
   * distinction is the whole reason 3x speed produces a bit-identical outcome
   * to 1x: every tick is the same length, there are simply more of them per
   * frame. Scaling delta time instead would change every per-tick calculation
   * and make fast-forward a different game.
   *
   * The returned object is reused between calls. Read it before calling again.
   */
  advance(nowMs: number, speed = 1): Step {
    if (!this.started) {
      this.reset(nowMs);
      this.result.steps = 0;
      this.result.alpha = 0;
      this.result.clamped = false;
      return this.result;
    }

    /* A backgrounded tab or a long stall would otherwise hand us minutes of
       pending time and freeze the game catching up. Discard the excess. */
    let delta = nowMs - this.lastTime;
    if (delta < 0) delta = 0;
    let clamped = false;
    if (delta > this.maxFrameDeltaMs) {
      delta = this.maxFrameDeltaMs;
      clamped = true;
    }
    this.lastTime = nowMs;
    this.accumulator += delta;

    const budget = this.maxCatchupSteps * speed;
    let steps = 0;
    while (this.accumulator >= this.tickMs && steps < budget) {
      this.accumulator -= this.tickMs;
      steps += speed;
    }

    /* Still behind after spending the whole budget: drop the backlog rather
       than carry it into the next frame, where it compounds. */
    if (this.accumulator >= this.tickMs) {
      this.accumulator = this.accumulator % this.tickMs;
      clamped = true;
    }

    this.result.steps = steps;
    this.result.alpha = this.accumulator / this.tickMs;
    this.result.clamped = clamped;
    return this.result;
  }

  /** Leftover fraction of a tick, for interpolation between frames. */
  get alpha(): number {
    return this.accumulator / this.tickMs;
  }
}
