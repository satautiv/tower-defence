import { TICK_HZ } from '@core/constants';
import { DAMAGE_BY_INDEX } from './damage.js';
import { canAfford, sellValue, specialiseCost, upgradeCost } from './economy.js';
import { FiringMode, TIER_SLOTS } from './ruleset.js';
import { STATUS_BY_INDEX } from './status.js';
import { statIndexOf, tierSlot } from './towers.js';
import type { World } from './world.js';

/**
 * Read-only views of the world, for the interface.
 *
 * The UI dispatches commands and reads these; it never touches the entity
 * arrays. That keeps one direction of data flow — and means the balance
 * simulator, which drives the game through the same commands, is exercising
 * exactly the interface a human does.
 *
 * Called from React at roughly ten times a second, not per tick, so returning
 * fresh objects here is fine.
 */

export interface TierStats {
  damage: number;
  rangeTiles: number;
  fireRate: number;
  /** Sustained single-target damage. Area modes hit more than this implies. */
  dps: number;
  damageType: string;
  status: { id: string; stacks: number } | null;
  hitsAir: boolean;
  hitsGround: boolean;
  multiTarget: boolean;
}

export interface UpgradeOption {
  cost: number;
  affordable: boolean;
  /** Present stats beside what they become, for a before-and-after. */
  before: TierStats;
  after: TierStats;
}

export interface SpecialisationOption {
  branch: 0 | 1;
  id: string;
  cost: number;
  affordable: boolean;
  after: TierStats;
}

export interface TowerInfo {
  slot: number;
  id: string;
  tier: number;
  specialisation: number;
  current: TierStats;
  invested: number;
  sellValue: number;
  targetMode: number;
  /** Null at the branch point and at the capstone. */
  upgrade: UpgradeOption | null;
  /** Empty unless the tower is ready to branch. */
  specialisations: SpecialisationOption[];
  /** Whether the last build can still be taken back. */
  undoable: boolean;
}

export interface BuildOption {
  typeIdx: number;
  id: string;
  cost: number;
  affordable: boolean;
  stats: TierStats;
}

export interface PlotInfo {
  id: number;
  x: number;
  y: number;
  leyNode: string | null;
  /** Tower slot standing on it, or -1. */
  occupiedBy: number;
}

const TILE = 64;

function statsAt(world: World, statIndex: number): TierStats {
  const table = world.rules.towers;
  const interval = table.fireIntervalTicks[statIndex] as number;
  const damage = table.damage[statIndex] as number;
  const statusId = table.statusId[statIndex] as number;
  const mode = table.firingMode[statIndex] as number;
  const targets = table.targets[statIndex] as number;

  return {
    damage,
    rangeTiles: (table.range[statIndex] as number) / TILE,
    fireRate: interval > 0 ? TICK_HZ / interval : 0,
    dps: interval > 0 ? damage * (TICK_HZ / interval) : 0,
    damageType: DAMAGE_BY_INDEX[table.damageType[statIndex] as number] ?? 'kinetic',
    status:
      statusId < STATUS_BY_INDEX.length
        ? {
            id: STATUS_BY_INDEX[statusId] as string,
            stacks: table.statusStacks[statIndex] as number,
          }
        : null,
    hitsAir: targets !== 0,
    hitsGround: targets !== 1,
    multiTarget:
      mode === FiringMode.Aura ||
      mode === FiringMode.Cone ||
      mode === FiringMode.Chain ||
      (table.splashRadius[statIndex] as number) > 0,
  };
}

export function towerInfo(world: World, slot: number): TowerInfo | null {
  if (!world.towers.isAlive(slot)) return null;

  const typeIdx = world.towers.typeIdx[slot] as number;
  const tier = world.towers.tier[slot] as number;
  const specialisation = world.towers.specialisation[slot] as number;
  const current = statsAt(world, statIndexOf(world, slot));

  const nextCost = upgradeCost(world, slot);
  const upgrade: UpgradeOption | null =
    nextCost < 0
      ? null
      : {
          cost: nextCost,
          affordable: canAfford(world, nextCost),
          before: current,
          after: statsAt(world, typeIdx * TIER_SLOTS + tierSlot(tier + 1, specialisation)),
        };

  const specialisations: SpecialisationOption[] = [];
  for (const branch of [0, 1] as const) {
    const cost = specialiseCost(world, slot, branch);
    if (cost < 0) continue;
    specialisations.push({
      branch,
      id: world.rules.towers.ids[typeIdx] ?? 'unknown',
      cost,
      affordable: canAfford(world, cost),
      after: statsAt(world, typeIdx * TIER_SLOTS + tierSlot(3, branch)),
    });
  }

  return {
    slot,
    id: world.rules.towers.ids[typeIdx] ?? 'unknown',
    tier,
    specialisation,
    current,
    invested: world.towers.invested[slot] as number,
    sellValue: sellValue(world, slot),
    targetMode: world.towers.targetMode[slot] as number,
    upgrade,
    specialisations,
    undoable: canUndo(world, slot),
  };
}

/** Whether this tower is still the one the undo window is holding open. */
export function canUndo(world: World, slot: number): boolean {
  const last = world.lastBuild;
  if (last.towerSlot !== slot || !world.towers.isAlive(slot)) return false;
  if ((world.towers.ids[slot] as number) !== last.towerId) return false;
  if ((world.towers.tier[slot] as number) !== 0) return false;
  return world.tick - last.atTick <= world.rules.tuning.undoWindowSeconds * TICK_HZ;
}

/** Seconds left to take the last build back, or 0. */
export function undoSecondsRemaining(world: World): number {
  const last = world.lastBuild;
  if (last.towerSlot < 0) return 0;
  const elapsed = (world.tick - last.atTick) / TICK_HZ;
  return Math.max(0, world.rules.tuning.undoWindowSeconds - elapsed);
}

export function buildOptions(world: World): BuildOption[] {
  return world.rules.towers.ids.map((id, typeIdx) => {
    const statIndex = typeIdx * TIER_SLOTS;
    const cost = world.rules.towers.cost[statIndex] as number;
    return {
      typeIdx,
      id,
      cost,
      affordable: canAfford(world, cost),
      stats: statsAt(world, statIndex),
    };
  });
}

export function plotInfo(world: World): PlotInfo[] {
  return world.rules.plots.map((plot) => {
    let occupiedBy = -1;
    for (let slot = 0; slot < world.towers.watermark; slot++) {
      if (world.towers.isAlive(slot) && (world.towers.plotId[slot] as number) === plot.id) {
        occupiedBy = slot;
        break;
      }
    }
    return { id: plot.id, x: plot.x, y: plot.y, leyNode: plot.leyNode, occupiedBy };
  });
}

/**
 * The circle a range preview should draw, in world pixels.
 *
 * Read from the tower's resolved stats rather than recomputed, so the ring the
 * player sees is exactly the distance the targeting code uses. A preview that
 * disagreed with the simulation would be worse than none.
 */
export function rangeOf(
  world: World,
  slot: number,
): { x: number; y: number; radius: number; minRadius: number } | null {
  if (!world.towers.isAlive(slot)) return null;
  return {
    x: world.towers.x[slot] as number,
    y: world.towers.y[slot] as number,
    radius: world.towers.range[slot] as number,
    minRadius: world.towers.minRange[slot] as number,
  };
}

/** The range a tower would have if built here, for the build menu preview. */
export function prospectiveRange(world: World, typeIdx: number): number {
  if (typeIdx < 0 || typeIdx >= world.rules.towers.ids.length) return 0;
  return world.rules.towers.range[typeIdx * TIER_SLOTS] as number;
}
