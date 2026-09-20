import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { DamageFlag } from '../damage.js';
import { GroundEffectFlag } from '../flags.js';
import { EnemyFlag } from '../flags.js';
import { STATUS_COUNT } from '../status.js';
import { applyStatus } from './status.js';
import type { World } from '../world.js';

/**
 * Lingering areas: burning pools, Arc Net fields, a Stasis Field, lava, and
 * the one-shot map interactables (#31).
 *
 * One pool for all of them, because they differ only in payload. A Firestorm
 * Cannon's pool and a region's lava channel are the same object with different
 * numbers, and giving each its own type would mean writing the "what is
 * standing in this" query several times.
 *
 * **Effects query enemies, never the reverse.** Thirty overlapping fields each
 * asking the spatial hash once is thirty queries; three hundred enemies each
 * asking "what am I standing in" is three hundred, and it grows with the wrong
 * number.
 *
 * Stacking is decided here rather than left to accumulate: slows take the
 * strongest rather than multiplying, so three pools that each halve speed
 * leave an enemy at half and not at an eighth. Damage does stack, because two
 * fires really should burn twice as fast, and the per-tick rate is what a
 * designer is tuning.
 */

export function groundEffectSystem(world: World): void {
  clearGroundState(world);

  const effects = world.groundEffects;
  for (let slot = 0; slot < effects.watermark; slot++) {
    if (!effects.isAlive(slot)) continue;

    const remaining = (effects.duration[slot] as number) - 1;
    effects.duration[slot] = remaining;
    /* Expired: the slot is freed here so nothing else has to check whether an
       effect it is looking at is still real. */
    if (remaining <= 0) {
      effects.free(slot);
      continue;
    }

    applyContinuous(world, slot);

    const next = (effects.nextTickIn[slot] as number) - 1;
    effects.nextTickIn[slot] = next;
    if (next > 0) continue;

    effects.nextTickIn[slot] = effects.tickInterval[slot] as number;
    applyPeriodic(world, slot);
  }
}

/**
 * Forgets last tick's ground state before recomputing it.
 *
 * Recomputed rather than accumulated: an enemy that walked out of a pool must
 * stop being slowed the moment it does, and the only way to be sure of that
 * without per-enemy bookkeeping is to start from nothing every tick.
 */
function clearGroundState(world: World): void {
  const enemies = world.enemies;
  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;
    enemies.groundSlow[slot] = 1;
    enemies.groundBlocked[slot] = 0;
  }
}

/**
 * What an effect does to everything standing in it, every tick.
 *
 * Slowing and blocking are continuous: they describe the ground, not an event
 * happening on it, so they cannot wait for the next application interval.
 */
function applyContinuous(world: World, slot: number): void {
  const effects = world.groundEffects;
  const slow = effects.slowMultiplier[slot] as number;
  const blocks = ((effects.flags[slot] as number) & GroundEffectFlag.Blocking) !== 0;
  if (slow >= 1 && !blocks) return;

  const enemies = world.enemies;
  const found = gather(world, slot);

  for (let i = 0; i < found; i++) {
    const enemy = world.queryBuffer[i] as number;
    /* Strongest wins. Multiplying overlapping fields is how a player ends up
       standing an entire wave still, which is not a thing this design sells. */
    if (slow < (enemies.groundSlow[enemy] as number)) enemies.groundSlow[enemy] = slow;
    if (blocks) enemies.groundBlocked[enemy] = 1;
  }
}

/** Damage and status, on the effect's own interval rather than every tick. */
function applyPeriodic(world: World, slot: number): void {
  const effects = world.groundEffects;
  const damage = effects.damagePerTick[slot] as number;
  const statusId = effects.statusId[slot] as number;
  if (damage <= 0 && statusId >= STATUS_COUNT) return;

  const found = gather(world, slot);
  const source = effects.sourceTower[slot] as number;

  for (let i = 0; i < found; i++) {
    const enemy = world.queryBuffer[i] as number;

    if (damage > 0) {
      /* Through the shared queue, so a pool's kill pays bounty and splits a
         splitter exactly as a tower's shot does. Never evadable: standing in
         fire is not something you dodge. */
      world.damage.push(enemy, damage, effects.damageType[slot] as number, source, DamageFlag.None);
    }
    if (statusId < STATUS_COUNT) {
      applyStatus(world, enemy, statusId, effects.statusStacks[slot] as number);
    }
  }
}

/**
 * Enemies standing in an effect, into the shared query buffer.
 *
 * Ground and air both: a burning pool does not reach a bat overhead, but a
 * Stasis Field explicitly does, and which is which is the effect's business
 * rather than this function's. Flyers are filtered by the payload if a future
 * effect needs to.
 */
function gather(world: World, slot: number): number {
  const effects = world.groundEffects;
  const x = effects.x[slot] as number;
  const y = effects.y[slot] as number;
  const radius = effects.radius[slot] as number;

  const buffer = world.queryBuffer;
  let found = world.groundIndex.query(x, y, radius, buffer);

  /* Dead and leaving enemies are still in the index this tick; an effect must
     not burn a corpse or hold something the lifecycle system has collected. */
  let kept = 0;
  for (let i = 0; i < found; i++) {
    const enemy = buffer[i] as number;
    if (!world.enemies.isAlive(enemy)) continue;
    const flags = world.enemies.flags[enemy] as number;
    if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked | EnemyFlag.Burrowed)) !== 0) continue;
    buffer[kept++] = enemy;
  }
  found = kept;
  return found;
}

export interface GroundEffectSpec {
  x: number;
  y: number;
  radiusTiles: number;
  seconds: number;
  /** Seconds between damage and status applications. */
  intervalSeconds?: number;
  damagePerSecond?: number;
  damageType?: number;
  statusId?: number;
  statusStacks?: number;
  /** Movement multiplier inside, 1 for none. 0.25 is a 75% slow. */
  slowMultiplier?: number;
  blocks?: boolean;
  sourceTower?: number;
}

/**
 * Lays an effect on the ground. The one way to make one.
 *
 * Every source goes through here — a tower's pool, an ability, a map lever,
 * region terrain — so that the conversion from authored seconds and tiles into
 * ticks and pixels happens once, in the same place the rest of the ruleset
 * does it.
 */
export function createGroundEffect(world: World, spec: GroundEffectSpec): number {
  const effects = world.groundEffects;
  const slot = effects.alloc();
  /* Dropped rather than grown: a missing puddle is invisible, and a mid-wave
     reallocation is the GC pause the whole design exists to avoid. */
  if (slot < 0) return -1;

  const interval = Math.max(1, Math.round((spec.intervalSeconds ?? 1) * TICK_HZ));

  effects.x[slot] = spec.x;
  effects.y[slot] = spec.y;
  effects.radius[slot] = spec.radiusTiles * TILE_SIZE;
  effects.duration[slot] = Math.max(1, Math.round(spec.seconds * TICK_HZ));
  effects.tickInterval[slot] = interval;
  /* Fires on its first eligible tick rather than after a full interval, so a
     lever the player just pulled does something immediately. */
  effects.nextTickIn[slot] = 1;
  /* Content states damage per second; the simulation pays it per application,
     so the rate is scaled by how often that happens. */
  effects.damagePerTick[slot] = ((spec.damagePerSecond ?? 0) * interval) / TICK_HZ;
  effects.damageType[slot] = spec.damageType ?? 0;
  effects.statusId[slot] = spec.statusId ?? 255;
  effects.statusStacks[slot] = spec.statusStacks ?? 0;
  effects.slowMultiplier[slot] = spec.slowMultiplier ?? 1;
  effects.sourceTower[slot] = spec.sourceTower ?? -1;
  effects.flags[slot] =
    GroundEffectFlag.Alive | (spec.blocks === true ? GroundEffectFlag.Blocking : 0);

  return slot;
}
