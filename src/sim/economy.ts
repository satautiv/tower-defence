import { TICK_SECONDS } from '@core/constants';
import { TIER_SLOTS } from './ruleset.js';
import { statIndexOf, tierSlot } from './towers.js';
import { StagePhase } from './world.js';
import type { World } from './world.js';

/**
 * The only code that moves money.
 *
 * Gold and Aether are added and spent through here so the floor and the ceiling
 * are enforced in one place. Scattered `resources.gold -=` would eventually let
 * something go negative, and a negative balance in a tower defence game is a
 * bug the player experiences as an unbuildable board.
 *
 * Two currencies on purpose: gold rewards planning, Aether rewards reacting.
 * Keeping them apart is what stops "I saved up" and "I can act now" collapsing
 * into the same decision (docs/GAME_DESIGN.md §6).
 */

/** The last tier on the base path. Beyond it a tower must specialise. */
const LAST_BASE_TIER = 2;
/** The capstone of a specialisation. */
const MAX_TIER = 4;

export function addGold(world: World, amount: number, income = true): void {
  if (amount <= 0) return;
  world.resources.gold += amount;
  if (income) world.stats.goldEarned += amount;
}

export function canAfford(world: World, cost: number): boolean {
  return world.resources.gold >= cost;
}

/** Deducts only if affordable, so a caller cannot half-complete a purchase. */
export function spendGold(world: World, cost: number): boolean {
  if (cost < 0 || !canAfford(world, cost)) return false;
  world.resources.gold -= cost;
  world.stats.goldSpent += cost;
  return true;
}

export function addAether(world: World, amount: number): void {
  if (amount <= 0) return;
  const max = world.rules.tuning.aetherMax;
  const next = world.resources.aether + amount;
  world.resources.aether = next > max ? max : next;
}

export function spendAether(world: World, cost: number): boolean {
  if (cost < 0 || world.resources.aether < cost) return false;
  world.resources.aether -= cost;
  return true;
}

/* ---------------------------------------------------------------- costs */

export function buildCost(world: World, typeIdx: number): number {
  if (typeIdx < 0 || typeIdx >= world.rules.towers.ids.length) return -1;
  return world.rules.towers.cost[typeIdx * TIER_SLOTS] as number;
}

/**
 * Cost of the next rung, or -1 when there is none.
 *
 * Tier two is the end of the base path: the next step is a specialisation, not
 * an upgrade, which is the branch point the whole tower design turns on.
 */
export function upgradeCost(world: World, towerSlot: number): number {
  if (!world.towers.isAlive(towerSlot)) return -1;

  const tier = world.towers.tier[towerSlot] as number;
  const specialisation = world.towers.specialisation[towerSlot] as number;
  if (tier >= MAX_TIER) return -1;
  if (tier === LAST_BASE_TIER && specialisation < 0) return -1;

  const typeIdx = world.towers.typeIdx[towerSlot] as number;
  return world.rules.towers.cost[
    typeIdx * TIER_SLOTS + tierSlot(tier + 1, specialisation)
  ] as number;
}

/**
 * Cost of taking a branch, or -1 if the tower is not ready for one.
 *
 * Re-specialising is allowed and costs the full price again with no refund, so
 * changing your mind is possible but never free (docs/GAME_DESIGN.md §8.1).
 */
export function specialiseCost(world: World, towerSlot: number, branch: number): number {
  if (!world.towers.isAlive(towerSlot)) return -1;
  if (branch !== 0 && branch !== 1) return -1;
  if ((world.towers.tier[towerSlot] as number) < LAST_BASE_TIER) return -1;

  const typeIdx = world.towers.typeIdx[towerSlot] as number;
  return world.rules.towers.cost[typeIdx * TIER_SLOTS + tierSlot(3, branch)] as number;
}

/**
 * What selling returns: a fraction of everything sunk in, not of the last
 * upgrade. Enough that a mid-stage pivot is viable, little enough that it
 * costs something.
 */
export function sellValue(world: World, towerSlot: number): number {
  if (!world.towers.isAlive(towerSlot)) return 0;
  const fraction = refundFraction(world, towerSlot);
  return Math.floor((world.towers.invested[towerSlot] as number) * fraction);
}

function refundFraction(world: World, towerSlot: number): number {
  const id = world.rules.towers.ids[world.towers.typeIdx[towerSlot] as number];
  return world.rules.towerRefund.get(id ?? '') ?? 0.7;
}

/* ------------------------------------------------------------- per tick */

/**
 * Aether trickles in even when nothing is dying, so a quiet stretch still
 * builds toward a Warden Power — but only once the stage is running. Charging
 * during the build phase would reward standing still.
 */
export function economySystem(world: World): void {
  if (world.phase !== StagePhase.Running) return;
  addAether(world, world.rules.tuning.aetherPerSecond * TICK_SECONDS);
}

/** Aether for triggering a reaction. Called by the reaction system (#22). */
export function awardReactionAether(world: World): void {
  addAether(world, world.rules.tuning.aetherPerReaction);
}

/** Aether and gold for a kill. */
export function awardKill(world: World, typeIdx: number): void {
  addGold(world, world.rules.enemies.bounty[typeIdx] as number);
  addAether(world, world.rules.tuning.aetherPerKill);
}

/** Extra gold an economy tower adds on top of a bounty. */
export function bonusGoldFor(world: World, towerSlot: number): number {
  if (towerSlot < 0 || !world.towers.isAlive(towerSlot)) return 0;
  return world.rules.towers.bonusGoldPerKill[statIndexOf(world, towerSlot)] as number;
}
