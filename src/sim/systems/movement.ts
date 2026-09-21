import { TICK_SECONDS } from '@core/constants';
import { sinT } from '@core/trig';
import { EnemyFlag } from '../flags.js';
import { laneOffsetFor } from '../path.js';
import type { PathSample } from '../path.js';
import { STATUS_COUNT, STATUS_INDEX } from '../status.js';
import type { World } from '../world.js';

/**
 * Moves everything that follows a route.
 *
 * Ground enemies advance a scalar distance along a baked polyline; their x and
 * y are derived from it, never the other way round. Keeping `pathDist`
 * authoritative is what makes "how far along is this enemy" a single number —
 * which targeting modes, blocking windows and burrow segments all depend on,
 * and which would be ambiguous if position were primary.
 */

/** Reused across every enemy, so sampling a path allocates nothing. */
const sample: PathSample = { x: 0, y: 0, dirX: 0, dirY: 0 };

const FREEZE = STATUS_INDEX.freeze;

/** How far a flyer drifts off its line, and how fast, in pixels and radians. */
const WOBBLE_AMPLITUDE = 10;
const WOBBLE_RATE = 1.6;

/**
 * Slows never stop a normal enemy outright — that is what Freeze is for — and
 * bosses shrug most of it off, so a single Frost Cairn cannot trivialise an
 * encounter designed around movement (docs/GAME_DESIGN.md §10).
 */
const MAX_SLOW = 0.9;
const BOSS_MAX_SLOW = 0.25;

export function speedMultiplier(world: World, slot: number): number {
  const enemies = world.enemies;
  const flags = enemies.flags[slot] as number;

  if ((flags & EnemyFlag.FreezeImmune) === 0 && enemies.stacksOf(slot, FREEZE) > 0) return 0;

  /* Seven statuses, most with no slow at all — a flat scan is cheaper than the
     bookkeeping any index would need, at these counts. */
  const table = world.rules.statuses;
  let slow = 0;
  for (let status = 0; status < STATUS_COUNT; status++) {
    const per = table.slowPerStack[status] as number;
    if (per > 0) slow += per * enemies.stacksOf(slot, status);
  }

  const cap = (flags & EnemyFlag.Boss) !== 0 ? BOSS_MAX_SLOW : MAX_SLOW;
  const fromStatus = 1 - (slow > cap ? cap : slow);

  /* Ground slows multiply with status slows rather than sharing their cap: a
     Stasis Field is a different kind of thing from being Chilled, and the
     design sells it as the answer when Chill alone is not enough (#31).
     A Standard Bearer's haste multiplies in the same way and can push the
     result above 1 — it is a buff, and capping it at "not slowed" would make
     the escort worthless exactly when it matters (#29). */
  return fromStatus * (enemies.groundSlow[slot] as number) * (enemies.auraSpeed[slot] as number);
}

export function movementSystem(world: World): void {
  const enemies = world.enemies;

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;

    const flags = enemies.flags[slot] as number;
    /* Leaked enemies stay put until the lifecycle system collects them (#16);
       held ones stop advancing but still occupy their position. */
    if ((flags & (EnemyFlag.Leaked | EnemyFlag.Dying)) !== 0) continue;

    /* Standing in something that seals the road, e.g. a Rift Seal. Held like
       a blocked enemy, but by the ground rather than by a soldier. */
    if ((enemies.groundBlocked[slot] as number) === 0 && (flags & EnemyFlag.Blocked) === 0) {
      const step = (enemies.speed[slot] as number) * speedMultiplier(world, slot) * TICK_SECONDS;
      enemies.pathDist[slot] = (enemies.pathDist[slot] as number) + step;
    }

    if ((flags & EnemyFlag.Flying) !== 0) placeFlyer(world, slot);
    else placeWalker(world, slot);
  }
}

function placeWalker(world: World, slot: number): void {
  const enemies = world.enemies;
  const path = world.rules.pathById.get(enemies.pathId[slot] as number);
  if (path === undefined) return;

  const distance = enemies.pathDist[slot] as number;
  path.sample(distance, sample);

  /* Perpendicular to travel, so a pack fans out across the road rather than
     along it. */
  const offset = laneOffsetFor(enemies.ids[slot] as number, world.rules.laneWidth);
  enemies.x[slot] = sample.x - sample.dirY * offset;
  enemies.y[slot] = sample.y + sample.dirX * offset;
  enemies.facing[slot] = Math.atan2(sample.dirY, sample.dirX);

  /* Only a Burrower uses the tunnel. The segment is a property of the road and
     applies to everyone walking it, so without this check every enemy on the
     map would go untargetable through it (#29). */
  const canBurrow = ((enemies.flags[slot] as number) & EnemyFlag.CanBurrow) !== 0;
  setFlag(world, slot, EnemyFlag.Burrowed, canBurrow && path.isBurrowed(distance));
  if (distance >= path.totalLength) markLeaked(world, slot);
}

/**
 * Flyers ignore the road entirely and take the shortest line to the core, which
 * is why anti-air has to be placed on a different axis to everything else.
 */
function placeFlyer(world: World, slot: number): void {
  const enemies = world.enemies;
  const spawn = world.rules.spawnPoints[enemies.spawnPoint[slot] as number];
  if (spawn === undefined) return;

  const core = world.rules.core;
  const dx = core.x - spawn.x;
  const dy = core.y - spawn.y;
  const total = Math.hypot(dx, dy);
  if (total === 0) {
    enemies.x[slot] = core.x;
    enemies.y[slot] = core.y;
    markLeaked(world, slot);
    return;
  }

  const dirX = dx / total;
  const dirY = dy / total;
  const distance = enemies.pathDist[slot] as number;

  /* Phase from the entity id so two flyers spawned together do not drift in
     lockstep. Table-driven sine keeps it identical across engines. */
  const phase = laneOffsetFor(enemies.ids[slot] as number, 6.283);
  const drift = sinT(world.tick * WOBBLE_RATE * TICK_SECONDS + phase) * WOBBLE_AMPLITUDE;

  enemies.x[slot] = spawn.x + dirX * distance - dirY * drift;
  enemies.y[slot] = spawn.y + dirY * distance + dirX * drift;
  enemies.facing[slot] = Math.atan2(dirY, dirX);

  if (distance >= total) markLeaked(world, slot);
}

function setFlag(world: World, slot: number, flag: number, on: boolean): void {
  const flags = world.enemies.flags[slot] as number;
  world.enemies.flags[slot] = on ? flags | flag : flags & ~flag;
}

/**
 * Marks arrival at the core. The lifecycle system (#16) charges lives and
 * removes the enemy — doing it here would mean two systems could both decide an
 * enemy was gone.
 */
function markLeaked(world: World, slot: number): void {
  world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;
}
