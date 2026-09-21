import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DAMAGE_INDEX } from '../damage.js';
import { STATUS_INDEX } from '../status.js';
import {
  AURA_BEHAVIOURS,
  BEHAVIOUR_BITS,
  BehaviourFlag,
  EnemyFlag,
  GroundEffectFlag,
  PERIODIC_BEHAVIOURS,
  SoldierFlag,
  TELEGRAPHED_BEHAVIOURS,
  TYPE_FLAGS,
  behaviourBit,
} from '../flags.js';
import { emitBehaviour, emitBossPhase, emitTowerDisabled } from '../events.js';
import { laneOffsetFor } from '../path.js';
import { defenceScaleFor, spawnEnemy } from '../spawn.js';
import { createGroundEffect } from './groundEffects.js';
import { fall } from './soldiers.js';
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

    /* Before anything reads a rule off the table, in case this tick's row is
       not last tick's: a boss below its threshold is a different row, and
       every rule below comes from that row. */
    const typeIdx = advancePhase(world, slot);
    const behaviour = table.behaviour[typeIdx] as number;
    /* The overwhelming majority of the roster leaves in one test. */
    if (behaviour === 0) continue;

    /* Burrowed enemies are underground: they cannot be shot, and it would be
       strange if they could still heal the column walking overhead. */
    if ((flags & EnemyFlag.Burrowed) !== 0) continue;

    if ((behaviour & AURA_BEHAVIOURS) !== 0) runAuras(world, slot, typeIdx, behaviour);
    if ((behaviour & PERIODIC_BEHAVIOURS) !== 0) runPeriodic(world, slot, typeIdx, behaviour);
    if ((behaviour & TELEGRAPHED_BEHAVIOURS) !== 0) runTelegraphed(world, slot, typeIdx, behaviour);
  }
}

/**
 * A boss crossing a health threshold, which is the whole of the multi-phase
 * framework (#33, docs/GAME_DESIGN.md §10).
 *
 * The transition is one assignment, because a phase is another row of the
 * enemy table: behaviours, speed, armour, melee and the sprite all come from
 * `typeIdx`, so swapping it swaps every rule at once and no system below this
 * line knows a phase exists. Health, statuses and path position are untouched
 * — they live on the entity, not on the row — which is what makes this a
 * transition rather than a new enemy.
 *
 * Loops rather than steps once, so a burst that takes a boss through two
 * thresholds in a tick lands it in the phase its health actually says. Runs
 * before the behaviours below it, so the tick a boss enters phase two is the
 * tick phase two acts.
 */
function advancePhase(world: World, slot: number): number {
  const table = world.rules.enemies;
  const enemies = world.enemies;
  let typeIdx = enemies.typeIdx[slot] as number;

  let next = table.nextPhase[typeIdx] as number;
  if (next < 0) return typeIdx;

  const maxHp = enemies.maxHp[slot] as number;
  if (maxHp <= 0) return typeIdx;
  const fraction = (enemies.hp[slot] as number) / maxHp;

  while (next >= 0 && fraction <= (table.phaseBelowFraction[typeIdx] as number)) {
    typeIdx = next;
    next = table.nextPhase[typeIdx] as number;
    /* Timers belong to the phase that set them: a swallow charged in phase one
       must not land the instant phase two begins with a different clock. */
    const clocks = slot * BEHAVIOUR_BITS;
    for (let i = 0; i < BEHAVIOUR_BITS; i++) enemies.behaviourReadyTick[clocks + i] = 0;
    enemies.flags[slot] = (enemies.flags[slot] as number) & ~EnemyFlag.WindingUp;

    enemies.typeIdx[slot] = typeIdx;
    enemies.speed[slot] = table.speed[typeIdx] as number;
    /* Re-derived through the same scaling the spawn used, not copied raw: a
       boss that crossed a threshold must not shed the wave's defence growth
       along with its first phase. Overshield is deliberately left alone —
       it is a pool that changes in play, and refilling it here would make
       every transition a free heal. */
    const wave = enemies.waveIndex[slot] as number;
    const defence = defenceScaleFor(world, wave < 0 ? 0 : wave);
    enemies.armour[slot] = (table.armour[typeIdx] as number) * defence;
    enemies.ward[slot] = (table.ward[typeIdx] as number) * defence;
    /* Replaced rather than merged, so a phase that drops a trait really drops
       it — but only the bits a type owns, leaving Blocked and Dying alone. */
    enemies.flags[slot] =
      ((enemies.flags[slot] as number) & ~TYPE_FLAGS) | (table.flags[typeIdx] as number);

    emitBossPhase(
      world.events,
      enemies.ids[slot] as number,
      typeIdx,
      enemies.x[slot] as number,
      enemies.y[slot] as number,
    );
  }
  return typeIdx;
}

/**
 * Behaviours that warn before they land: a Sapper's reach, a Rift Maw's bite.
 *
 * The telegraph is the whole reason this is not one line: *"every enemy that
 * changes the rules gets a telegraph"* (§9.3), and a tower that simply went
 * dark the instant a Sapper arrived — or a soldier that simply vanished —
 * would be a rule change with no answer. The wind-up gives the player a window
 * to act in, which is what makes such an enemy *demand a reaction* rather than
 * tax one.
 *
 * Both halves run through one shape: find a target, arm, land, and a target
 * that leaves reach mid-wind-up disarms with nothing to clean up.
 * `EnemyFlag.WindingUp` is what separates "armed" from "due" on a single
 * timer, so the two states do not need two fields.
 */
function runTelegraphed(world: World, slot: number, typeIdx: number, behaviour: number): void {
  if ((behaviour & BehaviourFlag.Sapper) !== 0) sap(world, slot, typeIdx);
  if ((behaviour & BehaviourFlag.Devours) !== 0) devour(world, slot, typeIdx);
}

/**
 * Arms or advances a wind-up, and reports whether it is due this tick.
 *
 * Returns false both while nothing is in reach and while the warning is still
 * playing, so a caller reads as "find a target, then act if it is time".
 */
function windUp(
  world: World,
  slot: number,
  typeIdx: number,
  flag: number,
  armed: boolean,
): boolean {
  const enemies = world.enemies;
  const timer = slot * BEHAVIOUR_BITS + behaviourBit(flag);
  const flags = enemies.flags[slot] as number;

  if (!armed) {
    /* Nothing in reach: forget any wind-up, so an enemy that walks past one
       target does not arrive at the next already charged. */
    enemies.flags[slot] = flags & ~EnemyFlag.WindingUp;
    return false;
  }

  if ((flags & EnemyFlag.WindingUp) === 0) {
    if (world.tick < (enemies.behaviourReadyTick[timer] as number)) return false;
    enemies.flags[slot] = flags | EnemyFlag.WindingUp;
    enemies.behaviourReadyTick[timer] =
      world.tick + (world.rules.enemies.telegraphTicks[typeIdx] as number);
    emitBehaviour(
      world.events,
      enemies.ids[slot] as number,
      flag,
      enemies.x[slot] as number,
      enemies.y[slot] as number,
    );
    return false;
  }

  if (world.tick < (enemies.behaviourReadyTick[timer] as number)) return false;

  enemies.flags[slot] = flags & ~EnemyFlag.WindingUp;
  /* The cooldown is the behaviour's own clock, or zero for one that simply
     re-telegraphs at its next target — which is a Sapper, and the point. */
  enemies.behaviourReadyTick[timer] =
    world.tick + (world.rules.enemies.behaviourIntervalTicks[timer] as number);
  return true;
}

/** A Sapper reaching a tower's plot and holding it down. */
function sap(world: World, slot: number, typeIdx: number): void {
  const table = world.rules.enemies;
  const enemies = world.enemies;

  /* Re-found every tick rather than remembered, so walking out of reach — or
     the tower being sold mid-wind-up — abandons the attempt. */
  const target = nearestSappableTower(
    world,
    enemies.x[slot] as number,
    enemies.y[slot] as number,
    table.auraRadius[typeIdx] as number,
  );

  if (!windUp(world, slot, typeIdx, BehaviourFlag.Sapper, target >= 0)) return;

  world.towers.disabledUntil[target] = world.tick + (table.disableTicks[typeIdx] as number);
  emitTowerDisabled(
    world.events,
    world.towers.ids[target] as number,
    table.disableTicks[typeIdx] as number,
  );
}

/**
 * Grendrix's Swallow: it eats whoever is holding it, and grows for it (§10).
 *
 * The mechanic the player must answer rather than out-damage. It reaches only
 * what is *blocking* it, which is what makes the answer a real decision: pull
 * the rally flag back and the boss walks free, leave it forward and the
 * garrison feeds it. A Ranger Lodge fights from outside that reach, which is
 * the counter the design names.
 *
 * An instant kill rather than damage, because a swallow a tanky soldier
 * survives is a swallow that reads as a stumble. The heal is the cost of
 * letting it happen, and it is a fraction of the boss's own maximum so the
 * number stays meaningful when #36 restats the fight.
 */
function devour(world: World, slot: number, typeIdx: number): void {
  const enemies = world.enemies;
  const soldiers = world.soldiers;
  const victim = enemies.blockedBy[slot] as number;

  const holding =
    victim >= 0 &&
    soldiers.isAlive(victim) &&
    ((soldiers.flags[victim] as number) & SoldierFlag.Respawning) === 0;

  if (!windUp(world, slot, typeIdx, BehaviourFlag.Devours, holding)) return;

  /* Through the soldier system's own death path, so a hero is sent to respawn
     rather than deleted and a garrison's count stays true. */
  fall(world, victim);

  const healed =
    (enemies.maxHp[slot] as number) * (world.rules.enemies.devourHealFraction[typeIdx] as number);
  enemies.hp[slot] = Math.min(enemies.maxHp[slot] as number, (enemies.hp[slot] as number) + healed);

  emitBehaviour(
    world.events,
    enemies.ids[slot] as number,
    BehaviourFlag.Devours,
    enemies.x[slot] as number,
    enemies.y[slot] as number,
  );
}

/**
 * Grendrix's phase two: corrosive pools that hold down the plots they land on.
 *
 * Laid through `createGroundEffect` like every other puddle in the game, so a
 * boss's pool and a Firestorm Cannon's are the same object and the player
 * reads them the same way. What is new is on the ground rather than on the
 * boss — `Suppresses` — which is why the plot-disabling half of this mechanic
 * needed no boss-shaped code at all.
 */
function spitGround(world: World, slot: number, typeIdx: number): void {
  const table = world.rules.enemies;
  const enemies = world.enemies;
  const seconds = (table.groundTicks[typeIdx] as number) / TICK_HZ;
  if (seconds <= 0) return;

  const x = enemies.x[slot] as number;
  const y = enemies.y[slot] as number;

  createGroundEffect(world, {
    x,
    y,
    radiusTiles: (table.groundRadius[typeIdx] as number) / TILE_SIZE,
    seconds,
    damagePerSecond: table.groundDamagePerSecond[typeIdx] as number,
    damageType: DAMAGE_INDEX.toxic,
    statusId: STATUS_INDEX.corrode,
    statusStacks: 1,
    suppresses: ((table.groundFlags[typeIdx] as number) & GroundEffectFlag.Suppresses) !== 0,
  });

  emitBehaviour(world.events, enemies.ids[slot] as number, BehaviourFlag.SpitsGround, x, y);
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

/**
 * Behaviours that fire on their own clock: shields, drops, spawns, spits.
 *
 * Each behaviour reads *its own* timer and *its own* interval, rather than the
 * one clock this used to share. Grendrix's phase two both swallows and spits
 * on different cadences, and a shared timer would have meant each reset the
 * other — the one behaviour that fired most often would have silenced the
 * rest. The bits are walked lowest-first so two behaviours due on the same
 * tick always resolve in the same order, whatever the roster.
 */
function runPeriodic(world: World, slot: number, typeIdx: number, behaviour: number): void {
  const enemies = world.enemies;
  const table = world.rules.enemies;
  const clocks = slot * BEHAVIOUR_BITS;
  const intervals = typeIdx * BEHAVIOUR_BITS;

  let bits = behaviour & PERIODIC_BEHAVIOURS;
  while (bits !== 0) {
    /* Lowest set bit, cleared each pass: no allocation, no iteration over
       behaviours this enemy does not have. */
    const flag = bits & -bits;
    bits ^= flag;

    const bit = behaviourBit(flag);
    const interval = table.behaviourIntervalTicks[intervals + bit] as number;
    if (interval <= 0) continue;
    if (world.tick < (enemies.behaviourReadyTick[clocks + bit] as number)) continue;
    enemies.behaviourReadyTick[clocks + bit] = world.tick + interval;

    if (flag === BehaviourFlag.Shielder) shieldAllies(world, slot, typeIdx);
    else if (flag === BehaviourFlag.SpitsGround) spitGround(world, slot, typeIdx);
    else spawnBrood(world, slot, typeIdx, behaviour);
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
