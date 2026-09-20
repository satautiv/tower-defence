import { MAX_QUERY_RESULTS } from '../capacity.js';
import { DAMAGE_INDEX, DamageFlag } from '../damage.js';
import { awardReactionAether } from '../economy.js';
import { emitReactionTriggered } from '../events.js';
import { EnemyFlag } from '../flags.js';
import { REACTION_ANY } from '../ruleset.js';
import { STATUS_COUNT } from '../status.js';
import { applyStatus } from './status.js';
import type { World } from '../world.js';

/**
 * The signature mechanic (docs/GAME_DESIGN.md §4).
 *
 * Two statuses on one enemy detonate. That is the whole game's central bet, and
 * almost all of it is data: the matrix lives in `content/data/reactions.json`
 * and this file only knows how to read a row and carry it out. Retuning which
 * pairs react, how hard, how wide and how often is a JSON edit.
 *
 * Three properties keep it from running away, and all three are load-bearing:
 *
 * - **One reaction per enemy per tick.** The first matching row wins, so
 *   authored order is priority order.
 * - **A per-enemy cooldown**, 1.2s for the damaging reactions and 4s for
 *   Amplify. Without it a Flame Vent beside a Frost Cairn would machine-gun
 *   Thermal Shocks and trivialise the game; with it reactions are punctuation.
 * - **Reaction damage re-enters the shared damage queue** as
 *   `IsReaction | arcane`, exactly like a projectile's. There is no parallel
 *   path, which is what makes a chain — Combustion igniting a neighbour, whose
 *   Scorch meets its Chill next tick — work with no code to support it.
 *
 * Only enemies whose statuses changed are examined, which is what `statusDirty`
 * is for: in a dense wave most enemies are carrying the same pair they carried
 * last tick and have nothing new to resolve.
 */

const ARCANE = DAMAGE_INDEX.arcane;
const NO_STATUS = 255;

/** Reused across every reaction, so resolving one allocates nothing. */
const affected = new Int32Array(MAX_QUERY_RESULTS);

export function reactionSystem(world: World): void {
  const enemies = world.enemies;
  if (world.rules.reactions.count === 0) return;

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if ((enemies.statusDirty[slot] as number) === 0) continue;
    if (!reactable(world, slot)) {
      enemies.statusDirty[slot] = 0;
      continue;
    }

    const row = matchingReaction(world, slot);
    if (row < 0) {
      enemies.statusDirty[slot] = 0;
      continue;
    }

    /* A pair is here but the lockout has not lapsed. The flag stays set so the
       reaction fires the tick the cooldown ends, rather than waiting for some
       unrelated status to land and mark the enemy dirty again. */
    if (world.tick < (enemies.reactionReadyTick[slot] as number)) continue;

    resolve(world, slot, row);
    enemies.statusDirty[slot] = 0;
  }
}

/** Corpses, leakers and the burrowed do not react. */
function reactable(world: World, slot: number): boolean {
  const enemies = world.enemies;
  if (!enemies.isAlive(slot)) return false;
  const flags = enemies.flags[slot] as number;
  return (flags & (EnemyFlag.Dying | EnemyFlag.Leaked | EnemyFlag.Burrowed)) === 0;
}

/**
 * The first row of the matrix whose pair this enemy carries, or -1.
 *
 * First, not best: authored order is the priority order, which is why Amplify
 * sits last in the file — it should never pre-empt a real reaction.
 */
function matchingReaction(world: World, slot: number): number {
  const table = world.rules.reactions;

  for (let row = 0; row < table.count; row++) {
    const a = table.a[row] as number;
    if (world.enemies.stacksOf(slot, a) === 0) continue;

    const b = table.b[row] as number;
    if (b === REACTION_ANY) {
      if (anyPartner(world, slot, a) >= 0) return row;
      continue;
    }
    if (world.enemies.stacksOf(slot, b) > 0) return row;
  }
  return -1;
}

/**
 * Any reactive status other than `exclude`, lowest index first.
 *
 * Fracture is deliberately excluded by its own `reactive: false` flag — it is
 * the pure-physical build's scaling lane and must stay out of the matrix.
 */
function anyPartner(world: World, slot: number, exclude: number): number {
  const reactive = world.rules.statuses.reactive;
  for (let status = 0; status < STATUS_COUNT; status++) {
    if (status === exclude) continue;
    if ((reactive[status] as number) === 0) continue;
    if (world.enemies.stacksOf(slot, status) > 0) return status;
  }
  return -1;
}

function resolve(world: World, slot: number, row: number): void {
  const table = world.rules.reactions;
  const enemies = world.enemies;

  const a = table.a[row] as number;
  const declaredB = table.b[row] as number;
  const b = declaredB === REACTION_ANY ? anyPartner(world, slot, a) : declaredB;
  if (b < 0) return;

  /* Read before anything is consumed: Thermal Shock scales on the Scorch it is
     about to eat, so reading after would always score it at zero. */
  const magnitude =
    (table.baseDamage[row] as number) +
    (table.damagePerStack[row] as number) * enemies.stacksOf(slot, a);

  if ((table.consumes[row] as number) === 1) {
    clearStatus(world, slot, a);
    clearStatus(world, slot, b);
  }

  const x = enemies.x[slot] as number;
  const y = enemies.y[slot] as number;
  const radius = table.radius[row] as number;

  if ((table.damageOverTicks[row] as number) > 0) {
    lingerOn(world, slot, magnitude, table.damageOverTicks[row] as number);
  }

  /* Radius and jumps are alternatives, not a sequence: a reaction either
     blooms outward or arcs from enemy to enemy. */
  if (radius > 0) resolveArea(world, slot, row, x, y, radius, magnitude);
  else if ((table.jumps[row] as number) > 0) resolveArc(world, slot, row, x, y, magnitude);
  else if (magnitude > 0 && (table.damageOverTicks[row] as number) === 0) {
    queueReactionDamage(world, slot, magnitude);
  }

  if ((table.bonusStacks[row] as number) > 0) amplify(world, slot, row, b);

  enemies.reactionReadyTick[slot] = world.tick + (table.cooldownTicks[row] as number);
  world.stats.reactionsTriggered += 1;
  awardReactionAether(world);
  emitReactionTriggered(world.events, row, x, y, magnitude);
}

/**
 * Everything inside the blast.
 *
 * Damage lands on all of it, including the enemy that reacted — unless the
 * reaction is already burning that one over time, in which case the burst is
 * the neighbours' share alone. Any status the reaction leaves goes to the
 * neighbours only: Combustion's ignition is explicitly something that happens
 * to the enemies *around* the one that detonated, and re-scorching the target
 * it just took Scorch from would be a loop looking for somewhere to start.
 */
function resolveArea(
  world: World,
  slot: number,
  row: number,
  x: number,
  y: number,
  radius: number,
  magnitude: number,
): void {
  const table = world.rules.reactions;
  const burns = (table.damageOverTicks[row] as number) > 0;
  const count = gather(world, x, y, radius);

  for (let i = 0; i < count; i++) {
    const other = affected[i] as number;

    /* A reaction that burns its target over time has already paid its damage
       there; the blast is then purely the neighbours' ignition. */
    if (magnitude > 0 && !burns) queueReactionDamage(world, other, magnitude);
    if (other !== slot) applyReactionStatus(world, other, row);
    softenDefence(world, other, row);
  }
}

/**
 * An arc that jumps outward from the enemy that reacted.
 *
 * The reacting enemy is the source, not a recipient — Electrolysis is the
 * crowd answer in the matrix, the way Combustion is the single-target one, and
 * paying its damage to the detonating enemy as well would blur that.
 */
function resolveArc(
  world: World,
  slot: number,
  row: number,
  x: number,
  y: number,
  magnitude: number,
): void {
  const table = world.rules.reactions;
  const jumps = table.jumps[row] as number;
  /* The arc reaches as far as the widest authored blast; without a radius of
     its own it would have to be unbounded. */
  const count = gather(world, x, y, arcRange(world));

  for (let struck = 0; struck < jumps; struck++) {
    const pick = nearestRemaining(world, x, y, count, slot);
    if (pick < 0) break;

    const other = affected[pick] as number;
    /* Struck off in place rather than compacted, so choosing four out of forty
       neighbours still allocates nothing. */
    affected[pick] = -1;

    if (magnitude > 0) queueReactionDamage(world, other, magnitude);
    applyReactionStatus(world, other, row);
    softenDefence(world, other, row);
  }
}

/**
 * Index into the scratch buffer of the closest enemy not yet struck, or -1.
 *
 * Nearest first, like chain lightning, so an arc reads as travelling outward
 * rather than teleporting to whichever enemy the spatial hash happened to list
 * first — and so the player can predict where it goes.
 */
function nearestRemaining(
  world: World,
  x: number,
  y: number,
  count: number,
  exclude: number,
): number {
  const enemies = world.enemies;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    const other = affected[i] as number;
    if (other < 0 || other === exclude) continue;

    const dx = (enemies.x[other] as number) - x;
    const dy = (enemies.y[other] as number) - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * How far an arcing reaction can reach.
 *
 * Taken from the widest radius the matrix authors rather than a constant here,
 * so a designer widening the reaction table widens the arc with it and no
 * number describing the game lives in code.
 */
function arcRange(world: World): number {
  const radii = world.rules.reactions.radius;
  let widest = 0;
  for (let row = 0; row < world.rules.reactions.count; row++) {
    const radius = radii[row] as number;
    if (radius > widest) widest = radius;
  }
  return widest;
}

/**
 * Enemies near a point, into the shared scratch buffer.
 *
 * Ground and air together: a Thermal Shock is a burst of temperature, and there
 * is no reading of the design on which it politely spares the bats overhead.
 *
 * The indexes are rebuilt at step 7 and this runs at step 3, so the positions
 * are one tick old — at the speeds enemies move that is a pixel or two against
 * a blast one and a half tiles wide, and it is the same pixel or two in every
 * run. Results are filtered for the dead, since last tick's index still holds
 * whatever died since.
 */
function gather(world: World, x: number, y: number, radius: number): number {
  const buffer = world.queryBuffer;
  let found = 0;

  for (const index of [world.groundIndex, world.airIndex]) {
    const hits = index.query(x, y, radius, buffer);
    for (let i = 0; i < hits && found < affected.length; i++) {
      const slot = buffer[i] as number;
      if (!reactable(world, slot)) continue;
      affected[found++] = slot;
    }
  }
  return found;
}

function queueReactionDamage(world: World, slot: number, amount: number): void {
  /* Arcane, so it meets Ward and ignores Armour — which is what makes a Warded
     enemy a genuine puzzle rather than a wall (docs/GAME_DESIGN.md §4.3). */
  world.damage.push(slot, amount, ARCANE, -1, DamageFlag.IsReaction);
}

/** The status a reaction leaves behind, if it leaves one. */
function applyReactionStatus(world: World, slot: number, row: number): void {
  const table = world.rules.reactions;
  const status = table.statusId[row] as number;
  if (status >= NO_STATUS) return;
  applyStatus(world, slot, status, table.statusStacks[row] as number);
}

/** Superconduct's −60%, through the generic multiplier the damage formula reads. */
function softenDefence(world: World, slot: number, row: number): void {
  const table = world.rules.reactions;
  const ticks = table.defenceTicks[row] as number;
  if (ticks === 0) return;

  world.enemies.defenceMultiplier[slot] = table.defenceMultiplier[row] as number;
  world.enemies.defenceMultiplierUntil[slot] = world.tick + ticks;
}

/** Combustion's 80 over three seconds, spread evenly across the ticks. */
function lingerOn(world: World, slot: number, total: number, ticks: number): void {
  world.enemies.burnPerTick[slot] = total / ticks;
  world.enemies.burnUntilTick[slot] = world.tick + ticks;
}

/**
 * Amplify: the matched status gains stacks and time, and nothing is consumed.
 *
 * The extra stacks go through `applyStatus`, so amplifying a fourth stack of
 * Chill into a fifth freezes the enemy exactly as a Frost Cairn's hit would.
 * The duration is then set from the status's own authored length rather than
 * extended from whatever was left, so the result does not depend on how late
 * the Amplify happened to land.
 */
function amplify(world: World, slot: number, row: number, status: number): void {
  const table = world.rules.reactions;
  applyStatus(world, slot, status, table.bonusStacks[row] as number);

  if (world.enemies.stacksOf(slot, status) === 0) return;
  const base = world.rules.statuses.durationTicks[status] as number;
  const extended = Math.round(base * (table.durationMultiplier[row] as number));
  world.enemies.statusExpiry[slot * STATUS_COUNT + status] = world.tick + extended;
}

function clearStatus(world: World, slot: number, status: number): void {
  const at = slot * STATUS_COUNT + status;
  world.enemies.statusStacks[at] = 0;
  world.enemies.statusExpiry[at] = 0;
}
