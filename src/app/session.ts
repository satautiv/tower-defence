import { FixedStepLoop } from '@core/loop';
import { loadContent } from '@content/load';
import type { StageDefinition } from '@content/schema/stage';
import { createWorldForStage, tick } from '@sim/index';
import type { CommandQueue, StageResult, StagePhase, World } from '@sim/index';
import { stageResult } from '@sim/index';

/**
 * Drives one stage.
 *
 * Owns the world and the clock and nothing else. The renderer reads the world,
 * the interface dispatches commands into it, and neither can advance time —
 * which keeps "what is the state" and "when does it change" in one place.
 *
 * Speed multiplies the number of ticks per frame rather than the length of a
 * tick, so a stage played at 3x reaches an identical state to one played at 1x.
 */
export class GameSession {
  readonly world: World;
  private readonly loop = new FixedStepLoop();
  private paused = false;

  constructor(stage: StageDefinition, seed: number) {
    this.world = createWorldForStage(loadContent(), stage, seed);
  }

  static forStage(stageId: string, seed = Date.now() & 0x7fffffff): GameSession | null {
    const stage = loadContent().stages.get(stageId);
    return stage === undefined ? null : new GameSession(stage, seed);
  }

  /** Anchors the clock. Called once the first frame's timestamp is known. */
  start(nowMs: number): void {
    this.loop.reset(nowMs);
  }

  /**
   * Advances to the current time and returns the interpolation alpha for
   * rendering between ticks.
   */
  update(nowMs: number): number {
    if (this.paused || this.world.finished) {
      /* Keep the clock anchored, or resuming would hand the loop a delta the
         size of however long the player spent in the pause menu. */
      this.loop.reset(nowMs);
      return this.loop.alpha;
    }

    const step = this.loop.advance(nowMs, this.world.speed);
    for (let i = 0; i < step.steps; i++) tick(this.world);
    return step.alpha;
  }

  /**
   * Queues player intent.
   *
   * The only route from the interface into the simulation. Commands apply at
   * the next tick boundary, never mid-pipeline.
   */
  dispatch(issue: (queue: CommandQueue) => void): void {
    issue(this.world.commands);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get phase(): StagePhase {
    return this.world.phase;
  }

  result(): StageResult {
    return stageResult(this.world);
  }

  restart(): void {
    this.world.reset();
    this.paused = false;
  }
}
