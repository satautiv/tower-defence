import { TICK_SECONDS } from '@core/constants';
import { DamageFlag } from '../damage.js';
import { EnemyFlag, SoldierFlag, TowerFlag } from '../flags.js';
import { beginHeroRespawn } from './hero.js';
import { statIndexOf } from '../towers.js';
import type { World } from '../world.js';

/**
 * Soldiers, and the blocking they exist for.
 *
 * The most subtle system in the genre and the one players notice most when it
 * is wrong (docs/TECH_DESIGN.md §7.7). Blocking is what holds a wave inside
 * your damage zone, and it is how a player *buys time* when a wave goes wrong —
 * which makes it the only real answer to "I am losing and I need a minute".
 *
 * The rule that matters most is the **blocking window**. A soldier blocks only
 * enemies whose distance *along the path* is close to its own, not enemies
 * that happen to be nearby in pixels. Stage 1-1's route doubles back on itself
 * twice; without this a soldier standing in one leg of a hairpin would reach
 * across and body-block an enemy on the other leg, a tile away and a hundred
 * tiles apart in the only sense the simulation cares about.
 *
 * The hero (#25) runs this same code with better stats and the Hero flag. One
 * implementation, two consumers — blocking is far too subtle to have two.
 */

/**
 * How far along the path a soldier's reach extends, in world pixels.
 *
 * Deliberately tight. Wider and a soldier starts catching enemies it visibly
 * is not standing in front of; narrower and enemies slip through the frame
 * between two ticks at three times speed.
 */
const BLOCK_WINDOW = 48;

/** Pixels per second a soldier walks back to its rally point. */
const WALK_SPEED = 110;

export function soldierSystem(world: World): void {
  maintainGarrisons(world);

  const soldiers = world.soldiers;
  for (let slot = 0; slot < soldiers.watermark; slot++) {
    if (!soldiers.isAlive(slot)) continue;

    /* The hero's own respawn is the hero system's, since it returns to the
       Core rather than to a barracks. */
    if ((soldiers.flags[slot] as number) & SoldierFlag.Respawning) {
      if (((soldiers.flags[slot] as number) & SoldierFlag.Hero) === 0) tickRespawn(world, slot);
      continue;
    }

    releaseIfInvalid(world, slot);

    if ((soldiers.flags[slot] as number) & SoldierFlag.Engaged) fight(world, slot);
    else if (!engageSomething(world, slot)) walkToRally(world, slot);
  }
}

/**
 * Raises each barracks' soldiers, once.
 *
 * A tower with a garrison keeps exactly `count` soldiers alive or counting
 * down. Slots are filled in order so respawn timers stay attached to a
 * particular soldier rather than to whichever died most recently.
 */
function maintainGarrisons(world: World): void {
  const towers = world.towers;

  for (let tower = 0; tower < towers.watermark; tower++) {
    if (!towers.isAlive(tower)) continue;
    if (((towers.flags[tower] as number) & TowerFlag.Disabled) !== 0) continue;

    const stats = statIndexOf(world, tower);
    const count = world.rules.towers.soldierCount[stats] as number;
    if (count === 0) continue;

    for (let garrisonSlot = 0; garrisonSlot < count; garrisonSlot++) {
      if (findSoldier(world, tower, garrisonSlot) >= 0) continue;
      raise(world, tower, garrisonSlot, stats);
    }
  }
}

/** The soldier occupying one of a tower's garrison slots, or -1. */
function findSoldier(world: World, tower: number, garrisonSlot: number): number {
  const soldiers = world.soldiers;
  for (let slot = 0; slot < soldiers.watermark; slot++) {
    if (!soldiers.isAlive(slot)) continue;
    if ((soldiers.sourceTower[slot] as number) !== tower) continue;
    if ((soldiers.garrisonSlot[slot] as number) === garrisonSlot) return slot;
  }
  return -1;
}

function raise(world: World, tower: number, garrisonSlot: number, stats: number): void {
  const soldiers = world.soldiers;
  const slot = soldiers.alloc();
  /* The pool is full. Dropping the soldier is right: growing it mid-wave is
     the allocation the whole design exists to avoid. */
  if (slot < 0) return;

  const table = world.rules.towers;
  const towerX = world.towers.x[tower] as number;
  const towerY = world.towers.y[tower] as number;

  soldiers.sourceTower[slot] = tower;
  soldiers.garrisonSlot[slot] = garrisonSlot;
  soldiers.maxHp[slot] = table.soldierHp[stats] as number;
  soldiers.hp[slot] = soldiers.maxHp[slot] as number;
  soldiers.armour[slot] = table.soldierArmour[stats] as number;
  soldiers.damageType[slot] = table.soldierDamageType[stats] as number;
  soldiers.damage[slot] = table.soldierDamage[stats] as number;
  soldiers.attackInterval[slot] = table.soldierIntervalTicks[stats] as number;
  soldiers.attackRange[slot] = table.soldierAttackRange[stats] as number;
  soldiers.cooldown[slot] = 0;
  soldiers.engagedWith[slot] = -1;
  soldiers.respawnIn[slot] = 0;
  soldiers.flags[slot] = SoldierFlag.Alive;

  soldiers.x[slot] = towerX;
  soldiers.y[slot] = towerY;

  const rallyX = world.towers.rallyX[tower] as number;
  const rallyY = world.towers.rallyY[tower] as number;
  if (rallyX !== 0 || rallyY !== 0) {
    setRallyPoint(world, slot, rallyX, rallyY);
    return;
  }

  /* Nobody has dragged the flag, so the garrison takes the road the tower
     overlooks. Standing at the tower instead would make an untouched barracks
     useless: plots sit two or three tiles off the path, and a soldier's reach
     is measured in pixels — it would watch every enemy walk by just out of
     arm's length. */
  const spot = nearestRoad(world, tower, towerX, towerY);
  setRallyPoint(world, slot, spot.x, spot.y);
}

/**
 * The closest point on any path to this tower, within its rally range.
 *
 * Reuses the same clamp a dragged flag gets, so the default is a position the
 * player could have chosen themselves rather than a privileged one.
 */
function nearestRoad(
  world: World,
  tower: number,
  towerX: number,
  towerY: number,
): { x: number; y: number } {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  let best = { x: towerX, y: towerY };
  let bestSq = Number.POSITIVE_INFINITY;

  for (const path of world.rules.paths) {
    path.sample(path.nearestDistance(towerX, towerY), sample);
    const gapSq =
      (sample.x - towerX) * (sample.x - towerX) + (sample.y - towerY) * (sample.y - towerY);
    if (gapSq < bestSq) {
      bestSq = gapSq;
      best = { x: sample.x, y: sample.y };
    }
  }

  const range = world.rules.towers.rallyRange[statIndexOf(world, tower)] as number;
  const dx = best.x - towerX;
  const dy = best.y - towerY;
  const distance = Math.hypot(dx, dy);
  if (distance <= range || distance === 0) return best;

  return { x: towerX + (dx / distance) * range, y: towerY + (dy / distance) * range };
}

/**
 * Points a soldier at a spot and records where that is *along the path*.
 *
 * The path position is resolved here rather than per tick because it only
 * changes when the rally does, and resolving it walks every segment of the
 * route.
 */
export function setRallyPoint(world: World, slot: number, x: number, y: number): void {
  const soldiers = world.soldiers;
  soldiers.rallyX[slot] = x;
  soldiers.rallyY[slot] = y;

  let bestPath = 0;
  let bestDistance = 0;
  let bestSq = Number.POSITIVE_INFINITY;

  for (const path of world.rules.paths) {
    const distance = path.nearestDistance(x, y);
    const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
    path.sample(distance, sample);
    const gapSq = (sample.x - x) * (sample.x - x) + (sample.y - y) * (sample.y - y);
    if (gapSq < bestSq) {
      bestSq = gapSq;
      bestPath = path.id;
      bestDistance = distance;
    }
  }

  soldiers.pathId[slot] = bestPath;
  soldiers.pathDist[slot] = bestDistance;
}

function tickRespawn(world: World, slot: number): void {
  const soldiers = world.soldiers;
  const remaining = (soldiers.respawnIn[slot] as number) - 1;
  soldiers.respawnIn[slot] = remaining;
  if (remaining > 0) return;

  const tower = soldiers.sourceTower[slot] as number;
  /* The barracks was sold while its soldier was down. Nothing to come back to. */
  if (tower < 0 || !world.towers.isAlive(tower)) {
    soldiers.free(slot);
    return;
  }

  soldiers.hp[slot] = soldiers.maxHp[slot] as number;
  soldiers.x[slot] = world.towers.x[tower] as number;
  soldiers.y[slot] = world.towers.y[tower] as number;
  soldiers.flags[slot] = SoldierFlag.Alive;
}

/**
 * Drops an engagement that is no longer real.
 *
 * Four ways a block ends (§7.7): the enemy died, the enemy's patience ran out,
 * the enemy is no longer pointing at this soldier, or the soldier has been
 * pulled out of reach by a rally move. All four have to release cleanly, or an
 * enemy is left permanently halted by a soldier that is not there.
 */
function releaseIfInvalid(world: World, slot: number): void {
  const soldiers = world.soldiers;
  if (((soldiers.flags[slot] as number) & SoldierFlag.Engaged) === 0) return;

  const enemy = soldiers.engagedWith[slot] as number;
  const enemies = world.enemies;

  const gone =
    enemy < 0 ||
    !enemies.isAlive(enemy) ||
    ((enemies.flags[enemy] as number) & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0 ||
    (enemies.blockedBy[enemy] as number) !== slot;

  const lapsed = !gone && world.tick >= (enemies.blockUntilTick[enemy] as number);
  const outOfReach = !gone && !withinReach(world, slot, enemy);

  /* Shouldering past earns a stretch of road nothing may block on. Without it
     the release and the next engagement happen on the same tick, the window
     resets, and the enemy is held forever — the stall-lock this valve exists
     to prevent, reintroduced by the valve itself. */
  if (lapsed) {
    enemies.blockReadyDist[enemy] = (enemies.pathDist[enemy] as number) + BLOCK_WINDOW * 2;
  }

  if (gone || lapsed || outOfReach) release(world, slot);
}

/** Lets an enemy go and returns the soldier to its rally. */
export function release(world: World, slot: number): void {
  const soldiers = world.soldiers;
  const enemy = soldiers.engagedWith[slot] as number;

  if (enemy >= 0 && world.enemies.isAlive(enemy)) {
    if ((world.enemies.blockedBy[enemy] as number) === slot) {
      world.enemies.blockedBy[enemy] = -1;
      world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked;
    }
  }

  soldiers.engagedWith[slot] = -1;
  soldiers.flags[slot] = (soldiers.flags[slot] as number) & ~SoldierFlag.Engaged;
}

function withinReach(world: World, slot: number, enemy: number): boolean {
  const soldiers = world.soldiers;
  const dx = (world.enemies.x[enemy] as number) - (soldiers.x[slot] as number);
  const dy = (world.enemies.y[enemy] as number) - (soldiers.y[slot] as number);
  const reach = (soldiers.attackRange[slot] as number) + BLOCK_WINDOW;
  return dx * dx + dy * dy <= reach * reach;
}

/**
 * Finds something to hold, and holds it.
 *
 * Nearest along the path rather than nearest in pixels, and only within the
 * blocking window — the distinction the whole system turns on. Flyers are
 * skipped outright: they are not on the road, so there is nothing to stand in
 * front of.
 */
function engageSomething(world: World, slot: number): boolean {
  const soldiers = world.soldiers;
  const enemies = world.enemies;

  const soldierPath = soldiers.pathId[slot] as number;
  const soldierDist = soldiers.pathDist[slot] as number;

  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;

  for (let enemy = 0; enemy < enemies.watermark; enemy++) {
    if (!enemies.isAlive(enemy)) continue;
    if ((enemies.blockedBy[enemy] as number) >= 0) continue;

    const flags = enemies.flags[enemy] as number;
    /* Ground only. A flyer passes overhead and a burrowed enemy underneath;
       neither can be stood in front of. */
    if ((flags & (EnemyFlag.Flying | EnemyFlag.Burrowed)) !== 0) continue;
    if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0) continue;
    if ((enemies.pathId[enemy] as number) !== soldierPath) continue;

    /* Still walking off a block it broke out of. */
    if ((enemies.pathDist[enemy] as number) < (enemies.blockReadyDist[enemy] as number)) continue;

    const gap = Math.abs((enemies.pathDist[enemy] as number) - soldierDist);
    if (gap > BLOCK_WINDOW) continue;
    if (!withinReach(world, slot, enemy)) continue;

    if (gap < bestGap) {
      bestGap = gap;
      best = enemy;
    }
  }

  if (best < 0) return false;
  engage(world, slot, best);
  return true;
}

function engage(world: World, slot: number, enemy: number): void {
  const soldiers = world.soldiers;
  const enemies = world.enemies;

  soldiers.engagedWith[slot] = enemy;
  soldiers.flags[slot] = (soldiers.flags[slot] as number) | SoldierFlag.Engaged;

  enemies.blockedBy[enemy] = slot;
  enemies.flags[enemy] = (enemies.flags[enemy] as number) | EnemyFlag.Blocked;
  /* Set once, at the start, and never refreshed: the window is the whole
     engagement, not a fresh grant on every swing. */
  const typeIdx = enemies.typeIdx[enemy] as number;
  enemies.blockUntilTick[enemy] =
    world.tick + (world.rules.enemies.maxBlockTicks[typeIdx] as number);
  enemies.meleeReadyTick[enemy] =
    world.tick + (world.rules.enemies.meleeIntervalTicks[typeIdx] as number);
}

/** Both sides swing on their own timers, as §7.7 specifies. */
function fight(world: World, slot: number): void {
  const soldiers = world.soldiers;
  const enemy = soldiers.engagedWith[slot] as number;

  const cooldown = (soldiers.cooldown[slot] as number) - 1;
  soldiers.cooldown[slot] = cooldown;
  if (cooldown <= 0) {
    soldiers.cooldown[slot] = soldiers.attackInterval[slot] as number;
    swingAtEnemy(world, slot, enemy);
  }

  if (world.tick >= (world.enemies.meleeReadyTick[enemy] as number)) {
    const typeIdx = world.enemies.typeIdx[enemy] as number;
    world.enemies.meleeReadyTick[enemy] =
      world.tick + (world.rules.enemies.meleeIntervalTicks[typeIdx] as number);
    swingAtSoldier(world, enemy, slot);
  }
}

/**
 * A soldier's blow, into the shared damage queue like every other source.
 *
 * Not applied directly, so a soldier's kill pays bounty, splits a splitter and
 * triggers a reaction through exactly the path a tower's shot takes.
 */
function swingAtEnemy(world: World, slot: number, enemy: number): void {
  const soldiers = world.soldiers;
  const damage = soldiers.damage[slot] as number;
  if (damage <= 0) return;

  const tower = soldiers.sourceTower[slot] as number;
  const stats = tower >= 0 && world.towers.isAlive(tower) ? statIndexOf(world, tower) : -1;
  const statusId = stats >= 0 ? (world.rules.towers.soldierStatusId[stats] as number) : 255;
  let statusStacks = stats >= 0 ? (world.rules.towers.soldierStatusStacks[stats] as number) : 0;

  /* A Resonance node under a barracks has to reach the soldiers: they are that
     tower's only way of hitting anything, and a node that granted a garrison
     nothing would be dead ground for one of the eight towers. */
  const ley = stats >= 0 ? (world.towers.leyNode[tower] as number) : -1;
  if (ley >= 0 && statusId < 255) {
    statusStacks += world.rules.ley.statusStacks[ley] as number;
  }

  world.damage.push(
    enemy,
    damage,
    soldiers.damageType[slot] as number,
    -1,
    DamageFlag.None,
    statusId,
    statusStacks,
  );
}

/**
 * The enemy hitting back.
 *
 * Resolved here rather than through the damage queue, which only carries
 * damage aimed at enemies. Soldiers are the one thing in the game that takes
 * damage without being one, and giving the queue a second target kind would
 * complicate every consumer of it for one caller.
 */
function swingAtSoldier(world: World, enemy: number, slot: number): void {
  const typeIdx = world.enemies.typeIdx[enemy] as number;
  const raw = world.rules.enemies.meleeDamage[typeIdx] as number;
  if (raw <= 0) return;

  const soldiers = world.soldiers;
  const armour = soldiers.armour[slot] as number;
  const half = world.rules.tuning.defenceHalfPoint;
  /* The same shape as the enemy damage formula, so armour means the same thing
     on both sides of a fight. */
  const dealt = raw * (1 - armour / (armour + half));

  const hp = (soldiers.hp[slot] as number) - dealt;
  soldiers.hp[slot] = hp;
  if (hp <= 0) fall(world, slot);
}

/** A soldier goes down, releases what it held, and starts its own timer. */
function fall(world: World, slot: number): void {
  release(world, slot);

  const soldiers = world.soldiers;
  const tower = soldiers.sourceTower[slot] as number;
  const stats = tower >= 0 && world.towers.isAlive(tower) ? statIndexOf(world, tower) : -1;

  /* The hero comes back at the Core on its own timer, which the hero system
     owns; it keeps its slot so nothing else has to rediscover which one it is. */
  if (((soldiers.flags[slot] as number) & SoldierFlag.Hero) !== 0) {
    soldiers.hp[slot] = 0;
    soldiers.flags[slot] = SoldierFlag.Alive | SoldierFlag.Hero | SoldierFlag.Respawning;
    beginHeroRespawn(world);
    return;
  }

  /* Ownerless and not the hero — a soldier whose barracks was sold. Nothing
     brings it back, so the slot is returned. */
  if (stats < 0) {
    soldiers.free(slot);
    return;
  }

  soldiers.hp[slot] = 0;
  soldiers.respawnIn[slot] = world.rules.towers.soldierRespawnTicks[stats] as number;
  soldiers.flags[slot] = SoldierFlag.Alive | SoldierFlag.Respawning;
}

/**
 * Walks back toward the rally point, healing if the tier grants it.
 *
 * Regeneration happens only here, which is what "out of combat" means: a
 * soldier being hit is never in this branch.
 */
function walkToRally(world: World, slot: number): void {
  const soldiers = world.soldiers;

  const tower = soldiers.sourceTower[slot] as number;
  if (tower >= 0 && world.towers.isAlive(tower)) {
    const regen = world.rules.towers.soldierRegenPerTick[statIndexOf(world, tower)] as number;
    if (regen > 0) {
      const healed = (soldiers.hp[slot] as number) + regen;
      const max = soldiers.maxHp[slot] as number;
      soldiers.hp[slot] = healed > max ? max : healed;
    }
  }

  const dx = (soldiers.rallyX[slot] as number) - (soldiers.x[slot] as number);
  const dy = (soldiers.rallyY[slot] as number) - (soldiers.y[slot] as number);
  const distance = Math.hypot(dx, dy);

  const step = WALK_SPEED * TICK_SECONDS;
  if (distance <= step) {
    soldiers.x[slot] = soldiers.rallyX[slot] as number;
    soldiers.y[slot] = soldiers.rallyY[slot] as number;
    return;
  }

  soldiers.x[slot] = (soldiers.x[slot] as number) + (dx / distance) * step;
  soldiers.y[slot] = (soldiers.y[slot] as number) + (dy / distance) * step;
}

/**
 * Moves a barracks' rally flag, clamped to its range.
 *
 * Soldiers already holding something let go: a player dragging the flag is
 * telling them to be somewhere else, and a soldier that kept its grip from
 * across the map would be the stall-lock bug wearing a different hat.
 */
export function moveRally(world: World, tower: number, x: number, y: number): boolean {
  if (!world.towers.isAlive(tower)) return false;

  const stats = statIndexOf(world, tower);
  const range = world.rules.towers.rallyRange[stats] as number;
  if (range <= 0) return false;

  const towerX = world.towers.x[tower] as number;
  const towerY = world.towers.y[tower] as number;
  const dx = x - towerX;
  const dy = y - towerY;
  const distance = Math.hypot(dx, dy);

  const clampedX = distance <= range ? x : towerX + (dx / distance) * range;
  const clampedY = distance <= range ? y : towerY + (dy / distance) * range;

  world.towers.rallyX[tower] = clampedX;
  world.towers.rallyY[tower] = clampedY;

  const soldiers = world.soldiers;
  for (let slot = 0; slot < soldiers.watermark; slot++) {
    if (!soldiers.isAlive(slot)) continue;
    if ((soldiers.sourceTower[slot] as number) !== tower) continue;
    release(world, slot);
    setRallyPoint(world, slot, clampedX, clampedY);
  }
  return true;
}
