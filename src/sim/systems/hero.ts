import { DamageFlag } from '../damage.js';
import { runEffects } from '../effects.js';
import { EnemyFlag, SoldierFlag } from '../flags.js';
import { release, setRallyPoint } from './soldiers.js';
import type { World } from '../world.js';

/**
 * The hero (#25, docs/GAME_DESIGN.md §11).
 *
 * The feature that turns the player from an architect into a participant: a
 * single unit they command directly, which plugs the hole their build did not
 * anticipate. Not stronger than a tower — *flexible*. The balance target is
 * roughly one tier-3 tower's damage plus a Barracks' utility.
 *
 * **It lives in the soldier pool and blocks through the soldier code path**,
 * with better numbers and a flag. That is not a shortcut; it is the whole
 * design. Blocking is the subtlest system in the genre and a second
 * implementation of it would drift from the first within a month — so the
 * hero engages, holds, releases and falls exactly as a soldier does, and this
 * file owns only what is genuinely different: being commanded, striking at
 * range, casting, and coming back at the Core.
 */

/** Pixels per second the hero walks to where it was sent. Brisker than a soldier. */
const HERO_SPEED = 150;

export function heroSystem(world: World): void {
  const hero = world.rules.hero;
  if (hero === null) return;

  if (world.heroSlot < 0) {
    deploy(world);
    return;
  }

  const slot = world.heroSlot;
  if (((world.soldiers.flags[slot] as number) & SoldierFlag.Respawning) !== 0) {
    tickRespawn(world);
    return;
  }

  march(world, slot);
  autoAttack(world, slot);
}

/** Puts the hero on the board at the Core, once. */
function deploy(world: World): void {
  const hero = world.rules.hero;
  if (hero === null) return;

  const soldiers = world.soldiers;
  const slot = soldiers.alloc();
  if (slot < 0) return;

  soldiers.sourceTower[slot] = -1;
  soldiers.maxHp[slot] = hero.hp;
  soldiers.hp[slot] = hero.hp;
  soldiers.armour[slot] = hero.armour;
  soldiers.damage[slot] = hero.damage;
  soldiers.damageType[slot] = hero.damageType;
  soldiers.attackInterval[slot] = hero.attackIntervalTicks;
  soldiers.attackRange[slot] = hero.attackRange;
  soldiers.cooldown[slot] = 0;
  soldiers.engagedWith[slot] = -1;
  soldiers.flags[slot] = SoldierFlag.Alive | SoldierFlag.Hero;

  soldiers.x[slot] = world.rules.core.x;
  soldiers.y[slot] = world.rules.core.y;
  setRallyPoint(world, slot, world.rules.core.x, world.rules.core.y);

  world.heroSlot = slot;
}

/**
 * Counts down and returns the hero to the Core.
 *
 * At the Core rather than where it fell, which is what makes dying cost
 * position as well as time — the player has to walk it back to wherever the
 * trouble was.
 */
function tickRespawn(world: World): void {
  const hero = world.rules.hero;
  const slot = world.heroSlot;
  if (hero === null || slot < 0) return;

  world.heroRespawnIn -= 1;
  if (world.heroRespawnIn > 0) return;

  const soldiers = world.soldiers;
  soldiers.hp[slot] = hero.hp;
  soldiers.x[slot] = world.rules.core.x;
  soldiers.y[slot] = world.rules.core.y;
  soldiers.flags[slot] = SoldierFlag.Alive | SoldierFlag.Hero;
  world.heroRespawnIn = 0;

  /* Forgets the last order: a hero that walked straight back into whatever
     killed it would be obeying an instruction the player gave a different
     situation. */
  world.heroOrdered = false;
  setRallyPoint(world, slot, world.rules.core.x, world.rules.core.y);
}

/**
 * Walks toward where the player sent it.
 *
 * The soldier system walks soldiers to their rally, but only while they are
 * not engaged — which is right for a garrison holding a line and wrong for a
 * hero being told to go somewhere else. An order overrides an engagement,
 * because that is the entire point of commanding one.
 */
function march(world: World, slot: number): void {
  if (!world.heroOrdered) return;

  const soldiers = world.soldiers;
  const dx = world.heroOrderX - (soldiers.x[slot] as number);
  const dy = world.heroOrderY - (soldiers.y[slot] as number);
  const distance = Math.hypot(dx, dy);

  if (distance <= 1) {
    world.heroOrdered = false;
    return;
  }
  /* Engaged heroes hold position: the soldier system is fighting with this
     body and moving it would drag the block along with it. */
  if (((soldiers.flags[slot] as number) & SoldierFlag.Engaged) !== 0) return;

  const step = HERO_SPEED / 60;
  if (distance <= step) {
    soldiers.x[slot] = world.heroOrderX;
    soldiers.y[slot] = world.heroOrderY;
    world.heroOrdered = false;
    return;
  }

  soldiers.x[slot] = (soldiers.x[slot] as number) + (dx / distance) * step;
  soldiers.y[slot] = (soldiers.y[slot] as number) + (dy / distance) * step;
}

/**
 * Strikes the nearest enemy in range, whether or not it is holding one.
 *
 * A hero with a three-tile reach should be shooting while it walks, not only
 * while something has run into it. When it *is* engaged the soldier system
 * already swings for it, so this stands down rather than letting it hit twice.
 */
function autoAttack(world: World, slot: number): void {
  const soldiers = world.soldiers;
  if (((soldiers.flags[slot] as number) & SoldierFlag.Engaged) !== 0) return;

  const cooldown = (soldiers.cooldown[slot] as number) - 1;
  soldiers.cooldown[slot] = cooldown;
  if (cooldown > 0) return;

  const target = nearestEnemy(world, slot);
  if (target < 0) return;

  soldiers.cooldown[slot] = soldiers.attackInterval[slot] as number;
  world.damage.push(
    target,
    soldiers.damage[slot] as number,
    soldiers.damageType[slot] as number,
    -1,
    DamageFlag.None,
  );
}

/**
 * The closest enemy the hero can reach, ground or air.
 *
 * A linear scan: there is exactly one hero, so the spatial index would cost
 * more to consult than the scan costs to run at these counts.
 */
function nearestEnemy(world: World, slot: number): number {
  const soldiers = world.soldiers;
  const enemies = world.enemies;
  const x = soldiers.x[slot] as number;
  const y = soldiers.y[slot] as number;
  const range = soldiers.attackRange[slot] as number;

  let best = -1;
  let bestSq = range * range;

  for (let enemy = 0; enemy < enemies.watermark; enemy++) {
    if (!enemies.isAlive(enemy)) continue;
    const flags = enemies.flags[enemy] as number;
    if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked | EnemyFlag.Burrowed)) !== 0) continue;

    const dx = (enemies.x[enemy] as number) - x;
    const dy = (enemies.y[enemy] as number) - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= bestSq) {
      bestSq = distanceSq;
      best = enemy;
    }
  }
  return best;
}

/**
 * Sends the hero somewhere.
 *
 * Any point, not only a path: §11 says tap anywhere, and a hero that refused
 * to stand off the road could not be parked out of trouble while it heals.
 */
export function orderHero(world: World, x: number, y: number): boolean {
  const slot = world.heroSlot;
  if (slot < 0 || !world.soldiers.isAlive(slot)) return false;
  if (((world.soldiers.flags[slot] as number) & SoldierFlag.Respawning) !== 0) return false;

  world.heroOrderX = x;
  world.heroOrderY = y;
  world.heroOrdered = true;

  /* Through the soldier system's own release rather than by clearing the
     flag here: letting go has two sides, and clearing only the soldier's left
     the enemy marked as held by a hero that had walked away — frozen for good.
     The same release valve #24 built, used rather than re-implemented. */
  release(world, slot);
  /* The rally comes with it, so the soldier system knows which stretch of road
     this body may legitimately block. */
  setRallyPoint(world, slot, x, y);
  return true;
}

export const enum HeroCastResult {
  Cast = 0,
  NoHero,
  NoSuchAbility,
  OnCooldown,
  Dead,
}

/**
 * Casts one of the hero's three abilities.
 *
 * On their own cooldowns and **not** gated by Aether Charge (§11): the hero is
 * the player's own agency, and making it compete with Warden Powers for the
 * same pool would turn two decisions into one.
 */
export function castHeroAbilityAt(
  world: World,
  abilityIdx: number,
  x: number,
  y: number,
): HeroCastResult {
  const hero = world.rules.hero;
  if (hero === null || world.heroSlot < 0) return HeroCastResult.NoHero;
  if (abilityIdx < 0 || abilityIdx >= hero.abilityIds.length) return HeroCastResult.NoSuchAbility;

  const slot = world.heroSlot;
  if (((world.soldiers.flags[slot] as number) & SoldierFlag.Respawning) !== 0) {
    return HeroCastResult.Dead;
  }
  if (world.tick < (world.heroAbilityReadyTick[abilityIdx] as number)) {
    return HeroCastResult.OnCooldown;
  }

  world.heroAbilityReadyTick[abilityIdx] =
    world.tick + (hero.abilityCooldownTicks[abilityIdx] as number);
  runEffects(world, hero.abilityEffects[abilityIdx] ?? [], x, y);
  return HeroCastResult.Cast;
}

/** Starts the hero's death clock. Called by the soldier system when it falls. */
export function beginHeroRespawn(world: World): void {
  const hero = world.rules.hero;
  if (hero === null) return;
  world.heroRespawnIn = hero.respawnTicks;
}
