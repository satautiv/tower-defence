import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DAMAGE_INDEX, DamageFlag } from '../damage.js';
import { addGold, awardKill, bonusGoldFor } from '../economy.js';
import { emitBehaviour, emitDamageDealt, emitEnemyDied } from '../events.js';
import { BehaviourFlag, EnemyFlag, TowerPerk } from '../flags.js';
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
const CHILL = STATUS_INDEX.chill;
const CHARGE = STATUS_INDEX.charge;

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
  /**
   * Stat index of the tower that is attacking, or -1 (#32).
   *
   * Optional and trailing because most callers — the enemy panel, a burn, a
   * reaction — are asking "how tough is this enemy" rather than "how tough is
   * it to *this tower*", and only a branch perk makes the two differ.
   */
  statIndex = -1,
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

  /* A Standard Bearer's armour applies to both defences: the design describes
     it as toughening the column, and a bonus that armoured only the physical
     half would silently make the escort pointless against half the roster. */
  base += enemies.auraArmour[enemySlot] as number;

  const corrode = enemies.stacksOf(enemySlot, CORRODE);
  const perStack = world.rules.statuses.defenceReductionPerStack[CORRODE] as number;
  let defence = base - corrode * perStack;
  if (kinetic) defence -= armourPierce;

  if (statIndex >= 0) {
    const towers = world.rules.towers;
    const perks = towers.perks[statIndex] as number;

    /* Rime Spire: its Chill eats armour rather than only slowing, which is the
       whole of why it is a different tower from Glacier Heart (§8.5). Armour
       only — the design says "−armour", and sundering Ward too would make it
       the answer to everything. */
    if ((perks & TowerPerk.ChillSunders) !== 0 && kinetic) {
      defence -=
        (towers.armourPerChillStack[statIndex] as number) * enemies.stacksOf(enemySlot, CHILL);
    }

    /* Sniper Nest ignores a *share* of what is left, where `armourPierce` is a
       flat subtraction. A fraction is what makes it the answer to an elite:
       flat pierce stops mattering the moment armour outgrows it, and the
       design wants this tower to stay the boss answer at every region. */
    if ((perks & TowerPerk.PierceFraction) !== 0 && kinetic && defence > 0) {
      defence *= 1 - (towers.pierceFraction[statIndex] as number);
    }
  }

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

  /* The attacking tower's tier, or -1. Branch perks are the only reason the
     same enemy is tougher to one tower than to another (#32). */
  const statIndex = source >= 0 && world.towers.isAlive(source) ? statIndexOf(world, source) : -1;

  if (type !== TRUE_DAMAGE && (damageFlags & DamageFlag.True) === 0) {
    const kinetic = type === KINETIC;
    const pierce =
      (damageFlags & DamageFlag.ArmourPierce) !== 0 && statIndex >= 0
        ? (world.rules.towers.armourPierce[statIndex] as number)
        : 0;

    const fromX =
      source >= 0 && world.towers.isAlive(source)
        ? (world.towers.x[source] as number)
        : (enemies.x[slot] as number);
    const fromY =
      source >= 0 && world.towers.isAlive(source)
        ? (world.towers.y[source] as number)
        : (enemies.y[slot] as number);

    const defence = effectiveDefence(world, slot, kinetic, pierce, fromX, fromY, statIndex);
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

  /* Pyroclast Vent hits far harder into Corrode — a status it cannot apply
     itself, so the bonus is only ever collected by a *board* that pairs it
     with an Alchemist. That is pillar P1 written as a number (§8.4). */
  if (statIndex >= 0) {
    const towers = world.rules.towers;
    if ((towers.perks[statIndex] as number) & TowerPerk.BonusVsStatus) {
      const against = towers.bonusVsStatus[statIndex] as number;
      if (against < STATUS_COUNT && enemies.stacksOf(slot, against) > 0) {
        amount *= towers.bonusVsStatusMultiplier[statIndex] as number;
      }
    }
  }

  /* An enemy the marked tower has painted takes more from everything, which
     is what makes a Ranger Lodge worth building beside damage rather than
     instead of it. */
  if (world.tick < (enemies.markedUntil[slot] as number)) {
    amount *= enemies.markMultiplier[slot] as number;
  }

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
  /* After the health is applied, and only if it survived: a hit that kills a
     Phase Stalker should not also teleport the corpse two tiles up the road. */
  if ((enemies.hp[slot] as number) > 0) maybePhase(world, slot, amount);
  /* Attributed where it came from, so a panel can say what this tower has
     contributed. Sources that are not towers — burns, reactions, soldiers —
     carry -1 and are counted only in the stage total. */
  if (source >= 0 && world.towers.isAlive(source)) {
    world.towers.damageDealt[source] = (world.towers.damageDealt[source] as number) + amount;
  }
  applyOnHitStatus(world, index, slot);
  maybeDischarge(world, slot, statIndex);

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

  /* The firing tower travels with the status, so a reaction this hit completes
     can be credited to it — which is how a Surge node amplifies its own
     reactions and nobody else's (#30). */
  applyStatus(
    world,
    slot,
    statusId,
    queue.statusStacks[index] as number,
    queue.source[index] as number,
  );
}

/**
 * A Phase Stalker's jump (#29, docs/GAME_DESIGN.md §9.1).
 *
 * *"Teleports 2 tiles forward on any hit > 100 damage. Punishes burst-only
 * boards."* Measured against the damage that actually landed, after armour,
 * ward and every multiplier — so stripping its Ward with Corrode is what makes
 * a shot heavy enough to set it off, which is the counter-play the line is for.
 *
 * Lives here rather than in a per-tick sweep because it is a response to a
 * single hit, and the size of that hit exists nowhere else. It sits beside the
 * shatter check for the same reason.
 *
 * The jump moves it along the path it is already on and never past the end:
 * arriving at the core is the lifecycle system's decision to make, and a
 * teleport that overshot the road would skip the leak check entirely.
 */
function maybePhase(world: World, slot: number, amount: number): void {
  const enemies = world.enemies;
  const typeIdx = enemies.typeIdx[slot] as number;
  const table = world.rules.enemies;

  if (((table.behaviour[typeIdx] as number) & BehaviourFlag.Phase) === 0) return;

  const threshold = table.phaseDamageThreshold[typeIdx] as number;
  if (threshold <= 0 || amount <= threshold) return;

  const path = world.rules.pathById.get(enemies.pathId[slot] as number);
  const limit = path === undefined ? Number.POSITIVE_INFINITY : path.totalLength;
  const jumped = (enemies.pathDist[slot] as number) + (table.phaseDistance[typeIdx] as number);

  enemies.pathDist[slot] = jumped >= limit ? limit : jumped;
  /* A jump breaks whatever was holding it: a soldier cannot keep a grip on
     something that is no longer there. */
  enemies.flags[slot] = (enemies.flags[slot] as number) & ~EnemyFlag.Blocked;
  enemies.blockedBy[slot] = -1;

  emitBehaviour(
    world.events,
    enemies.ids[slot] as number,
    BehaviourFlag.Phase,
    enemies.x[slot] as number,
    enemies.y[slot] as number,
  );
}

/**
 * Storm Pylon's discharge (#32, docs/GAME_DESIGN.md §8.4).
 *
 * *"Charge-stack stun + discharge"*. An enemy taken to the Charge cap is
 * frozen and the stacks are spent, which is what turns Charge from a chain
 * modifier into a win condition and makes the Pylon the crowd answer its
 * branch is meant to be.
 *
 * Freeze rather than a stun of its own, because the game already has exactly
 * one hard stop and a second one would need its own immunity rules, its own
 * icon and its own interaction with every slow — for one tower. Boss immunity
 * therefore applies for free, which is correct: this must not stun a boss.
 */
function maybeDischarge(world: World, slot: number, statIndex: number): void {
  if (statIndex < 0) return;
  const towers = world.rules.towers;
  if (((towers.perks[statIndex] as number) & TowerPerk.DischargeAtCap) === 0) return;

  const enemies = world.enemies;
  const cap = world.rules.statuses.maxStacks[CHARGE] as number;
  if (cap <= 0 || enemies.stacksOf(slot, CHARGE) < cap) return;

  /* Spent, not merely converted: the cost of the stun is the chain length the
     Charge was buying, so a Pylon trades reach for a stop. */
  const at = slot * STATUS_COUNT + CHARGE;
  enemies.statusStacks[at] = 0;
  enemies.statusExpiry[at] = 0;
  enemies.statusDirty[slot] = 1;

  applyStatus(world, slot, FREEZE, 1);
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

    spreadOnDeath(world, slot, killer);
    splitOnDeath(world, slot, typeIdx);
    enemies.free(slot);
  }
  deaths.clear();
}

/** Reused by the contagion sweep, so a death allocates nothing. */
const contagion = new Int32Array(MAX_QUERY_RESULTS);

/**
 * Pyroclast Vent's Scorch and Plague Vat's Corrode, passed from a corpse (#32).
 *
 * One perk for both, with the status read from the tier, because they differ
 * only in payload — and because the thing that makes them a *branch* is the
 * same in each case: the tower stops being worth its cost against one enemy
 * and starts being worth it against a pack.
 *
 * Attributed to the tower that landed the kill, so a spread that completes a
 * reaction pair is credited to it and a Surge node pays out (#30).
 */
function spreadOnDeath(world: World, slot: number, killer: number): void {
  if (killer < 0 || !world.towers.isAlive(killer)) return;

  const towers = world.rules.towers;
  const statIndex = statIndexOf(world, killer);
  if (((towers.perks[statIndex] as number) & TowerPerk.SpreadOnDeath) === 0) return;

  const status = towers.statusId[statIndex] as number;
  const stacks = towers.spreadStacks[statIndex] as number;
  const radius = towers.spreadRadius[statIndex] as number;
  if (status >= STATUS_COUNT || stacks <= 0 || radius <= 0) return;

  /* A leaker has already scored and is being collected; spreading from it
     would let a tower keep working after the enemy reached the core. */
  if (((world.enemies.flags[slot] as number) & EnemyFlag.Leaked) !== 0) return;

  const enemies = world.enemies;
  const x = enemies.x[slot] as number;
  const y = enemies.y[slot] as number;

  let found = 0;
  for (const index of [world.groundIndex, world.airIndex]) {
    const hits = index.query(x, y, radius, world.queryBuffer);
    for (let i = 0; i < hits && found < contagion.length; i++) {
      const other = world.queryBuffer[i] as number;
      if (other === slot || !enemies.isAlive(other)) continue;
      const flags = enemies.flags[other] as number;
      if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0) continue;
      contagion[found++] = other;
    }
  }

  /* Gathered before any status lands, because `applyStatus` can escalate Chill
     into Freeze and a spread that read the index mid-application would be
     deciding its own recipients. */
  for (let i = 0; i < found; i++) {
    applyStatus(world, contagion[i] as number, status, stacks, killer);
  }
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
    /* Scaled by the parent's wave, not the current one: a Chitin Mother from
       wave three should produce wave-three Broodlings however late they die. */
    const child = spawnEnemy(world, childType, spawnPoint, waveIndex);
    if (child < 0) return;

    enemies.pathId[child] = pathId;
    enemies.pathDist[child] = distance;
    enemies.waveIndex[child] = waveIndex;
    enemies.x[child] = enemies.x[parent] as number;
    enemies.y[child] = enemies.y[parent] as number;
    enemies.laneOffset[child] = laneOffsetFor(enemies.ids[child] as number, world.rules.laneWidth);
  }
}
