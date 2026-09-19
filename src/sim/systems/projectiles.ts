import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DamageFlag } from '../damage.js';
import { ProjectileFlag } from '../flags.js';
import { canTargetAny } from './targeting.js';
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
  const pierce = projectiles.armourPierce[slot] as number;
  const statusId = projectiles.statusId[slot] as number;
  const stacks = projectiles.statusStacks[slot] as number;
  const flags =
    pierce > 0 ? DamageFlag.ArmourPierce | DamageFlag.CanShatter : DamageFlag.CanShatter;

  const splash = projectiles.splashRadius[slot] as number;
  if (splash <= 0) {
    if (directTarget >= 0) {
      world.damage.push(directTarget, damage, type, source, flags, statusId, stacks);
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
    }
  }
}
