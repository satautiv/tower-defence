import { DamageFlag } from '../damage.js';
import { emitStatusApplied } from '../events.js';
import { EnemyFlag } from '../flags.js';
import { STATUS_COUNT, STATUS_INDEX } from '../status.js';
import type { World } from '../world.js';

/**
 * The substrate the signature mechanic runs on (docs/GAME_DESIGN.md §4.2).
 *
 * Statuses live in two flat arrays on the enemy pool, indexed
 * `slot * STATUS_COUNT + status`. There is exactly one expiry per pair, so a
 * status is a single timed block of stacks rather than a list of individually
 * ageing ones: reapplying refreshes the whole block, and when it lapses every
 * stack goes at once. That is what the storage can represent, and it is what
 * the design describes — "4s, refreshing".
 *
 * This system does the ageing. Applying is `applyStatus`, which every source
 * goes through so that immunities and escalation cannot be bypassed by a
 * caller that writes the arrays itself.
 *
 * One rule governs presence everywhere: a status is on an enemy for exactly the
 * ticks where `tick < expiry`. Slows, defence reduction, reactions, damage over
 * time and the inspect panel all read it that way. A status arriving on a hit
 * is applied at step 11 and aged at step 2, so it has already missed its own
 * tick's sweep — a four-second Scorch from a projectile burns 239 times rather
 * than 240. That shortfall is one tick for every status from every source,
 * which makes it uniform and deterministic rather than a special case worth
 * correcting.
 */

const FREEZE = STATUS_INDEX.freeze;

/**
 * Step 2 of the tick pipeline: burn, decay, expire.
 *
 * Runs before reactions so that the pairs the reaction system tests are the
 * ones that exist now, not the ones that existed a tick ago — an expired Chill
 * must not detonate against a Scorch that outlived it.
 */
export function statusSystem(world: World): void {
  const enemies = world.enemies;

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!enemies.isAlive(slot)) continue;
    /* Already leaving the board. Burning a corpse would queue damage against a
       slot the death pass is about to recycle. */
    if (((enemies.flags[slot] as number) & (EnemyFlag.Dying | EnemyFlag.Leaked)) !== 0) continue;

    const base = slot * STATUS_COUNT;
    for (let status = 0; status < STATUS_COUNT; status++) {
      const stacks = enemies.statusStacks[base + status] as number;
      if (stacks === 0) continue;

      if (world.tick >= (enemies.statusExpiry[base + status] as number)) {
        clearStatus(world, slot, status);
        continue;
      }

      tickDamageOverTime(world, slot, status, stacks);
    }
  }
}

/**
 * Damage over time, paid into the shared queue like everything else.
 *
 * Deliberately not applied directly to health: routing it through the queue is
 * what makes a burn that finishes an enemy award bounty through the same path a
 * projectile does, and what lets the kill be attributed and split deterministically
 * however many other sources landed on the same tick.
 */
function tickDamageOverTime(world: World, slot: number, status: number, stacks: number): void {
  const perTick = world.rules.statuses.damagePerTickPerStack[status] as number;
  if (perTick === 0) return;

  /* No source tower, and never evadable — dodging is the answer to projectiles,
     not to already being on fire. */
  world.damage.push(
    slot,
    perTick * stacks,
    world.rules.statuses.damageType[status] as number,
    -1,
    DamageFlag.None,
  );
}

/**
 * Applies stacks of a status, the only supported way to do so.
 *
 * Every source funnels here — on-hit from the damage queue, reactions (#22),
 * Warden Powers (#26), ground effects (#31) — so immunity, the stack cap,
 * refresh and escalation are decided once. A caller that wrote `statusStacks`
 * directly would silently skip all four.
 */
export function applyStatus(world: World, slot: number, status: number, stacks: number): void {
  if (stacks <= 0 || status >= STATUS_COUNT) return;
  const enemies = world.enemies;
  if (!enemies.isAlive(slot)) return;
  if (isImmune(world, slot, status)) return;

  const table = world.rules.statuses;
  const max = table.maxStacks[status] as number;
  const at = slot * STATUS_COUNT + status;

  const total = (enemies.statusStacks[at] as number) + stacks;
  const capped = total > max ? max : total;

  enemies.statusStacks[at] = capped;
  enemies.statusExpiry[at] = world.tick + (table.durationTicks[status] as number);
  /* Tells the reaction system this enemy is worth re-examining (#22). Cleared
     by whoever consumes it, not here. */
  enemies.statusDirty[slot] = 1;

  emitStatusApplied(world.events, enemies.ids[slot] as number, status, capped);

  if (capped >= max) escalate(world, slot, status);
}

/**
 * A status that converts into another at its cap — Chill into Freeze.
 *
 * The conversion happens the instant the last stack lands rather than on a
 * later tick, so five stacks of Chill and a Freeze are never observable at the
 * same time. An enemy immune to what this escalates into keeps the full cap
 * instead: a boss that cannot be frozen should still carry the deepest slow its
 * own 25% cap allows, rather than being rewarded for its immunity with less
 * Chill than an ordinary enemy would have.
 */
function escalate(world: World, slot: number, status: number): void {
  const table = world.rules.statuses;
  const into = table.escalatesTo[status] as number;
  if (into < 0) return;
  if (isImmune(world, slot, into)) return;

  applyStatus(world, slot, into, 1);

  const remaining = table.stacksAfterEscalation[status] as number;
  const at = slot * STATUS_COUNT + status;
  world.enemies.statusStacks[at] = remaining;
  /* Nothing reads an expiry behind zero stacks, but the world hash does, so it
     is zeroed rather than left pointing at a lapsed deadline. */
  if (remaining === 0) world.enemies.statusExpiry[at] = 0;
}

/**
 * Hard crowd control an enemy simply refuses (docs/GAME_DESIGN.md §10).
 *
 * Bosses and elites take the soft version of everything instead: Chill still
 * slows them, capped at 25% by the movement system, but it can never stop them
 * outright. Stuns will read the same way when something casts one (#26).
 */
function isImmune(world: World, slot: number, status: number): boolean {
  if (status !== FREEZE) return false;
  return ((world.enemies.flags[slot] as number) & EnemyFlag.FreezeImmune) !== 0;
}

/** Drops every stack and its deadline together. */
function clearStatus(world: World, slot: number, status: number): void {
  const at = slot * STATUS_COUNT + status;
  world.enemies.statusStacks[at] = 0;
  world.enemies.statusExpiry[at] = 0;
  /* An expiry changes which pairs exist as surely as an application does. */
  world.enemies.statusDirty[slot] = 1;
}
