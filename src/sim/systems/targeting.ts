import { MAX_QUERY_RESULTS } from '../capacity.js';
import { EnemyFlag } from '../flags.js';
import { TargetClass } from '../ruleset.js';
import { statIndexOf, TargetMode } from '../towers.js';
import type { World } from '../world.js';

/**
 * Rebuilds the spatial indexes and lets towers choose what to shoot.
 *
 * The rebuild belongs here rather than in its own step because it has to happen
 * after everything has moved and before anything queries, and this is the first
 * system that queries.
 *
 * Towers do not re-target every tick. A tower re-picks only when its cooldown
 * comes up, or its target dies or leaves range — which turns sixty towers
 * scanning three hundred enemies every tick into a few dozen scans.
 */

export function targetingSystem(world: World): void {
  rebuildIndexes(world);

  const towers = world.towers;
  for (let slot = 0; slot < towers.watermark; slot++) {
    if (!towers.isAlive(slot)) continue;

    if ((towers.cooldown[slot] as number) > 0) {
      towers.cooldown[slot] = (towers.cooldown[slot] as number) - 1;
    }
    if ((towers.disabledUntil[slot] as number) > world.tick) {
      towers.target[slot] = -1;
      continue;
    }

    const current = towers.target[slot] as number;
    if (current >= 0 && stillValid(world, slot, current)) continue;
    towers.target[slot] = pickTarget(world, slot);
  }
}

/**
 * Ground and air are indexed separately so an anti-air tower never walks past
 * three hundred ground enemies to find the one flyer.
 */
function rebuildIndexes(world: World): void {
  const enemies = world.enemies;
  world.groundIndex.clear();
  world.airIndex.clear();

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;
    const flags = enemies.flags[slot] as number;
    /* Burrowed enemies are underground and leaked ones have already scored;
       neither should draw fire. */
    if ((flags & (EnemyFlag.Burrowed | EnemyFlag.Leaked | EnemyFlag.Dying)) !== 0) continue;

    const index = (flags & EnemyFlag.Flying) !== 0 ? world.airIndex : world.groundIndex;
    index.insert(slot, enemies.x[slot] as number, enemies.y[slot] as number);
  }
}

/**
 * Whether a tower is allowed to hit an enemy at all, ignoring range.
 *
 * Splash needs this: a blast should catch whatever it physically covers, but a
 * ground-only mortar still must not damage a flyer overhead.
 */
export function canTargetAny(world: World, towerSlot: number, enemySlot: number): boolean {
  const enemies = world.enemies;
  if (towerSlot < 0 || !world.towers.isAlive(towerSlot)) return false;
  if (!enemies.isAlive(enemySlot)) return false;

  const flags = enemies.flags[enemySlot] as number;
  if ((flags & (EnemyFlag.Burrowed | EnemyFlag.Leaked | EnemyFlag.Dying)) !== 0) return false;

  const targets = world.rules.towers.targets[statIndexOf(world, towerSlot)] as number;
  const flying = (flags & EnemyFlag.Flying) !== 0;
  if (targets === TargetClass.Ground && flying) return false;
  return !(targets === TargetClass.Air && !flying);
}

export function canTarget(world: World, towerSlot: number, enemySlot: number): boolean {
  const enemies = world.enemies;
  if (!enemies.isAlive(enemySlot)) return false;

  const flags = enemies.flags[enemySlot] as number;
  if ((flags & (EnemyFlag.Burrowed | EnemyFlag.Leaked | EnemyFlag.Dying)) !== 0) return false;

  const stats = statIndexOf(world, towerSlot);
  const targets = world.rules.towers.targets[stats] as number;
  const flying = (flags & EnemyFlag.Flying) !== 0;
  if (targets === TargetClass.Ground && flying) return false;
  if (targets === TargetClass.Air && !flying) return false;

  return inRange(world, towerSlot, enemySlot);
}

function inRange(world: World, towerSlot: number, enemySlot: number): boolean {
  const dx = (world.enemies.x[enemySlot] as number) - (world.towers.x[towerSlot] as number);
  const dy = (world.enemies.y[enemySlot] as number) - (world.towers.y[towerSlot] as number);
  const distanceSq = dx * dx + dy * dy;

  const range = world.towers.range[towerSlot] as number;
  const minRange = world.towers.minRange[towerSlot] as number;
  /* Squared throughout: a square root in a loop this hot buys nothing when
     only the comparison matters. */
  if (distanceSq > range * range) return false;
  return !(minRange > 0 && distanceSq < minRange * minRange);
}

function stillValid(world: World, towerSlot: number, enemySlot: number): boolean {
  return canTarget(world, towerSlot, enemySlot);
}

/**
 * Picks by the tower's persisted mode.
 *
 * `First` is the default and the right answer for most towers — an enemy
 * closest to the core is the one about to cost a life.
 */
export function pickTarget(world: World, towerSlot: number): number {
  const stats = statIndexOf(world, towerSlot);
  const targets = world.rules.towers.targets[stats] as number;
  const range = world.towers.range[towerSlot] as number;
  const x = world.towers.x[towerSlot] as number;
  const y = world.towers.y[towerSlot] as number;

  const mode = world.towers.targetMode[towerSlot] as number;
  candidate.slot = -1;
  candidate.score = 0;

  if (targets !== TargetClass.Air) {
    scan(world, world.groundIndex, towerSlot, x, y, range, mode);
  }
  if (targets !== TargetClass.Ground) {
    scan(world, world.airIndex, towerSlot, x, y, range, mode);
  }
  return candidate.slot;
}

/**
 * Shared scratch, so target selection allocates nothing.
 *
 * The best-so-far lives here rather than being returned as a tuple: a tuple
 * would allocate an array per tower per tick, which is exactly the garbage the
 * structure-of-arrays design exists to avoid.
 */
const found = new Int32Array(MAX_QUERY_RESULTS);
const candidate = { slot: -1, score: 0 };

function scan(
  world: World,
  index: { query: (x: number, y: number, r: number, out: Int32Array) => number },
  towerSlot: number,
  x: number,
  y: number,
  range: number,
  mode: number,
): void {
  const count = index.query(x, y, range, found);

  for (let i = 0; i < count; i++) {
    const slot = found[i] as number;
    if (!inRange(world, towerSlot, slot)) continue;

    const score = scoreFor(world, slot, x, y, mode);
    if (candidate.slot < 0 || score > candidate.score) {
      candidate.slot = slot;
      candidate.score = score;
    }
  }
}

/** Higher is better, so every mode is one comparison. */
function scoreFor(world: World, slot: number, x: number, y: number, mode: number): number {
  const enemies = world.enemies;
  switch (mode) {
    case TargetMode.Last:
      return -(enemies.pathDist[slot] as number);
    case TargetMode.Strongest:
      return enemies.hp[slot] as number;
    case TargetMode.Weakest:
      return -(enemies.hp[slot] as number);
    case TargetMode.Closest: {
      const dx = (enemies.x[slot] as number) - x;
      const dy = (enemies.y[slot] as number) - y;
      return -(dx * dx + dy * dy);
    }
    case TargetMode.First:
    default:
      return enemies.pathDist[slot] as number;
  }
}
