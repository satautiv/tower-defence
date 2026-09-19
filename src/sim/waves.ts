import { TICK_HZ } from '@core/constants';
import { MAX_ACTIVE_WAVES, MAX_GROUPS_PER_WAVE } from './capacity.js';
import type { Ruleset } from './ruleset.js';

/**
 * Progress of every wave currently in flight.
 *
 * More than one at a time, because calling early is the game's main risk/reward
 * dial: the player stacks wave N+1 on top of N for gold they may not survive
 * spending. A spawner that assumed one wave would make that impossible.
 *
 * Group progress is flat, `slot * MAX_GROUPS_PER_WAVE + group`, so advancing a
 * wave is array arithmetic with no per-tick allocation.
 */
export class ActiveWaves {
  /** Which wave occupies each slot, or -1 when free. */
  readonly waveIndex = new Int32Array(MAX_ACTIVE_WAVES).fill(-1);
  /** Ticks since the wave started. */
  readonly elapsed = new Float32Array(MAX_ACTIVE_WAVES);
  readonly spawned = new Uint16Array(MAX_ACTIVE_WAVES * MAX_GROUPS_PER_WAVE);
  /** Tick, relative to the wave's start, when this group next releases one. */
  readonly nextSpawnAt = new Float32Array(MAX_ACTIVE_WAVES * MAX_GROUPS_PER_WAVE);

  /** First free slot, or -1 when the board already holds the maximum. */
  freeSlot(): number {
    for (let slot = 0; slot < MAX_ACTIVE_WAVES; slot++) {
      if ((this.waveIndex[slot] as number) < 0) return slot;
    }
    return -1;
  }

  begin(slot: number, waveIndex: number, rules: Ruleset): void {
    this.waveIndex[slot] = waveIndex;
    this.elapsed[slot] = 0;

    const base = slot * MAX_GROUPS_PER_WAVE;
    const source = waveIndex * MAX_GROUPS_PER_WAVE;
    for (let g = 0; g < MAX_GROUPS_PER_WAVE; g++) {
      this.spawned[base + g] = 0;
      this.nextSpawnAt[base + g] = rules.waves.groupDelayTicks[source + g] as number;
    }
  }

  release(slot: number): void {
    this.waveIndex[slot] = -1;
    this.elapsed[slot] = 0;
    const base = slot * MAX_GROUPS_PER_WAVE;
    for (let g = 0; g < MAX_GROUPS_PER_WAVE; g++) {
      this.spawned[base + g] = 0;
      this.nextSpawnAt[base + g] = 0;
    }
  }

  get activeCount(): number {
    let count = 0;
    for (let slot = 0; slot < MAX_ACTIVE_WAVES; slot++) {
      if ((this.waveIndex[slot] as number) >= 0) count++;
    }
    return count;
  }

  clear(): void {
    this.waveIndex.fill(-1);
    this.elapsed.fill(0);
    this.spawned.fill(0);
    this.nextSpawnAt.fill(0);
  }
}

export interface WaveGroupPreview {
  enemyTypeIdx: number;
  enemyId: string;
  count: number;
  spawnPoint: number;
  delaySeconds: number;
  intervalSeconds: number;
}

export interface WavePreview {
  index: number;
  groups: WaveGroupPreview[];
  totalEnemies: number;
  totalBounty: number;
  spawnDurationSeconds: number;
  clearBonus: number;
}

/**
 * What the wave preview panel shows.
 *
 * Reads the same flattened table the spawner does, so the panel cannot promise
 * one composition and the spawner deliver another. A preview the player cannot
 * trust is worse than none: it turns a fair loss into an unfair one
 * (docs/GAME_DESIGN.md §17.3).
 *
 * Called by the UI, not per tick, so returning fresh objects is fine here.
 */
export function describeWave(rules: Ruleset, index: number): WavePreview | null {
  const waves = rules.waves;
  if (index < 0 || index >= waves.count) return null;

  const groups: WaveGroupPreview[] = [];
  let totalEnemies = 0;

  for (let g = 0; g < (waves.groupCount[index] as number); g++) {
    const i = index * MAX_GROUPS_PER_WAVE + g;
    const typeIdx = waves.groupEnemy[i] as number;
    const count = waves.groupCountPer[i] as number;
    totalEnemies += count;

    groups.push({
      enemyTypeIdx: typeIdx,
      enemyId: rules.enemies.ids[typeIdx] ?? 'unknown',
      count,
      spawnPoint: waves.groupSpawnPoint[i] as number,
      delaySeconds: (waves.groupDelayTicks[i] as number) / TICK_HZ,
      intervalSeconds: (waves.groupIntervalTicks[i] as number) / TICK_HZ,
    });
  }

  return {
    index,
    groups,
    totalEnemies,
    totalBounty: waves.totalBounty[index] as number,
    spawnDurationSeconds: (waves.spawnDurationTicks[index] as number) / TICK_HZ,
    clearBonus: waves.clearBonus[index] as number,
  };
}

/**
 * Gold for calling a wave before its timer runs out.
 *
 * The tempo dial: calling the moment the last wave dies is worth roughly a free
 * upgrade, and may well kill you. Capped at what the wave itself is worth, so
 * a long timer cannot pay more than the enemies it summons.
 */
export function earlyCallBonus(rules: Ruleset, waveIndex: number, ticksRemaining: number): number {
  if (waveIndex < 0 || waveIndex >= rules.waves.count) return 0;
  const seconds = Math.max(0, ticksRemaining) / TICK_HZ;
  const raw = Math.floor(seconds * rules.tuning.earlyCallGoldPerSecond);
  const cap = rules.waves.totalBounty[waveIndex] as number;
  return Math.min(raw, cap);
}
