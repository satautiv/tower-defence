import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DamageFlag } from '../damage.js';
import { EnemyFlag, ProjectileFlag } from '../flags.js';
import { emitProjectileFired } from '../events.js';
import { FiringMode } from '../ruleset.js';
import { statIndexOf } from '../towers.js';
import { canTarget } from './targeting.js';
import type { World } from '../world.js';

/**
 * Turns a chosen target into damage.
 *
 * Five modes, because the tower roster genuinely behaves five ways and faking
 * it with one would make every tower feel the same. Nothing here applies damage
 * directly: every mode pushes onto the shared damage queue, so a kill resolves
 * in one place after the whole tick has had its say (#14).
 */

const found = new Int32Array(MAX_QUERY_RESULTS);
/** Enemies a chain has already struck, so it cannot double back. */
const visited = new Int32Array(64);

export function firingSystem(world: World): void {
  const towers = world.towers;

  for (let slot = 0; slot < towers.watermark; slot++) {
    if (!towers.isAlive(slot)) continue;
    if ((towers.cooldown[slot] as number) > 0) continue;
    if ((towers.disabledUntil[slot] as number) > world.tick) continue;

    const stats = statIndexOf(world, slot);
    const mode = world.rules.towers.firingMode[stats] as number;

    /* Area modes do not need a target — they sweep whatever is in reach — so
       they fire on cooldown regardless of what targeting picked. */
    const target = towers.target[slot] as number;
    if (mode !== FiringMode.Aura && (target < 0 || !canTarget(world, slot, target))) continue;

    switch (mode) {
      case FiringMode.Beam:
        fireBeam(world, slot, stats, target);
        break;
      case FiringMode.Chain:
        fireChain(world, slot, stats, target);
        break;
      case FiringMode.Aura:
        if (!firePulse(world, slot, stats)) continue;
        break;
      case FiringMode.Cone:
        fireCone(world, slot, stats, target);
        break;
      default:
        fireProjectile(world, slot, stats, target, mode === FiringMode.Ballistic);
        break;
    }

    towers.cooldown[slot] = world.rules.towers.fireIntervalTicks[stats] as number;
  }
}

function queueHit(
  world: World,
  stats: number,
  targetSlot: number,
  towerSlot: number,
  damage: number,
  flags = DamageFlag.None,
): void {
  const table = world.rules.towers;
  world.damage.push(
    targetSlot,
    damage,
    table.damageType[stats] as number,
    towerSlot,
    flags,
    table.statusId[stats] as number,
    table.statusStacks[stats] as number,
  );
}

/** Resolves this tick. Nothing to dodge, which is what makes beams beat evasion. */
function fireBeam(world: World, towerSlot: number, stats: number, target: number): void {
  queueHit(world, stats, target, towerSlot, world.towers.damage[towerSlot] as number);
}

/**
 * Walks outward from the first target, losing a fraction of its damage each
 * jump and never striking the same enemy twice — a chain that could double back
 * would deal unbounded damage to a lone target.
 */
function fireChain(world: World, towerSlot: number, stats: number, target: number): void {
  const table = world.rules.towers;
  const jumps = Math.min(table.chainTargets[stats] as number, visited.length - 1);
  const falloff = table.chainFalloff[stats] as number;
  const range = world.towers.range[towerSlot] as number;

  let damage = world.towers.damage[towerSlot] as number;
  let current = target;
  let seen = 0;

  visited[seen++] = current;
  queueHit(world, stats, current, towerSlot, damage);

  for (let jump = 0; jump < jumps; jump++) {
    damage *= falloff;
    const next = nearestUnvisited(world, current, range, visited, seen);
    if (next < 0) break;
    visited[seen++] = next;
    queueHit(world, stats, next, towerSlot, damage);
    current = next;
  }
}

function nearestUnvisited(
  world: World,
  fromSlot: number,
  range: number,
  exclude: Int32Array,
  excludeCount: number,
): number {
  const enemies = world.enemies;
  const x = enemies.x[fromSlot] as number;
  const y = enemies.y[fromSlot] as number;

  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const index of [world.groundIndex, world.airIndex]) {
    const count = index.query(x, y, range, found);
    for (let i = 0; i < count; i++) {
      const slot = found[i] as number;
      let skip = false;
      for (let e = 0; e < excludeCount; e++) {
        if ((exclude[e] as number) === slot) {
          skip = true;
          break;
        }
      }
      if (skip) continue;

      const dx = (enemies.x[slot] as number) - x;
      const dy = (enemies.y[slot] as number) - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = slot;
      }
    }
  }
  return best;
}

/** Hits everything in reach. Returns false when there is nothing to hit. */
function firePulse(world: World, towerSlot: number, stats: number): boolean {
  const range = world.towers.range[towerSlot] as number;
  const x = world.towers.x[towerSlot] as number;
  const y = world.towers.y[towerSlot] as number;
  const damage = world.towers.damage[towerSlot] as number;

  let hits = 0;
  for (const index of [world.groundIndex, world.airIndex]) {
    const count = index.query(x, y, range, found);
    for (let i = 0; i < count; i++) {
      const slot = found[i] as number;
      if (!canTarget(world, towerSlot, slot)) continue;
      queueHit(world, stats, slot, towerSlot, damage);
      hits++;
    }
  }
  return hits > 0;
}

/**
 * A wedge aimed at the current target.
 *
 * Containment is a dot product against the precomputed cosine of the half
 * angle, so a cone costs no trigonometry per enemy per tick.
 */
function fireCone(world: World, towerSlot: number, stats: number, target: number): void {
  const enemies = world.enemies;
  const x = world.towers.x[towerSlot] as number;
  const y = world.towers.y[towerSlot] as number;
  const range = world.towers.range[towerSlot] as number;

  let aimX = (enemies.x[target] as number) - x;
  let aimY = (enemies.y[target] as number) - y;
  const aimLength = Math.hypot(aimX, aimY);
  if (aimLength === 0) return;
  aimX /= aimLength;
  aimY /= aimLength;

  const cos = world.rules.towers.coneCos[stats] as number;
  const damage = world.towers.damage[towerSlot] as number;

  for (const index of [world.groundIndex, world.airIndex]) {
    const count = index.query(x, y, range, found);
    for (let i = 0; i < count; i++) {
      const slot = found[i] as number;
      if (!canTarget(world, towerSlot, slot)) continue;

      const dx = (enemies.x[slot] as number) - x;
      const dy = (enemies.y[slot] as number) - y;
      const length = Math.hypot(dx, dy);
      if (length === 0) {
        queueHit(world, stats, slot, towerSlot, damage);
        continue;
      }
      if ((dx * aimX + dy * aimY) / length >= cos) {
        queueHit(world, stats, slot, towerSlot, damage);
      }
    }
  }
}

/**
 * Launches a shell or a bolt.
 *
 * Both lead the target. A shot aimed where an enemy currently stands arrives
 * where it used to be, which for a slow mortar against a fast enemy is a miss
 * every time; solving for the intercept is what makes artillery feel aimed
 * rather than unlucky.
 */
function fireProjectile(
  world: World,
  towerSlot: number,
  stats: number,
  target: number,
  ballistic: boolean,
): void {
  const slot = world.projectiles.alloc();
  if (slot < 0) return;

  const table = world.rules.towers;
  const projectiles = world.projectiles;
  const enemies = world.enemies;

  const x = world.towers.x[towerSlot] as number;
  const y = world.towers.y[towerSlot] as number;
  const speed = table.projectileSpeed[stats] as number;

  const lead = leadTarget(world, x, y, target, speed);

  projectiles.x[slot] = x;
  projectiles.y[slot] = y;
  projectiles.damage[slot] = world.towers.damage[towerSlot] as number;
  projectiles.damageType[slot] = table.damageType[stats] as number;
  projectiles.splashRadius[slot] = table.splashRadius[stats] as number;
  projectiles.armourPierce[slot] = table.armourPierce[stats] as number;
  projectiles.statusId[slot] = table.statusId[stats] as number;
  projectiles.statusStacks[slot] = table.statusStacks[stats] as number;
  projectiles.sourceTower[slot] = towerSlot;

  const dx = lead.x - x;
  const dy = lead.y - y;
  const distance = Math.hypot(dx, dy) || 1;
  projectiles.vx[slot] = (dx / distance) * speed;
  projectiles.vy[slot] = (dy / distance) * speed;
  /* Generous, so a shot never expires before it could plausibly land. */
  projectiles.ttl[slot] = (distance / speed) * 2 + 30;

  if (ballistic) {
    /* A shell commits to the ground it was aimed at. Dodging it is the whole
       reason a mortar has a dead zone and a slow rate of fire. */
    projectiles.target[slot] = -1;
    projectiles.targetX[slot] = lead.x;
    projectiles.targetY[slot] = lead.y;
    projectiles.flags[slot] =
      (projectiles.flags[slot] as number) | ProjectileFlag.Ballistic | ProjectileFlag.Splash;
  } else {
    projectiles.target[slot] = target;
    projectiles.targetX[slot] = enemies.x[target] as number;
    projectiles.targetY[slot] = enemies.y[target] as number;
    if ((table.splashRadius[stats] as number) > 0) {
      projectiles.flags[slot] = (projectiles.flags[slot] as number) | ProjectileFlag.Splash;
    }
  }

  emitProjectileFired(world.events, projectiles.ids[slot] as number, towerSlot);
}

const intercept = { x: 0, y: 0 };

/**
 * Where to aim so the shot and the enemy arrive together.
 *
 * Two fixed-point passes: estimate the flight time from the present distance,
 * project the enemy forward, then re-estimate. That converges well inside a
 * pixel for these speeds and, unlike a closed-form solve, cannot produce a
 * complex root that has to be special-cased.
 */
function leadTarget(
  world: World,
  fromX: number,
  fromY: number,
  target: number,
  speed: number,
): { x: number; y: number } {
  const enemies = world.enemies;
  const ex = enemies.x[target] as number;
  const ey = enemies.y[target] as number;

  intercept.x = ex;
  intercept.y = ey;
  if (speed <= 0) return intercept;

  /* Velocity along the path, in pixels per tick. */
  const path = world.rules.pathById.get(enemies.pathId[target] as number);
  const moving = (enemies.flags[target] as number) & EnemyFlag.Blocked;
  if (moving !== 0) return intercept;

  const perTick = (enemies.speed[target] as number) / 60;
  let vx = 0;
  let vy = 0;
  if (path !== undefined) {
    const ahead = { x: 0, y: 0, dirX: 0, dirY: 0 };
    path.sample(enemies.pathDist[target] as number, ahead);
    vx = ahead.dirX * perTick;
    vy = ahead.dirY * perTick;
  }

  for (let pass = 0; pass < 2; pass++) {
    const time = Math.hypot(intercept.x - fromX, intercept.y - fromY) / speed;
    intercept.x = ex + vx * time;
    intercept.y = ey + vy * time;
  }
  return intercept;
}
