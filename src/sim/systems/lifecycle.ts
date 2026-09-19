import { TICK_HZ } from '@core/constants';
import { emitEnemyLeaked, emitLifeLost, SimEventKind } from '../events.js';
import { EnemyFlag } from '../flags.js';
import { StagePhase } from '../world.js';
import type { World } from '../world.js';

/**
 * Collects leaked enemies and decides when the stage is over.
 *
 * The last system that can change anything, which is deliberate: a leak that
 * empties the life pool and a final wave clearing on the same tick both want to
 * end the stage, and only one of them should. Loss is checked first — an enemy
 * reaching the core is a loss even if it was the last enemy on the board.
 */
export function lifecycleSystem(world: World): void {
  if (world.finished) return;

  collectLeaks(world);

  if (world.resources.lives <= 0) {
    finish(world, StagePhase.Lost);
    return;
  }

  /* Won only once every wave has been released and every enemy from it is
     gone. `cleared` counts completed waves, and splitter children inherit
     their parent's wave, so nothing can be left behind. */
  if (world.phase === StagePhase.Running && world.wave.cleared >= world.rules.waves.count) {
    finish(world, StagePhase.Won);
  }
}

/**
 * Charges for everything that reached the core and removes it.
 *
 * Movement only marks a leak; the body is collected here so exactly one system
 * decides an enemy is gone. Two systems both removing entities is how a bounty
 * gets paid twice.
 */
function collectLeaks(world: World): void {
  const enemies = world.enemies;

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;
    if (((enemies.flags[slot] as number) & EnemyFlag.Leaked) === 0) continue;

    const cost = world.rules.enemies.livesCost[enemies.typeIdx[slot] as number] as number;
    world.resources.lives -= cost;
    if (world.resources.lives < 0) world.resources.lives = 0;
    world.stats.enemiesLeaked += 1;

    emitEnemyLeaked(world.events, enemies.ids[slot] as number, cost);
    if (cost > 0) emitLifeLost(world.events, world.resources.lives, cost);

    enemies.free(slot);
  }
}

function finish(world: World, phase: StagePhase.Won | StagePhase.Lost): void {
  world.phase = phase;
  /* +1 because the tick currently running completes after this system. */
  world.stats.finishedAtTick = world.tick + 1;
  world.events.push(phase === StagePhase.Won ? SimEventKind.StageWon : SimEventKind.StageLost);
}

/* ------------------------------------------------------------- results */

export interface StageResult {
  won: boolean;
  stars: 0 | 1 | 2 | 3;
  livesRemaining: number;
  startingLives: number;
  /** Wall-clock length of the run, from the stage's own tick count. */
  durationSeconds: number;
  wavesCleared: number;
  totalWaves: number;
  enemiesKilled: number;
  enemiesLeaked: number;
  goldEarned: number;
  towersBuilt: number;
  reactionsTriggered: number;
}

/**
 * Stars, from lives alone (docs/GAME_DESIGN.md §12.4).
 *
 * Three means losing nothing, which is the same demand on every difficulty.
 * Two is a fraction of the starting pool rather than a fixed twelve, so the
 * rule still holds on Veteran and Impossible where fewer lives are granted.
 */
export function starsFor(world: World): 0 | 1 | 2 | 3 {
  if (world.phase !== StagePhase.Won) return 0;

  const lives = world.resources.lives;
  const starting = world.config.lives;
  if (lives >= starting) return 3;
  if (lives >= Math.ceil(starting * world.rules.tuning.twoStarLivesFraction)) return 2;
  return lives >= 1 ? 1 : 0;
}

export function stageResult(world: World): StageResult {
  const endedAt = world.stats.finishedAtTick >= 0 ? world.stats.finishedAtTick : world.tick;

  return {
    won: world.phase === StagePhase.Won,
    stars: starsFor(world),
    livesRemaining: world.resources.lives,
    startingLives: world.config.lives,
    durationSeconds: endedAt / TICK_HZ,
    wavesCleared: world.wave.cleared,
    totalWaves: world.rules.waves.count,
    enemiesKilled: world.stats.enemiesKilled,
    enemiesLeaked: world.stats.enemiesLeaked,
    goldEarned: world.stats.goldEarned,
    towersBuilt: world.stats.towersBuilt,
    reactionsTriggered: world.stats.reactionsTriggered,
  };
}
