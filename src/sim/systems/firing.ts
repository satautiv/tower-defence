import { TICK_HZ } from '@core/constants';
import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DamageFlag } from '../damage.js';
import { EnemyFlag, ProjectileFlag, TowerPerk } from '../flags.js';
import { emitProjectileFired } from '../events.js';
import { FiringMode } from '../ruleset.js';
import { STATUS_COUNT, STATUS_INDEX } from '../status.js';
import { statIndexOf } from '../towers.js';
import { createGroundEffect } from './groundEffects.js';
import { applyStatus } from './status.js';
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

const FREEZE = STATUS_INDEX.freeze;

/**
 * Reused for every patch of ground a tower leaves (#32).
 *
 * `createGroundEffect` takes a spec object, and a Firestorm Cannon lays one on
 * every shell — several a second. Mutating one module-level object keeps that
 * out of the allocation budget the tick loop is held to.
 */
const groundSpec = {
  x: 0,
  y: 0,
  radiusTiles: 0,
  seconds: 0,
  damagePerSecond: 0,
  damageType: 0,
  statusId: 255,
  statusStacks: 0,
  sourceTower: -1,
};

/**
 * Lays the patch a `leaves_ground` tower leaves behind, at a given point.
 *
 * Firestorm Cannon drops it where the shell lands and Arc Net keeps one under
 * itself, which is the whole difference between the two: one denies the ground
 * you aimed at, the other denies the ground it stands on.
 */
export function layTowerGround(
  world: World,
  towerSlot: number,
  stats: number,
  x: number,
  y: number,
): void {
  const table = world.rules.towers;
  if (((table.perks[stats] as number) & TowerPerk.LeavesGround) === 0) return;

  const seconds = (table.groundTicks[stats] as number) / TICK_HZ;
  if (seconds <= 0) return;

  groundSpec.x = x;
  groundSpec.y = y;
  groundSpec.radiusTiles = table.groundRadiusTiles[stats] as number;
  groundSpec.seconds = seconds;
  groundSpec.damagePerSecond = table.groundDamagePerSecond[stats] as number;
  groundSpec.damageType = table.damageType[stats] as number;
  /* The same status the tower's own hits carry, so a burning pool scorches and
     an arc field charges without either needing its own authored payload. */
  groundSpec.statusId = table.statusId[stats] as number;
  groundSpec.statusStacks = table.statusStacks[stats] as number;
  groundSpec.sourceTower = towerSlot;

  createGroundEffect(world, groundSpec);
}

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

    /* The tower's resolved interval, not the tier's. Damage and range have
       always been read from the pool; this one line still read the table, so a
       Flux ley node quoted a faster rate in the panel and fired at the old one.
       A Nullifier's aura divides in here too, so suppression is a longer wait
       for the next shot rather than a shot that never happens (#29). */
    towers.cooldown[slot] =
      (towers.fireInterval[slot] as number) / (towers.auraFireRate[slot] as number);
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
    /* The tower's resolved count, not the tier's: a Resonance node has already
       added its stack, and reading the table here would drop it. */
    world.towers.statusStacks[towerSlot] as number,
  );
}

/** Resolves this tick. Nothing to dodge, which is what makes beams beat evasion. */
function fireBeam(world: World, towerSlot: number, stats: number, target: number): void {
  const perks = world.rules.towers.perks[stats] as number;
  const damage =
    (world.towers.damage[towerSlot] as number) *
    ((perks & TowerPerk.Refracts) !== 0 ? refractionBonus(world, towerSlot, stats) : 1);

  if ((perks & TowerPerk.Piercing) === 0) {
    queueHit(world, stats, target, towerSlot, damage);
    return;
  }
  firePiercingBeam(world, towerSlot, stats, target, damage);
}

/**
 * Prism Tower's refraction (#32) — the acceptance criterion the issue names.
 *
 * *"Correctly detects distinct damage types from towers within 3 tiles and
 * adds them to its beams."* Counted as **distinct types**, not as neighbours:
 * three Flame Vents are one colour of light and must be worth what one is,
 * while a Flame Vent, a Frost Cairn and a Tesla Coil are three.
 *
 * This is the most pillar-P1 tower in the game — its entire value is that a
 * *mixed* board makes it better, so a player who spams one tower gets a Prism
 * Tower worth nothing and cannot buy their way out of it. That is why the
 * count is of types and why its own type does not count: a Prism Tower beside
 * another Prism Tower has learned nothing.
 *
 * Recomputed per shot rather than cached, so selling a neighbour is felt on
 * the very next beam. At one beam a second against a handful of towers, the
 * sweep is cheaper than any invalidation scheme would be to keep correct.
 */
function refractionBonus(world: World, towerSlot: number, stats: number): number {
  const table = world.rules.towers;
  const radius = table.refractRadius[stats] as number;
  const perType = table.refractBonusPerType[stats] as number;
  if (radius <= 0 || perType <= 0) return 1;

  const towers = world.towers;
  const x = towers.x[towerSlot] as number;
  const y = towers.y[towerSlot] as number;
  const own = table.damageType[stats] as number;
  const radiusSq = radius * radius;

  /* A bitmask over damage types: distinctness for free, and no allocation. */
  let seen = 0;
  for (let other = 0; other < towers.watermark; other++) {
    if (other === towerSlot || !towers.isAlive(other)) continue;

    const dx = (towers.x[other] as number) - x;
    const dy = (towers.y[other] as number) - y;
    if (dx * dx + dy * dy > radiusSq) continue;

    /* The neighbour's *current* tier, so upgrading a neighbour into a new
       damage type is felt here without anything being told about it. */
    const type = table.damageType[statIndexOf(world, other)] as number;
    if (type === own) continue;
    seen |= 1 << type;
  }

  let types = 0;
  for (let bit = seen; bit !== 0; bit >>= 1) types += bit & 1;
  return 1 + perType * types;
}

/**
 * Plasma Lance: the beam does not stop at what it was aimed at (#32, §8.4).
 *
 * Everything within a lane's width of the line from tower to target is struck
 * for full damage. A line rather than a cone, because the branch's whole
 * identity is that it rewards *aiming down a column* — a cone would make it a
 * worse Pyroclast Vent instead of a different tower.
 *
 * The lane is the same width a pack spreads across, so a beam fired down the
 * road catches the road and not the enemies walking beside it.
 */
function firePiercingBeam(
  world: World,
  towerSlot: number,
  stats: number,
  target: number,
  damage: number,
): void {
  const enemies = world.enemies;
  const x = world.towers.x[towerSlot] as number;
  const y = world.towers.y[towerSlot] as number;

  let dirX = (enemies.x[target] as number) - x;
  let dirY = (enemies.y[target] as number) - y;
  const length = Math.hypot(dirX, dirY);
  if (length === 0) {
    queueHit(world, stats, target, towerSlot, damage);
    return;
  }
  dirX /= length;
  dirY /= length;

  const range = world.towers.range[towerSlot] as number;
  const halfWidth = world.rules.laneWidth;

  for (const index of [world.groundIndex, world.airIndex]) {
    const count = index.query(x, y, range, found);
    for (let i = 0; i < count; i++) {
      const slot = found[i] as number;
      if (!canTarget(world, towerSlot, slot)) continue;

      const dx = (enemies.x[slot] as number) - x;
      const dy = (enemies.y[slot] as number) - y;
      /* Distance along the beam; behind the tower does not count. */
      const along = dx * dirX + dy * dirY;
      if (along < 0 || along > range) continue;

      /* Perpendicular distance from the line. */
      const across = Math.abs(dx * dirY - dy * dirX);
      if (across > halfWidth) continue;

      queueHit(world, stats, slot, towerSlot, damage);
    }
  }
}

/**
 * Extra jumps a chain earns from the statuses already on the enemy it strikes.
 *
 * Charge is the one that does this today: "+1 chain target per 2 stacks",
 * authored as 0.5 per stack and floored, so an odd stack alone buys nothing.
 * Read from the first target rather than recomputed at every hop — the player
 * has to be able to look at one charged enemy and know the chain will go
 * further, which a bonus that shifted mid-arc would not give them.
 */
function bonusChainTargets(world: World, target: number): number {
  const table = world.rules.statuses;
  let bonus = 0;
  for (let status = 0; status < STATUS_COUNT; status++) {
    const per = table.chainTargetsPerStack[status] as number;
    if (per > 0) bonus += per * world.enemies.stacksOf(target, status);
  }
  return Math.floor(bonus);
}

/**
 * Walks outward from the first target, losing a fraction of its damage each
 * jump and never striking the same enemy twice — a chain that could double back
 * would deal unbounded damage to a lone target.
 */
function fireChain(world: World, towerSlot: number, stats: number, target: number): void {
  const table = world.rules.towers;
  const reach = (table.chainTargets[stats] as number) + bonusChainTargets(world, target);
  const jumps = Math.min(reach, visited.length - 1);
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

  const table = world.rules.towers;
  const perks = table.perks[stats] as number;
  const freezes = (perks & TowerPerk.FreezePulse) !== 0 && dueToFreeze(world, towerSlot, stats);
  const pull = (perks & TowerPerk.Pulls) !== 0 ? (table.pullDistance[stats] as number) : 0;

  let hits = 0;
  for (const index of [world.groundIndex, world.airIndex]) {
    const count = index.query(x, y, range, found);
    for (let i = 0; i < count; i++) {
      const slot = found[i] as number;
      if (!canTarget(world, towerSlot, slot)) continue;
      queueHit(world, stats, slot, towerSlot, damage);

      /* Glacier Heart's pulse: a hard stop on everything in reach, on its own
         slower clock than the damage. Through `applyStatus`, so a boss shrugs
         it off exactly as it shrugs off any other Freeze. */
      if (freezes) applyStatus(world, slot, FREEZE, 1, towerSlot);
      if (pull > 0) dragBack(world, slot, pull);
      hits++;
    }
  }

  /* Arc Net keeps a field under itself. Laid even on a pulse that hit nothing,
     because the point of the branch is that the ground stays dangerous after
     the wave has gone past. */
  layTowerGround(world, towerSlot, stats, x, y);
  return hits > 0;
}

/**
 * Whether a freeze-pulse tower's hard stop is due.
 *
 * On its own timer rather than every shot: Glacier Heart's aura fires several
 * times a second and a Siege Howitzer lands a shell every two, and a Freeze on
 * each would be a permanent stop — the one thing §10 says no single tower may
 * do. The timer is what makes it punctuation.
 *
 * Shared by the aura and the shell, because "stun on a cadence" is one
 * mechanic wearing two silhouettes.
 */
export function dueToFreeze(world: World, towerSlot: number, stats: number): boolean {
  const every = world.rules.towers.freezePulseTicks[stats] as number;
  if (every <= 0) return false;
  if (world.tick < (world.towers.perkReadyTick[towerSlot] as number)) return false;

  world.towers.perkReadyTick[towerSlot] = world.tick + every;
  return true;
}

/**
 * Void Obelisk dragging an enemy back down the road.
 *
 * Path distance, not position: `pathDist` is authoritative and pulling in
 * pixels would put an enemy beside the road rather than behind on it. Clamped
 * at zero, and it never releases a block — an enemy a soldier is holding is
 * being held, and two systems disagreeing about where it is would be worse
 * than the pull not applying.
 */
function dragBack(world: World, slot: number, distance: number): void {
  const enemies = world.enemies;
  const moved = (enemies.pathDist[slot] as number) - distance;
  enemies.pathDist[slot] = moved < 0 ? 0 : moved;
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
  projectiles.statusStacks[slot] = world.towers.statusStacks[towerSlot] as number;
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
