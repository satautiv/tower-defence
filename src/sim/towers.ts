import { emitTowerBuilt } from './events.js';
import { TIER_SLOTS } from './ruleset.js';
import type { World } from './world.js';

/**
 * Placing and re-statting towers.
 *
 * A tower's stats are copied onto the entity whenever its tier changes, so the
 * firing loop reads one flat array instead of resolving a tier through content
 * every shot. Re-resolving is rare — a build or an upgrade — and reading is
 * constant, which is the right way round.
 */

export const enum TargetMode {
  First = 0,
  Last,
  Strongest,
  Weakest,
  Closest,
}

/**
 * Where a tower's current stats live in the flattened table.
 *
 * Slots 0-2 are the base path; 3-4 and 5-6 are the two specialisations. A
 * specialised tower at tier 4 reads slot 3 or 5 depending on the branch.
 */
export function tierSlot(tier: number, specialisation: number): number {
  if (specialisation < 0 || tier < 3) return Math.min(tier, 2);
  return 3 + specialisation * 2 + Math.min(tier - 3, 1);
}

/**
 * Re-resolves a tower's stats from its tier, and then from the ground it is on.
 *
 * The one funnel every rung goes through, which is what makes the ley bonus
 * hold "at every tier and specialisation" (#30) without a single upgrade path
 * having to remember it: an upgrade re-stats, and re-statting re-applies the
 * node. Three of the four bonuses are stats and land here. Surge is not — a
 * reaction's damage belongs to no tier of the tower that set it off — and is
 * read at the moment a reaction resolves instead.
 */
export function applyTowerStats(world: World, slot: number): void {
  const towers = world.towers;
  const table = world.rules.towers;
  const i =
    (towers.typeIdx[slot] as number) * TIER_SLOTS +
    tierSlot(towers.tier[slot] as number, towers.specialisation[slot] as number);

  towers.damage[slot] = table.damage[i] as number;
  towers.range[slot] = table.range[i] as number;
  towers.minRange[slot] = table.minRange[i] as number;
  towers.fireInterval[slot] = table.fireIntervalTicks[i] as number;
  towers.statusStacks[slot] = table.statusStacks[i] as number;

  const ley = towers.leyNode[slot] as number;
  if (ley < 0) return;

  const bonus = world.rules.ley;
  towers.range[slot] *= bonus.range[ley] as number;
  /* Attack *speed*, so the interval divides. Authoring the bonus as the speed
     the player is promised keeps the tuning file readable; inverting it here
     keeps the firing loop counting down ticks. */
  towers.fireInterval[slot] /= bonus.attackSpeed[ley] as number;
  towers.statusStacks[slot] += bonus.statusStacks[ley] as number;
}

/** How much a reaction this tower set off is worth. 1 unless it sits on Surge. */
export function leyReactionMultiplier(world: World, towerSlot: number): number {
  if (towerSlot < 0 || !world.towers.isAlive(towerSlot)) return 1;
  const ley = world.towers.leyNode[towerSlot] as number;
  if (ley < 0) return 1;
  return world.rules.ley.reactionDamage[ley] as number;
}

/** Current stat-table index for a live tower. */
export function statIndexOf(world: World, slot: number): number {
  return (
    (world.towers.typeIdx[slot] as number) * TIER_SLOTS +
    tierSlot(world.towers.tier[slot] as number, world.towers.specialisation[slot] as number)
  );
}

export function placeTower(
  world: World,
  typeIdx: number,
  x: number,
  y: number,
  plotId = 0,
): number {
  if (typeIdx < 0 || typeIdx >= world.rules.towers.ids.length) return -1;

  const slot = world.towers.alloc();
  if (slot < 0) return -1;

  world.towers.typeIdx[slot] = typeIdx;
  world.towers.tier[slot] = 0;
  world.towers.specialisation[slot] = -1;
  world.towers.x[slot] = x;
  world.towers.y[slot] = y;
  world.towers.plotId[slot] = plotId;
  world.towers.targetMode[slot] = TargetMode.First;
  /* Read from the plot rather than passed in, so every route that builds a
     tower — the command handler, a test, the balance simulator — gets the same
     node, and none of them can forget to hand it over. */
  world.towers.leyNode[slot] = world.rules.plotById.get(plotId)?.leyNodeIdx ?? -1;
  applyTowerStats(world, slot);

  /* Ready to fire on the tick it is built, rather than idling for a cooldown
     the player did not ask for. */
  world.towers.cooldown[slot] = 0;
  world.towers.invested[slot] = world.rules.towers.cost[typeIdx * TIER_SLOTS] as number;

  world.stats.towersBuilt += 1;
  emitTowerBuilt(world.events, world.towers.ids[slot] as number, typeIdx, plotId);
  return slot;
}

/**
 * Moves a tower up one rung and re-resolves its stats.
 *
 * Cost and affordability are the caller's business; this is the state change
 * alone, so the command handler can refuse cleanly without having to undo a
 * half-applied upgrade.
 */
export function raiseTowerTier(world: World, slot: number, invested: number): void {
  world.towers.tier[slot] = (world.towers.tier[slot] as number) + 1;
  world.towers.invested[slot] = (world.towers.invested[slot] as number) + invested;
  applyTowerStats(world, slot);
  /* Re-targeted next tick: the new tier may reach further or stop reaching air. */
  world.towers.target[slot] = -1;
}

/**
 * Takes a tier-four branch.
 *
 * Re-specialising an already-branched tower is allowed and simply overwrites
 * the branch at tier four — the price was paid again, and dropping back to
 * tier four is what makes the choice cost something.
 */
export function setTowerSpecialisation(
  world: World,
  slot: number,
  branch: number,
  invested: number,
): void {
  world.towers.specialisation[slot] = branch;
  world.towers.tier[slot] = 3;
  world.towers.invested[slot] = (world.towers.invested[slot] as number) + invested;
  applyTowerStats(world, slot);
  world.towers.target[slot] = -1;
}

export function removeTower(world: World, slot: number): void {
  world.towers.free(slot);
}

/** Whether a plot already carries a tower. */
export function plotOccupant(world: World, plotId: number): number {
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (!world.towers.isAlive(slot)) continue;
    if ((world.towers.plotId[slot] as number) === plotId) return slot;
  }
  return -1;
}

export function towerIndex(world: World, id: string): number {
  return world.rules.towers.indexOf.get(id) ?? -1;
}
