import { MAX_QUERY_RESULTS } from '../capacity.js';
import { AURA_BEHAVIOURS, BehaviourFlag, EnemyFlag, PERIODIC_BEHAVIOURS } from '../flags.js';
import { emitBehaviour, emitTowerDisabled } from '../events.js';
import { laneOffsetFor } from '../path.js';
import { spawnEnemy } from '../spawn.js';
import type { World } from '../world.js';

/**
 * The enemy behaviours that change the rules rather than the numbers (#29,
 * docs/GAME_DESIGN.md §9).
 *
 * Menders, Nullifiers and Standard Bearers exist to make the player *aim*
 * rather than spray, which is why support enemies outrank damage enemies in
 * threat. That only works if their effect is visible and immediate — a
 * Nullifier the player has just killed must stop suppressing towers now, not
 * when some expiry lapses.
 *
 * So auras follow the ground-effect bargain exactly (#31): **recomputed from
 * nothing every tick, and the source queries the world, never the reverse.**
 * Thirty enemies asking the spatial hash once is thirty queries; three hundred
 * enemies each asking "who is buffing me" is three hundred, and it grows with
 * the wrong number. Starting from neutral each tick is also the whole of how
 * the acceptance criterion — *auras apply and remove cleanly on death and on
 * range exit* — is met, with no per-enemy bookkeeping a death could strand.
 *
 * Runs before movement and before targeting, so a haste aura is worth something
 * on the tick it is computed and a tower reads its suppression before it fires.
 * The spatial indexes are rebuilt at step 7, so positions here are one tick
 * old — the same staleness reactions accept, and identically in every run.
 */

const found = new Int32Array(MAX_QUERY_RESULTS);
/** The most-damaged allies a healer or shielder has picked this tick. */
const chosen = new Int32Array(8);

export function behaviourSystem(world: World): void {
  clearAuraState(world);

  const enemies = world.enemies;
  const table = world.rules.enemies;

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;

    /* A corpse's aura is nobody's problem, and a leaker has already scored. */
    const flags = enemies.flags[slot] as number;
    if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0) continue;

    const typeIdx = enemies.typeIdx[slot] as number;
    const behaviour = table.behaviour[typeIdx] as number;
    /* The overwhelming majority of the roster leaves in one test. */
    if (behaviour === 0) continue;

    /* Burrowed enemies are underground: they cannot be shot, and it would be
       strange if they could still heal the column walking overhead. */
    if ((flags & EnemyFlag.Burrowed) !== 0) continue;

    if ((behaviour & AURA_BEHAVIOURS) !== 0) runAuras(world, slot, typeIdx, behaviour);
    if ((behaviour & PERIODIC_BEHAVIOURS) !== 0) runPeriodic(world, slot, typeIdx, behaviour);
    if ((behaviour & BehaviourFlag.Sapper) !== 0) sap(world, slot, typeIdx);
  }
}

/**
 * A Sapper reaching a tower's plot, and the wind-up before it lands.
 *
 * The telegraph is the whole reason this is not one line: *"every enemy that
 * changes the rules gets a telegraph"* (§9.3), and a tower that simply went
 * dark the instant a Sapper arrived would be a rule change with no answer. The
 * wind-up gives the player a window to kill it in — which is what makes a
 * Sapper *"demand a player reaction"* rather than tax them.
 *
 * The target is re-found every tick rather than remembered, so walking out of
 * reach — or the tower being sold mid-wind-up — abandons the attempt with no
 * stale slot to clean up. Reusing `behaviourReadyTick` is safe because no
 * enemy is both a sapper and periodic.
 */
function sap(world: World, slot: number, typeIdx: number): void {
  const table = world.rules.enemies;
  const enemies = world.enemies;

  const target = nearestSappableTower(
    world,
    enemies.x[slot] as number,
    enemies.y[slot] as number,
    table.auraRadius[typeIdx] as number,
  );

  if (target < 0) {
    /* Nothing in reach: forget any wind-up, so a Sapper that walks past a
       tower does not arrive at the next one already charged. */
    enemies.behaviourReadyTick[slot] = 0;
    return;
  }

  if ((enemies.behaviourReadyTick[slot] as number) === 0) {
    enemies.behaviourReadyTick[slot] = world.tick + (table.telegraphTicks[typeIdx] as number);
    emitBehaviour(
      world.events,
      enemies.ids[slot] as number,
      BehaviourFlag.Sapper,
      enemies.x[slot] as number,
      enemies.y[slot] as number,
    );
    return;
  }

  if (world.tick < (enemies.behaviourReadyTick[slot] as number)) return;

  world.towers.disabledUntil[target] = world.tick + (table.disableTicks[typeIdx] as number);
  emitTowerDisabled(
    world.events,
    world.towers.ids[target] as number,
    table.disableTicks[typeIdx] as number,
  );
  /* Cleared rather than set to a cooldown: the next tower it reaches gets its
     own telegraph, which is the point. */
  enemies.behaviourReadyTick[slot] = 0;
}

/** The closest live tower in reach that is not already held down, or -1. */
function nearestSappableTower(world: World, x: number, y: number, reach: number): number {
  if (reach <= 0) return -1;
  const towers = world.towers;
  const reachSq = reach * reach;

  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let slot = 0; slot < towers.watermark; slot++) {
    if (!towers.isAlive(slot)) continue;
    /* Re-sapping a dark tower wastes the behaviour and hides the telegraph
       under one already playing. */
    if ((towers.disabledUntil[slot] as number) > world.tick) continue;

    const dx = (towers.x[slot] as number) - x;
    const dy = (towers.y[slot] as number) - y;
    const distance = dx * dx + dy * dy;
    if (distance > reachSq || distance >= bestDistance) continue;
    bestDistance = distance;
    best = slot;
  }
  return best;
}

/**
 * Forgets last tick's auras before recomputing them.
 *
 * Every enemy and every tower, not just the ones currently in range of
 * something: an enemy that walked *out* of a Standard Bearer's radius is
 * exactly the case this has to get right, and it is no longer near anything
 * that would clear it.
 */
function clearAuraState(world: World): void {
  const enemies = world.enemies;
  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;
    enemies.auraSpeed[slot] = 1;
    enemies.auraArmour[slot] = 0;
  }

  const towers = world.towers;
  for (let slot = 0; slot < towers.watermark; slot++) {
    if (!towers.isAlive(slot)) continue;
    towers.auraFireRate[slot] = 1;
  }
}

function runAuras(world: World, slot: number, typeIdx: number, behaviour: number): void {
  const table = world.rules.enemies;
  const radius = table.auraRadius[typeIdx] as number;
  if (radius <= 0) return;

  const x = world.enemies.x[slot] as number;
  const y = world.enemies.y[slot] as number;

  if ((behaviour & BehaviourFlag.TowerSlowAura) !== 0) {
    suppressTowers(world, x, y, radius, table.towerFireRateMultiplier[typeIdx] as number);
  }
  if ((behaviour & BehaviourFlag.AllyHasteAura) !== 0) {
    hasteAllies(
      world,
      slot,
      x,
      y,
      radius,
      table.allySpeedMultiplier[typeIdx] as number,
      table.allyArmourBonus[typeIdx] as number,
    );
  }
  if ((behaviour & BehaviourFlag.Healer) !== 0) {
    heal(world, slot, x, y, radius, typeIdx);
  }
}

/**
 * A Nullifier's escort effect.
 *
 * Strongest wins rather than multiplying, the same rule overlapping ground
 * slows follow: two Nullifiers should make a tower bad, not silent.
 */
function suppressTowers(
  world: World,
  x: number,
  y: number,
  radius: number,
  multiplier: number,
): void {
  if (multiplier >= 1) return;
  const towers = world.towers;
  const radiusSq = radius * radius;

  /* Towers are few and never move, so a linear sweep beats maintaining an
     index for them — and there is no tower index to query in any case. */
  for (let slot = 0; slot < towers.watermark; slot++) {
    if (!towers.isAlive(slot)) continue;
    const dx = (towers.x[slot] as number) - x;
    const dy = (towers.y[slot] as number) - y;
    if (dx * dx + dy * dy > radiusSq) continue;
    if (multiplier < (towers.auraFireRate[slot] as number)) towers.auraFireRate[slot] = multiplier;
  }
}

/** A Standard Bearer's escort effect. Strongest wins, for the same reason. */
function hasteAllies(
  world: World,
  source: number,
  x: number,
  y: number,
  radius: number,
  speed: number,
  armour: number,
): void {
  const enemies = world.enemies;
  const count = gather(world, x, y, radius);

  for (let i = 0; i < count; i++) {
    const ally = found[i] as number;
    /* A bearer buffs the column, not itself: a self-hasting escort outruns the
       thing it is escorting, which is the opposite of what it is for. */
    if (ally === source) continue;
    if (speed > (enemies.auraSpeed[ally] as number)) enemies.auraSpeed[ally] = speed;
    if (armour > (enemies.auraArmour[ally] as number)) enemies.auraArmour[ally] = armour;
  }
}

/**
 * A Mender's heal, on the most-damaged allies in reach.
 *
 * Most-damaged by *missing health* rather than by fraction: the design calls
 * the Mender a kill priority because it undoes the work a player has already
 * done, and absolute healing restored is what that work was.
 */
function heal(
  world: World,
  source: number,
  x: number,
  y: number,
  radius: number,
  typeIdx: number,
): void {
  const table = world.rules.enemies;
  const perTick = table.healPerTick[typeIdx] as number;
  if (perTick <= 0) return;

  const enemies = world.enemies;
  const picked = pickMostDamaged(world, source, x, y, radius, table.auraTargets[typeIdx] as number);

  for (let i = 0; i < picked; i++) {
    const ally = chosen[i] as number;
    const max = enemies.maxHp[ally] as number;
    const healed = Math.min(max, (enemies.hp[ally] as number) + perTick);
    enemies.hp[ally] = healed;
  }
}

/**
 * The `limit` allies missing the most health, into `chosen`.
 *
 * A selection sort over the query result rather than a real sort, because the
 * limit is two or three and the candidate list is short — and because sorting
 * would allocate, which nothing in the tick loop may do.
 */
function pickMostDamaged(
  world: World,
  source: number,
  x: number,
  y: number,
  radius: number,
  limit: number,
): number {
  const enemies = world.enemies;
  const count = gather(world, x, y, radius);
  const wanted = Math.min(limit, chosen.length);

  let taken = 0;
  for (let pick = 0; pick < wanted; pick++) {
    let best = -1;
    let bestMissing = 0;

    for (let i = 0; i < count; i++) {
      const ally = found[i] as number;
      if (ally < 0) continue;
      /* A Mender heals its escort, not itself — otherwise two Menders are
         unkillable by any damage below their combined rate. */
      if (ally === source) continue;

      const missing = (enemies.maxHp[ally] as number) - (enemies.hp[ally] as number);
      /* Undamaged allies are not candidates at all; a heal spent on a full
         health bar is the Mender wasting its own threat. */
      if (missing <= 0 || missing <= bestMissing) continue;
      bestMissing = missing;
      best = i;
    }

    if (best < 0) break;
    chosen[taken++] = found[best] as number;
    /* Struck off in place rather than compacted, so picking two out of forty
       allocates nothing. */
    found[best] = -1;
  }
  return taken;
}

/** Behaviours that fire on their own clock: shields, drops, spawns. */
function runPeriodic(world: World, slot: number, typeIdx: number, behaviour: number): void {
  const enemies = world.enemies;
  const table = world.rules.enemies;
  const interval = table.spawnIntervalTicks[typeIdx] as number;
  if (interval <= 0) return;

  if (world.tick < (enemies.behaviourReadyTick[slot] as number)) return;
  enemies.behaviourReadyTick[slot] = world.tick + interval;

  if ((behaviour & BehaviourFlag.Shielder) !== 0) shieldAllies(world, slot, typeIdx);
  if ((behaviour & (BehaviourFlag.Carrier | BehaviourFlag.StationarySpawner)) !== 0) {
    spawnBrood(world, slot, typeIdx, behaviour);
  }
}

/** A Shieldwright's overshield, refreshed rather than stacked. */
function shieldAllies(world: World, source: number, typeIdx: number): void {
  const table = world.rules.enemies;
  const amount = table.shieldAmount[typeIdx] as number;
  if (amount <= 0) return;

  const enemies = world.enemies;
  const x = enemies.x[source] as number;
  const y = enemies.y[source] as number;
  const picked = pickMostDamaged(
    world,
    source,
    x,
    y,
    table.auraRadius[typeIdx] as number,
    table.auraTargets[typeIdx] as number,
  );

  for (let i = 0; i < picked; i++) {
    const ally = chosen[i] as number;
    /* Set, not added: the design says the shield refreshes every eight seconds,
       and adding would let a Shieldwright that survives long enough hand out an
       unbounded pool. */
    if (amount > (enemies.overshield[ally] as number)) enemies.overshield[ally] = amount;
    emitBehaviour(world.events, enemies.ids[ally] as number, BehaviourFlag.Shielder, x, y);
  }
}

/**
 * A Carrier's drop, and a Rift Sprout's brood.
 *
 * Both put a child on the ground path, so they are one function: a Carrier is a
 * spawner that happens to be flying over the road it seeds, and a Sprout is one
 * that never moved. The child is placed at the parent's path distance exactly
 * as a splitter's children are, which is what keeps the spread decided by the
 * lane hash rather than by the RNG.
 */
function spawnBrood(world: World, source: number, typeIdx: number, behaviour: number): void {
  const table = world.rules.enemies;
  const childType = table.spawns[typeIdx] as number;
  const count = table.spawnCount[typeIdx] as number;
  if (childType < 0 || count <= 0) return;

  const enemies = world.enemies;
  const spawnPoint = enemies.spawnPoint[source] as number;
  const distance = enemies.pathDist[source] as number;
  const wave = enemies.waveIndex[source] as number;

  for (let i = 0; i < count; i++) {
    /* Scaled by the parent's wave for the same reason a splitter's children
       are: what a Carrier drops belongs to the wave the Carrier came in with. */
    const child = spawnEnemy(world, childType, spawnPoint, wave < 0 ? 0 : wave);
    if (child < 0) return;

    enemies.waveIndex[child] = wave;
    enemies.laneOffset[child] = laneOffsetFor(enemies.ids[child] as number, world.rules.laneWidth);

    /* A Carrier flies a straight line to the core while its cargo walks the
       road, so the two measure distance in different units and the drop cannot
       simply inherit the parent's. Starting the child at the road's beginning
       would be a free pass; starting it underneath the Carrier is the threat
       the design describes, so the flight distance is reused as a road
       distance and clamped to the road that exists. */
    const path = world.rules.pathById.get(enemies.pathId[child] as number);
    const along = path === undefined ? distance : Math.min(distance, path.totalLength);
    enemies.pathDist[child] = (behaviour & BehaviourFlag.Carrier) !== 0 ? along : distance;
  }

  emitBehaviour(
    world.events,
    enemies.ids[source] as number,
    (behaviour & BehaviourFlag.Carrier) !== 0
      ? BehaviourFlag.Carrier
      : BehaviourFlag.StationarySpawner,
    enemies.x[source] as number,
    enemies.y[source] as number,
  );
}

/**
 * Living enemies near a point, into the shared scratch buffer.
 *
 * Ground and air together: a Standard Bearer's column and the bats escorting it
 * are the same wave, and there is no reading of the design on which a banner
 * politely omits the air.
 */
function gather(world: World, x: number, y: number, radius: number): number {
  const buffer = world.queryBuffer;
  const enemies = world.enemies;
  let count = 0;

  for (const index of [world.groundIndex, world.airIndex]) {
    const hits = index.query(x, y, radius, buffer);
    for (let i = 0; i < hits && count < found.length; i++) {
      const slot = buffer[i] as number;
      if (!enemies.isAlive(slot)) continue;
      const flags = enemies.flags[slot] as number;
      if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0) continue;
      found[count++] = slot;
    }
  }
  return count;
}
