import { FixedStepLoop } from '@core/loop';
import { loadContent } from '@content/load';
import type { StageDefinition } from '@content/schema/stage';
import { createWorldForStage, tick } from '@sim/index';
import type { CommandQueue, StageResult, StagePhase, World } from '@sim/index';
import { stageResult } from '@sim/index';
import type { RulesetOptions } from '@sim/index';
import { useSettings } from '@ui/settings';

/**
 * The hero this stage may take, if any.
 *
 * Gated by the stage it unlocks at (§11: "unlocked at stage 1-5, after
 * fundamentals are taught"). Compared as region and index rather than as a
 * string, so "1-10" comes after "1-5" instead of before it — which string
 * comparison would get exactly wrong.
 *
 * Kaelen carries no gate yet, so it deploys from the first stage. That is not
 * an oversight: content ids are generated into union types, so authoring
 * `unlockedByStage: "1-5"` is a compile error until #36 creates stage 1-5 —
 * the codegen refusing a reference to a stage that does not exist. It becomes
 * one line of content the moment it does, and this function already honours it.
 */
export function unlockedHero(stageId: string): string | undefined {
  for (const hero of loadContent().heroes.values()) {
    if (hero.unlockedByStage === undefined) return hero.id;
    if (stageAtLeast(stageId, hero.unlockedByStage)) return hero.id;
  }
  return undefined;
}

export function stageAtLeast(stageId: string, minimum: string): boolean {
  const at = stageId.split('-').map(Number);
  const need = minimum.split('-').map(Number);
  const [atRegion = 0, atIndex = 0] = at;
  const [needRegion = 0, needIndex = 0] = need;

  if (atRegion !== needRegion) return atRegion > needRegion;
  return atIndex >= needIndex;
}

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

  constructor(stage: StageDefinition, seed: number, options: RulesetOptions = {}) {
    this.world = createWorldForStage(loadContent(), stage, seed, options);
  }

  static forStage(stageId: string, seed = Date.now() & 0x7fffffff): GameSession | null {
    const stage = loadContent().stages.get(stageId);
    if (stage === undefined) return null;

    const heroId = unlockedHero(stageId);
    return new GameSession(stage, seed, {
      ...(heroId === undefined ? {} : { heroId }),
      heroLevel: useSettings.getState().heroLevel,
    });
  }

  /** Anchors the clock. Called once the first frame's timestamp is known. */
  start(nowMs: number): void {
    this.loop.reset(nowMs);
  }

  /**
   * Advances to the current time and returns the interpolation alpha for
   * rendering between ticks.
   */
  update(nowMs: number, beforeTick?: () => void): number {
    if (this.paused || this.world.finished) {
      /* Keep the clock anchored, or resuming would hand the loop a delta the
         size of however long the player spent in the pause menu. */
      this.loop.reset(nowMs);
      return this.loop.alpha;
    }

    const step = this.loop.advance(nowMs, this.world.speed);
    for (let i = 0; i < step.steps; i++) {
      /* Snapshots positions as "previous" so the renderer has something to
         interpolate from. Without it a 60Hz simulation visibly steps on a
         144Hz display. */
      beforeTick?.();
      tick(this.world);
    }
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

  /**
   * Drops this frame's events.
   *
   * The session clears them, not the consumers: the view and the audio layer
   * both read the same buffer, and whichever cleared first would blind the
   * other. Called once everyone has drained it.
   */
  clearEvents(): void {
    this.world.events.clear();
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
