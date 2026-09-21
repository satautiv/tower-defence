import { MAX_ACTIVE_WAVES, MAX_GROUPS_PER_WAVE } from '../capacity.js';
import { EnemyFlag } from '../flags.js';
import { emitWaveCleared, emitWaveStarted } from '../events.js';
import { spawnEnemy } from '../spawn.js';
import { StagePhase } from '../world.js';
import type { World } from '../world.js';

/**
 * Releases enemies on schedule and decides when a wave is done.
 *
 * Groups within a wave run in parallel with their own delays and intervals, so
 * a wave is a small schedule rather than a queue — which is what lets an author
 * open with fodder and drop a healer in behind it eight seconds later.
 */

export function startWave(world: World, waveIndex: number): boolean {
  const waves = world.rules.waves;
  if (waveIndex < 0 || waveIndex >= waves.count) return false;

  const slot = world.waveRunner.freeSlot();
  /* Every slot busy means four waves are already in flight, which is far past
     survivable; refusing is kinder than stacking a fifth. */
  if (slot < 0) return false;

  world.waveRunner.begin(slot, waveIndex, world.rules);
  world.wave.index = waveIndex;
  world.wave.active = world.waveRunner.activeCount;
  world.wave.autoStartIn =
    waveIndex + 1 < waves.count ? (waves.autoStartTicks[waveIndex + 1] as number) : 0;

  if (world.phase === StagePhase.Building) world.phase = StagePhase.Running;
  emitWaveStarted(world.events, waveIndex);
  return true;
}

export function waveSpawnerSystem(world: World): void {
  advanceAutoStart(world);

  const runner = world.waveRunner;
  const waves = world.rules.waves;

  for (let slot = 0; slot < MAX_ACTIVE_WAVES; slot++) {
    const waveIndex = runner.waveIndex[slot] as number;
    if (waveIndex < 0) continue;

    runner.elapsed[slot] = (runner.elapsed[slot] as number) + 1;
    const elapsed = runner.elapsed[slot] as number;
    const groupCount = waves.groupCount[waveIndex] as number;

    let finishedSpawning = true;
    for (let g = 0; g < groupCount; g++) {
      const progress = slot * MAX_GROUPS_PER_WAVE + g;
      const source = waveIndex * MAX_GROUPS_PER_WAVE + g;
      const total = waves.groupCountPer[source] as number;

      if ((runner.spawned[progress] as number) >= total) continue;
      finishedSpawning = false;

      /* A while loop, not an if: an interval of zero means the whole group
         appears at once, and a long frame must not stretch a wave out. */
      while (
        (runner.spawned[progress] as number) < total &&
        elapsed >= (runner.nextSpawnAt[progress] as number)
      ) {
        const typeIdx = waves.groupEnemy[source] as number;
        const enemySlot = spawnEnemy(
          world,
          typeIdx,
          waves.groupSpawnPoint[source] as number,
          waveIndex,
        );
        if (enemySlot >= 0) world.enemies.waveIndex[enemySlot] = waveIndex;

        runner.spawned[progress] = (runner.spawned[progress] as number) + 1;
        runner.nextSpawnAt[progress] =
          (runner.nextSpawnAt[progress] as number) + (waves.groupIntervalTicks[source] as number);
      }
    }

    if (finishedSpawning && !anyEnemyFrom(world, waveIndex)) {
      completeWave(world, slot, waveIndex);
    }
  }

  world.wave.active = runner.activeCount;
}

function advanceAutoStart(world: World): void {
  const waves = world.rules.waves;
  const next = world.wave.index + 1;
  if (next >= waves.count) return;

  world.wave.autoStartIn -= 1;
  if (world.wave.autoStartIn > 0) return;

  /* Every slot busy means four waves are already in flight. Hold the timer at
     zero and retry next tick rather than letting it run negative, which would
     show the player a countdown going backwards. */
  if (!startWave(world, next)) world.wave.autoStartIn = 0;
}

/**
 * A leaked enemy counts as gone. It reached the core and the player has already
 * paid for it, so the wave should not stay open waiting for the lifecycle
 * system to collect the body.
 */
function anyEnemyFrom(world: World, waveIndex: number): boolean {
  const enemies = world.enemies;
  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;
    if ((enemies.waveIndex[slot] as number) !== waveIndex) continue;
    if (((enemies.flags[slot] as number) & EnemyFlag.Leaked) !== 0) continue;
    return true;
  }
  return false;
}

function completeWave(world: World, slot: number, waveIndex: number): void {
  const bonus = world.rules.waves.clearBonus[waveIndex] as number;
  world.resources.gold += bonus;
  world.wave.cleared += 1;
  world.waveRunner.release(slot);
  emitWaveCleared(world.events, waveIndex, bonus);
}
