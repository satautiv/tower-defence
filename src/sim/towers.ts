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
  applyTowerStats(world, slot);

  /* Ready to fire on the tick it is built, rather than idling for a cooldown
     the player did not ask for. */
  world.towers.cooldown[slot] = 0;
  world.towers.invested[slot] = world.rules.towers.cost[typeIdx * TIER_SLOTS] as number;

  emitTowerBuilt(world.events, world.towers.ids[slot] as number, typeIdx, plotId);
  return slot;
}

export function towerIndex(world: World, id: string): number {
  return world.rules.towers.indexOf.get(id) ?? -1;
}
