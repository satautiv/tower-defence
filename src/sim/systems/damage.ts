import { DAMAGE_INDEX, DamageFlag } from '../damage.js';
import { addGold, awardKill, bonusGoldFor } from '../economy.js';
import { emitDamageDealt, emitEnemyDied } from '../events.js';
import { EnemyFlag } from '../flags.js';
import { laneOffsetFor } from '../path.js';
import { spawnEnemy } from '../spawn.js';
import { STATUS_COUNT, STATUS_INDEX } from '../status.js';
import { applyStatus } from './status.js';
import { statIndexOf } from '../towers.js';
import type { World } from '../world.js';

/**
 * The single place damage is applied and the only place enemies die.
 *
 * Every source — projectiles, beams, auras, damage over time, reactions,
 * soldiers, the hero — has spent the tick pushing onto one queue. Draining it
 * here means a tower cannot shoot a corpse, chain lightning cannot jump to
 * something that died earlier in the same tick, and the result does not depend
 * on which system happened to run first.
 *
 * Deaths are deferred again, until the whole queue has drained: an enemy hit
 * five times in one tick dies once and pays one bounty, however the hits were
 * ordered.
 */

const TRUE_DAMAGE = DAMAGE_INDEX.true;
const KINETIC = DAMAGE_INDEX.kinetic;
const FREEZE = STATUS_INDEX.freeze;
const CORRODE = STATUS_INDEX.corrode;
const UNRAVEL = STATUS_INDEX.unravel;
const FRACTURE = STATUS_INDEX.fracture;

export function damageResolutionSystem(world: World): void {
  const queue = world.damage;

  for (let i = 0; i < queue.count; i++) {
    resolveOne(world, i);
  }
  queue.clear();

  resolveDeaths(world);
}

/**
 * Effective armour or ward after everything that reduces it.
 *
 * Corrode eats both, armour pierce only armour, and a temporary defence
 * multiplier — what a Superconduct sets — scales whatever is left. Capped, so
 * stacking defence has a ceiling and no target becomes unkillable.
 */
export function effectiveDefence(
  world: World,
  enemySlot: number,
  kinetic: boolean,
  armourPierce: number,
  fromX: number,
  fromY: number,
): number {
  const enemies = world.enemies;
  const tuning = world.rules.tuning;
  const table = world.rules.enemies;
  const typeIdx = enemies.typeIdx[enemySlot] as number;

  let base = kinetic ? (enemies.armour[enemySlot] as number) : (enemies.ward[enemySlot] as number);

  /* Struck from behind, a directional-armour enemy is far softer. This is the
     whole reason a plot behind the path is worth having. */
  if (kinetic && ((enemies.flags[enemySlot] as number) & EnemyFlag.DirectionalArmour) !== 0) {
    if (isBehind(world, enemySlot, fromX, fromY)) base = table.rearArmour[typeIdx] as number;
  }

  const corrode = enemies.stacksOf(enemySlot, CORRODE);
  const perStack = world.rules.statuses.defenceReductionPerStack[CORRODE] as number;
  let defence = base - corrode * perStack;
  if (kinetic) defence -= armourPierce;

  if (world.tick < (enemies.defenceMultiplierUntil[enemySlot] as number)) {
    defence *= enemies.defenceMultiplier[enemySlot] as number;
  }

  if (defence < 0) return 0;
  return defence > tuning.defenceCap ? tuning.defenceCap : defence;
}

function isBehind(world: World, enemySlot: number, fromX: number, fromY: number): boolean {
  const enemies = world.enemies;
  const facing = enemies.facing[enemySlot] as number;
  const toSourceX = fromX - (enemies.x[enemySlot] as number);
  const toSourceY = fromY - (enemies.y[enemySlot] as number);
  /* Negative dot product means the attacker is on the enemy's back arc. */
  return Math.cos(facing) * toSourceX + Math.sin(facing) * toSourceY < 0;
}

/**
 * The damage formula (docs/GAME_DESIGN.md §7.1).
 *
 * Every coefficient comes from content — corrode's bite, unravel's
 * amplification, fracture's physical scaling are all read from the status
 * table, and the half point and cap from tuning. There is nothing to tune here
 * by editing code.
 */
function resolveOne(world: World, index: number): void {
  const queue = world.damage;
  const enemies = world.enemies;
  const slot = queue.target[index] as number;

  /* Already dead or already dying: nothing in this tick can hit it twice. */
  if (!enemies.isAlive(slot)) return;
  const flags = enemies.flags[slot] as number;
  if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0) return;

  const damageFlags = queue.flags[index] as number;
  const type = queue.type[index] as number;
  const source = queue.source[index] as number;

  if ((damageFlags & DamageFlag.Evadable) !== 0 && rollsEvade(world, slot)) return;

  let amount = queue.amount[index] as number;

  if (type !== TRUE_DAMAGE && (damageFlags & DamageFlag.True) === 0) {
    const kinetic = type === KINETIC;
    const pierce =
      (damageFlags & DamageFlag.ArmourPierce) !== 0 && source >= 0 && world.towers.isAlive(source)
        ? (world.rules.towers.armourPierce[statIndexOf(world, source)] as number)
        : 0;

    const fromX =
      source >= 0 && world.towers.isAlive(source)
        ? (world.towers.x[source] as number)
        : (enemies.x[slot] as number);
    const fromY =
      source >= 0 && world.towers.isAlive(source)
        ? (world.towers.y[source] as number)
        : (enemies.y[slot] as number);

    const defence = effectiveDefence(world, slot, kinetic, pierce, fromX, fromY);
    const half = world.rules.tuning.defenceHalfPoint;
    amount *= 1 - defence / (defence + half);

    /* Unravel amplifies everything; fracture is physical only, which is what
       gives a pure-Kinetic board its own scaling lane. */
    amount *=
      1 +
      (world.rules.statuses.vulnerabilityPerStack[UNRAVEL] as number) *
        enemies.stacksOf(slot, UNRAVEL);
    if (kinetic) {
      amount *=
        1 +
        (world.rules.statuses.vulnerabilityPerStack[FRACTURE] as number) *
          enemies.stacksOf(slot, FRACTURE);
    }
  }

  if ((damageFlags & DamageFlag.IsReaction) !== 0) amount *= world.reactionPower;

  /* A heavy physical blow shatters a frozen target. */
  if (
    (damageFlags & DamageFlag.CanShatter) !== 0 &&
    type === KINETIC &&
    enemies.stacksOf(slot, FREEZE) > 0 &&
    amount >= world.rules.tuning.shatterThreshold
  ) {
    amount *= world.rules.tuning.shatterMultiplier;
    enemies.statusStacks[slot * STATUS_COUNT + FREEZE] = 0;
  }

  if (amount <= 0) return;

  /* Overshield absorbs first, which is what makes sustained chip damage the
     wrong answer to a Shieldwright's escort. */
  const shield = enemies.overshield[slot] as number;
  if (shield > 0) {
    const absorbed = Math.min(shield, amount);
    enemies.overshield[slot] = shield - absorbed;
    amount -= absorbed;
    if (amount <= 0) {
      emitDamageDealt(world.events, enemies.ids[slot] as number, absorbed, type, 0);
      return;
    }
  }

  enemies.hp[slot] = (enemies.hp[slot] as number) - amount;
  world.stats.damageDealt += amount;
  /* Attributed where it came from, so a panel can say what this tower has
     contributed. Sources that are not towers — burns, reactions, soldiers —
     carry -1 and are counted only in the stage total. */
  if (source >= 0 && world.towers.isAlive(source)) {
    world.towers.damageDealt[source] = (world.towers.damageDealt[source] as number) + amount;
  }
  applyOnHitStatus(world, index, slot);

  emitDamageDealt(
    world.events,
    enemies.ids[slot] as number,
    amount,
    type,
    (damageFlags & DamageFlag.IsReaction) !== 0 ? 1 : 0,
  );

  if ((enemies.hp[slot] as number) <= 0) {
    /* Flagged, not removed. The body stays until the queue has drained so a
       later entry aimed at it resolves against a corpse-check rather than a
       recycled slot holding someone else. */
    enemies.flags[slot] = (enemies.flags[slot] as number) | EnemyFlag.Dying;
    world.deaths.push(slot, type, source);
  }
}

/**
 * The status a hit carries, handed to the one applier.
 *
 * Going through `applyStatus` rather than writing the arrays here is what gives
 * an on-hit Chill the same escalation into Freeze that any other source gets —
 * a Frost Cairn stacking a target to five freezes it, exactly as the design
 * says it should, without the firing code knowing Freeze exists.
 */
function applyOnHitStatus(world: World, index: number, slot: number): void {
  const queue = world.damage;
  const statusId = queue.statusId[index] as number;
  if (statusId >= STATUS_COUNT) return;
  if (((queue.flags[index] as number) & DamageFlag.NoStatus) !== 0) return;

  applyStatus(world, slot, statusId, queue.statusStacks[index] as number);
}

/** Seeded, so a dodge is part of the replay rather than a surprise. */
function rollsEvade(world: World, slot: number): boolean {
  const chance = world.rules.enemies.evasion[world.enemies.typeIdx[slot] as number] as number;
  if (chance <= 0) return false;
  return world.rng.next() < chance;
}

/**
 * Pays out and clears away everything that died this tick.
 *
 * Runs after the queue has fully drained, so the payout for an enemy hit by
 * five sources is identical however those sources were ordered.
 */
function resolveDeaths(world: World): void {
  const deaths = world.deaths;
  const enemies = world.enemies;

  for (let i = 0; i < deaths.count; i++) {
    const slot = deaths.slots[i] as number;
    if (!enemies.isAlive(slot)) continue;

    const typeIdx = enemies.typeIdx[slot] as number;
    world.stats.enemiesKilled += 1;
    awardKill(world, typeIdx);

    const killer = deaths.killedBySource[i] as number;
    if (killer >= 0 && world.towers.isAlive(killer)) {
      world.towers.kills[killer] = (world.towers.kills[killer] as number) + 1;
    }
    /* Economy towers add on top of the bounty, which is the whole reason to
       build one instead of more damage. */
    addGold(world, bonusGoldFor(world, deaths.killedBySource[i] as number));

    emitEnemyDied(
      world.events,
      enemies.ids[slot] as number,
      enemies.x[slot] as number,
      enemies.y[slot] as number,
      deaths.killedBy[i] as number,
    );

    splitOnDeath(world, slot, typeIdx);
    enemies.free(slot);
  }
  deaths.clear();
}

/**
 * A splitter becomes its children where it fell.
 *
 * They inherit the parent's exact path distance and wave, so the spread is
 * decided by the lane hash rather than by the RNG — a splitter must not shift
 * the random stream and change what happens elsewhere on the board.
 */
function splitOnDeath(world: World, parent: number, typeIdx: number): void {
  const table = world.rules.enemies;
  const childType = table.splitsInto[typeIdx] as number;
  const count = table.splitCount[typeIdx] as number;
  if (childType < 0 || count <= 0) return;

  const enemies = world.enemies;
  const distance = enemies.pathDist[parent] as number;
  const pathId = enemies.pathId[parent] as number;
  const waveIndex = enemies.waveIndex[parent] as number;
  const spawnPoint = enemies.spawnPoint[parent] as number;

  for (let i = 0; i < count; i++) {
    const child = spawnEnemy(world, childType, spawnPoint);
    if (child < 0) return;

    enemies.pathId[child] = pathId;
    enemies.pathDist[child] = distance;
    enemies.waveIndex[child] = waveIndex;
    enemies.x[child] = enemies.x[parent] as number;
    enemies.y[child] = enemies.y[parent] as number;
    enemies.laneOffset[child] = laneOffsetFor(enemies.ids[child] as number, world.rules.laneWidth);
  }
}
