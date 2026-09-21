import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DamageFlag } from '../damage.js';
import { ProjectileFlag } from '../flags.js';
import { canTargetAny } from './targeting.js';
import { statIndexOf } from '../towers.js';
import { dueToFreeze, layTowerGround } from './firing.js';
import { applyStatus } from './status.js';
import { STATUS_INDEX } from '../status.js';
import { TowerPerk } from '../flags.js';
import type { World } from '../world.js';

/**
 * Advances shots and resolves what they hit.
 *
 * Projectiles have real travel time, which is what makes leading a target
 * matter and gives a fast enemy a genuine chance to outrun a slow shell.
 * Nothing here applies damage; it is queued and resolved in one place (#14).
 */

const found = new Int32Array(MAX_QUERY_RESULTS);

/** A shot counts as landed within this many pixels of its aim point. */
const IMPACT_RADIUS = 10;

export function projectileSystem(world: World): void {
  const projectiles = world.projectiles;

  for (let slot = 0; slot < projectiles.watermark; slot++) {
    if (!projectiles.isAlive(slot)) continue;

    projectiles.ttl[slot] = (projectiles.ttl[slot] as number) - 1;
    if ((projectiles.ttl[slot] as number) <= 0) {
      projectiles.free(slot);
      continue;
    }

    const flags = projectiles.flags[slot] as number;
    const homing = (flags & ProjectileFlag.Ballistic) === 0;
    const target = projectiles.target[slot] as number;

    /* A homing shot whose target died keeps flying to where it was aimed
       rather than vanishing — the shell is already in the air. */
    if (homing && target >= 0 && world.enemies.isAlive(target)) {
      steerToward(
        world,
        slot,
        world.enemies.x[target] as number,
        world.enemies.y[target] as number,
      );
    }

    projectiles.x[slot] = (projectiles.x[slot] as number) + (projectiles.vx[slot] as number);
    projectiles.y[slot] = (projectiles.y[slot] as number) + (projectiles.vy[slot] as number);

    if (hasArrived(world, slot, homing, target)) {
      detonate(world, slot, homing ? target : -1);
      projectiles.free(slot);
    }
  }
}

function steerToward(world: World, slot: number, x: number, y: number): void {
  const projectiles = world.projectiles;
  const dx = x - (projectiles.x[slot] as number);
  const dy = y - (projectiles.y[slot] as number);
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;

  const speed = Math.hypot(projectiles.vx[slot] as number, projectiles.vy[slot] as number);
  projectiles.vx[slot] = (dx / distance) * speed;
  projectiles.vy[slot] = (dy / distance) * speed;
}

function hasArrived(world: World, slot: number, homing: boolean, target: number): boolean {
  const projectiles = world.projectiles;
  const x = projectiles.x[slot] as number;
  const y = projectiles.y[slot] as number;

  if (homing && target >= 0 && world.enemies.isAlive(target)) {
    const dx = (world.enemies.x[target] as number) - x;
    const dy = (world.enemies.y[target] as number) - y;
    return dx * dx + dy * dy <= IMPACT_RADIUS * IMPACT_RADIUS;
  }

  const dx = (projectiles.targetX[slot] as number) - x;
  const dy = (projectiles.targetY[slot] as number) - y;
  return dx * dx + dy * dy <= IMPACT_RADIUS * IMPACT_RADIUS;
}

function detonate(world: World, slot: number, directTarget: number): void {
  const projectiles = world.projectiles;
  const damage = projectiles.damage[slot] as number;
  const type = projectiles.damageType[slot] as number;
  const source = projectiles.sourceTower[slot] as number;

  /* Firestorm Cannon's burning pool, where the shell actually landed rather
     than where it was aimed — a mortar leads its target, and a pool that
     appeared at the aim point would sit behind the pack it was meant to
     catch (#32). */
  let stunning = false;
  if (source >= 0 && world.towers.isAlive(source)) {
    const stats = statIndexOf(world, source);
    layTowerGround(
      world,
      source,
      stats,
      projectiles.x[slot] as number,
      projectiles.y[slot] as number,
    );
    /* Siege Howitzer's stun, on the same cadence Glacier Heart's freeze uses:
       a shell that stopped a pack every time would end the stage (#32). */
    stunning =
      ((world.rules.towers.perks[stats] as number) & TowerPerk.FreezePulse) !== 0 &&
      dueToFreeze(world, source, stats);
  }
  const pierce = projectiles.armourPierce[slot] as number;
  const statusId = projectiles.statusId[slot] as number;
  const stacks = projectiles.statusStacks[slot] as number;
  const flags =
    pierce > 0 ? DamageFlag.ArmourPierce | DamageFlag.CanShatter : DamageFlag.CanShatter;

  const splash = projectiles.splashRadius[slot] as number;
  if (splash <= 0) {
    if (directTarget >= 0) {
      world.damage.push(directTarget, damage, type, source, flags, statusId, stacks);
      if (stunning) applyStatus(world, directTarget, STATUS_INDEX.freeze, 1, source);
    }
    return;
  }

  const x = projectiles.x[slot] as number;
  const y = projectiles.y[slot] as number;

  for (const index of [world.groundIndex, world.airIndex]) {
    const count = index.query(x, y, splash, found);
    for (let i = 0; i < count; i++) {
      const enemy = found[i] as number;
      if (!canTargetAny(world, source, enemy)) continue;
      /* The direct hit carries the status; splash victims take damage only, so
         one shell cannot stack a status across a whole pack. */
      const direct = enemy === directTarget;
      world.damage.push(
        enemy,
        damage,
        type,
        source,
        direct ? flags : flags | DamageFlag.NoStatus,
        direct ? statusId : 255,
        direct ? stacks : 0,
      );
      /* The whole blast is stopped, not only what it was aimed at — a siege
         weapon that stunned one enemy in a pack would not be a siege weapon. */
      if (stunning) applyStatus(world, enemy, STATUS_INDEX.freeze, 1, source);
    }
  }
}
