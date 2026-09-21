import { TICK_HZ } from '@core/constants';
import { DAMAGE_BY_INDEX } from './damage.js';
import { canAfford, sellValue, specialiseCost, upgradeCost } from './economy.js';
import { EnemyFlag, SoldierFlag } from './flags.js';
import { FiringMode, TIER_SLOTS } from './ruleset.js';
import { STATUS_BY_INDEX, STATUS_COUNT } from './status.js';
import { effectiveDefence } from './systems/damage.js';
import { speedMultiplier } from './systems/movement.js';
import { statIndexOf, tierSlot } from './towers.js';
import { describeWave, earlyCallBonus } from './waves.js';
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
  /**
   * How far this tower's rally flag may be moved, in tiles. Zero for every
   * tower that has no soldiers, which is how the interface knows not to offer
   * a rally control at all.
   */
  rallyRangeTiles: number;
  /** Soldiers standing, and how many the tier fields. */
  soldiersAlive: number;
  soldierCount: number;
  /** What it has actually done this stage. */
  kills: number;
  damageDealt: number;
  /** The ley node under it, or null. Its bonus is already in `current`. */
  leyNode: string | null;
}

export interface PowerOption {
  index: number;
  id: string;
  cost: number;
  /** True when there is enough Aether and the cooldown has run. */
  ready: boolean;
  affordable: boolean;
  /** Whole seconds until it can be cast again, or 0. */
  cooldownRemaining: number;
  /** World pixels the reticle should preview, or 0 for a power with no area. */
  radius: number;
}

export interface HeroAbilityInfo {
  index: number;
  id: string;
  ready: boolean;
  /** Whole seconds until it can be cast again, or 0. */
  cooldownRemaining: number;
}

export interface HeroInfo {
  id: string;
  level: number;
  hp: number;
  maxHp: number;
  /** True while it is dead and counting down. */
  down: boolean;
  /** Whole seconds until it returns to the Core, or 0. */
  respawnIn: number;
  abilities: HeroAbilityInfo[];
}

export interface BuildOption {
  typeIdx: number;
  id: string;
  cost: number;
  affordable: boolean;
  /** Already includes the ley bonus, when the options were asked for a plot. */
  stats: TierStats;
  /** The node on the plot these options were built for, or null. */
  leyNode: string | null;
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

/**
 * A tier's stats as they would actually be on a given plot.
 *
 * `ley` is the node index the tower stands on, or -1. Threading it through here
 * rather than reading the raw tier table is what makes the panel and the
 * upgrade preview agree with the simulation on a ley plot: a preview that
 * quoted the unbonused number would understate every upgrade on the one plot
 * the player is most deliberate about (#27, #30).
 */
function statsAt(world: World, statIndex: number, ley = -1): TierStats {
  const table = world.rules.towers;
  const bonus = world.rules.ley;
  const attackSpeed = ley < 0 ? 1 : (bonus.attackSpeed[ley] as number);
  const interval = (table.fireIntervalTicks[statIndex] as number) / attackSpeed;
  const damage = table.damage[statIndex] as number;
  const statusId = table.statusId[statIndex] as number;
  const mode = table.firingMode[statIndex] as number;
  const targets = table.targets[statIndex] as number;

  return {
    damage,
    rangeTiles:
      ((table.range[statIndex] as number) * (ley < 0 ? 1 : (bonus.range[ley] as number))) / TILE,
    fireRate: interval > 0 ? TICK_HZ / interval : 0,
    dps: interval > 0 ? damage * (TICK_HZ / interval) : 0,
    damageType: DAMAGE_BY_INDEX[table.damageType[statIndex] as number] ?? 'kinetic',
    status:
      statusId < STATUS_BY_INDEX.length
        ? {
            id: STATUS_BY_INDEX[statusId] as string,
            stacks:
              (table.statusStacks[statIndex] as number) +
              (ley < 0 ? 0 : (bonus.statusStacks[ley] as number)),
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
  const ley = world.towers.leyNode[slot] as number;
  const current = statsAt(world, statIndexOf(world, slot), ley);

  const nextCost = upgradeCost(world, slot);
  const upgrade: UpgradeOption | null =
    nextCost < 0
      ? null
      : {
          cost: nextCost,
          affordable: canAfford(world, nextCost),
          before: current,
          after: statsAt(world, typeIdx * TIER_SLOTS + tierSlot(tier + 1, specialisation), ley),
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
      after: statsAt(world, typeIdx * TIER_SLOTS + tierSlot(3, branch), ley),
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
    rallyRangeTiles: (world.rules.towers.rallyRange[statIndexOf(world, slot)] as number) / TILE,
    soldiersAlive: countSoldiers(world, slot),
    soldierCount: world.rules.towers.soldierCount[statIndexOf(world, slot)] as number,
    kills: world.towers.kills[slot] as number,
    damageDealt: world.towers.damageDealt[slot] as number,
    leyNode: ley < 0 ? null : (world.rules.ley.ids[ley] ?? null),
  };
}

/** Soldiers of this tower that are standing, not counting down to respawn. */
function countSoldiers(world: World, tower: number): number {
  const soldiers = world.soldiers;
  let standing = 0;
  for (let slot = 0; slot < soldiers.watermark; slot++) {
    if (!soldiers.isAlive(slot)) continue;
    if ((soldiers.sourceTower[slot] as number) !== tower) continue;
    if (((soldiers.flags[slot] as number) & SoldierFlag.Respawning) !== 0) continue;
    standing++;
  }
  return standing;
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

/**
 * What could be built, as it would be on this plot.
 *
 * The plot is optional only so a caller with no plot in hand still gets the
 * plain roster. When one is given, the quoted stats are the ones the tower
 * would actually have there — which on a ley plot is the entire point of
 * marking the plot before the player commits (docs/GAME_DESIGN.md §5).
 */
export function buildOptions(world: World, plotId = -1): BuildOption[] {
  const ley = world.rules.plotById.get(plotId)?.leyNodeIdx ?? -1;

  return world.rules.towers.ids.map((id, typeIdx) => {
    const statIndex = typeIdx * TIER_SLOTS;
    const cost = world.rules.towers.cost[statIndex] as number;
    return {
      typeIdx,
      id,
      cost,
      affordable: canAfford(world, cost),
      stats: statsAt(world, statIndex, ley),
      leyNode: ley < 0 ? null : (world.rules.ley.ids[ley] ?? null),
    };
  });
}

/**
 * The Warden Powers, as the ability bar reads them.
 *
 * The widest radius any of a power's effects covers, so the targeting reticle
 * shows the area that will actually be touched rather than a nominal one. A
 * preview that disagreed with the cast would be worse than none — the same
 * rule the tower range ring follows.
 */
export function powerOptions(world: World): PowerOption[] {
  const powers = world.rules.powers;

  return powers.ids.map((id, index) => {
    const cost = powers.cost[index] as number;
    const remaining = Math.max(0, (world.powerReadyTick[index] as number) - world.tick);
    const affordable = world.resources.aether >= cost;

    let radius = 0;
    for (const effect of powers.effects[index] ?? []) {
      if (effect.radius > radius) radius = effect.radius;
    }

    return {
      index,
      id,
      cost,
      ready: affordable && remaining === 0,
      affordable,
      cooldownRemaining: Math.ceil(remaining / TICK_HZ),
      radius,
    };
  });
}

/**
 * The hero, as its HUD reads it. Null when no hero is deployed.
 *
 * The respawn countdown is here rather than inferred, because §11 asks for a
 * visible timer: a player whose hero has died needs to know how long they are
 * without it, and guessing is the difference between holding a line and
 * abandoning it.
 */
export function heroInfo(world: World): HeroInfo | null {
  const hero = world.rules.hero;
  if (hero === null || world.heroSlot < 0) return null;

  const slot = world.heroSlot;
  const down = ((world.soldiers.flags[slot] as number) & SoldierFlag.Respawning) !== 0;

  return {
    id: hero.id,
    level: hero.level,
    hp: Math.max(0, world.soldiers.hp[slot] as number),
    maxHp: world.soldiers.maxHp[slot] as number,
    down,
    respawnIn: down ? Math.ceil(world.heroRespawnIn / TICK_HZ) : 0,
    abilities: hero.abilityIds.map((id, index) => {
      const remaining = Math.max(0, (world.heroAbilityReadyTick[index] as number) - world.tick);
      return {
        index,
        id,
        ready: !down && remaining === 0,
        cooldownRemaining: Math.ceil(remaining / TICK_HZ),
      };
    }),
  };
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

/**
 * What makes an enemy need a particular answer, most pressing first.
 *
 * Each maps onto a row of the tower coverage audit (docs/GAME_DESIGN.md §8.6):
 * the preview names the problem, and the player already knows which towers
 * solve it. Support enemies join this list when they exist (#29).
 */
export const THREAT_TAGS = ['boss', 'air', 'armoured', 'warded', 'evasive'] as const;
export type ThreatTag = (typeof THREAT_TAGS)[number];

export interface WaveEnemy {
  enemyId: string;
  /** Across every group in the wave, whichever spawn it comes from. */
  count: number;
  threats: ThreatTag[];
}

export interface NextWave {
  /** Zero-based index into the wave table. */
  index: number;
  total: number;
  /** In the order they first appear. */
  enemies: WaveEnemy[];
  /** Whole seconds until it starts on its own. */
  startsInSeconds: number;
  /** Gold for calling it now, paid on top of its bounty. */
  callBonus: number;
  /** False while the most waves the board can hold are already in flight. */
  canCall: boolean;
}

export function threatsOf(world: World, typeIdx: number): ThreatTag[] {
  const table = world.rules.enemies;
  const tuning = world.rules.tuning;
  const flags = table.flags[typeIdx] as number;

  const threats: ThreatTag[] = [];
  if ((flags & EnemyFlag.Boss) !== 0) threats.push('boss');
  if ((flags & EnemyFlag.Flying) !== 0) threats.push('air');
  if ((table.armour[typeIdx] as number) >= tuning.previewArmourThreshold) threats.push('armoured');
  if ((table.ward[typeIdx] as number) >= tuning.previewWardThreshold) threats.push('warded');
  if ((table.evasion[typeIdx] as number) > 0) threats.push('evasive');
  return threats;
}

/**
 * The wave the player would call next, or null once none is left to come.
 *
 * Read from the flattened wave table the spawner itself walks, so the preview
 * cannot promise one composition while the spawner delivers another — the
 * acceptance criterion #28 is written around. The bonus is the one calling now
 * would pay, from the same function the command handler uses.
 */
export function nextWave(world: World): NextWave | null {
  if (world.finished) return null;
  const rules = world.rules;
  const index = world.wave.index + 1;
  const preview = describeWave(rules, index);
  if (preview === null) return null;

  const enemies: WaveEnemy[] = [];
  for (const group of preview.groups) {
    const listed = enemies.find((enemy) => enemy.enemyId === group.enemyId);
    if (listed !== undefined) {
      listed.count += group.count;
      continue;
    }
    enemies.push({
      enemyId: group.enemyId,
      count: group.count,
      threats: threatsOf(world, group.enemyTypeIdx),
    });
  }

  const ticks = Math.max(0, world.wave.autoStartIn);
  return {
    index,
    total: rules.waves.count,
    enemies,
    startsInSeconds: Math.ceil(ticks / TICK_HZ),
    callBonus: earlyCallBonus(rules, index, ticks),
    canCall: world.waveRunner.freeSlot() >= 0,
  };
}

export interface EnemyStatus {
  id: string;
  stacks: number;
  secondsLeft: number;
}

export interface EnemyInfo {
  slot: number;
  /** Stays with this enemy; the slot is reused once it is gone. */
  entityId: number;
  enemyId: string;
  hp: number;
  maxHp: number;
  overshield: number;
  /** As it applies now — Corrode and every other modifier included. */
  armour: number;
  baseArmour: number;
  ward: number;
  baseWard: number;
  /** Tiles per second, as it moves now: slows applied, zero while frozen. */
  speed: number;
  baseSpeed: number;
  statuses: EnemyStatus[];
  threats: ThreatTag[];
  bounty: number;
  livesCost: number;
}

/** An enemy is gone once it is dying or through, even before its slot is freed. */
function inspectable(world: World, slot: number): boolean {
  if (slot < 0 || !world.enemies.isAlive(slot)) return false;
  const flags = world.enemies.flags[slot] as number;
  return (flags & (EnemyFlag.Dying | EnemyFlag.Leaked | EnemyFlag.Burrowed)) === 0;
}

/**
 * One enemy, as the player inspects it (docs/GAME_DESIGN.md §17.3: while
 * paused, the player can read enemy stats).
 *
 * Asked for by slot and entity id together. Slots are recycled, so a slot
 * alone could quietly answer about whatever spawned into it after the enemy
 * the player chose had died; the id makes that a null instead.
 *
 * Armour and ward come from the damage formula itself, measured from in
 * front, so the panel shows exactly what a hit would meet — "no stat that only
 * exists in a wiki" (§2, P2).
 */
export function enemyInfo(world: World, slot: number, entityId: number): EnemyInfo | null {
  if (!inspectable(world, slot)) return null;
  const enemies = world.enemies;
  if ((enemies.ids[slot] as number) !== entityId) return null;

  const x = enemies.x[slot] as number;
  const y = enemies.y[slot] as number;
  const facing = enemies.facing[slot] as number;
  const frontX = x + Math.cos(facing);
  const frontY = y + Math.sin(facing);
  const typeIdx = enemies.typeIdx[slot] as number;
  const table = world.rules.enemies;

  const statuses: EnemyStatus[] = [];
  for (let status = 0; status < STATUS_COUNT; status++) {
    const stacks = enemies.stacksOf(slot, status);
    if (stacks === 0) continue;
    const expiry = enemies.statusExpiry[slot * STATUS_COUNT + status] as number;
    statuses.push({
      id: STATUS_BY_INDEX[status] as string,
      stacks,
      secondsLeft: Math.max(0, expiry - world.tick) / TICK_HZ,
    });
  }

  const baseSpeed = (enemies.speed[slot] as number) / TILE;
  return {
    slot,
    entityId,
    enemyId: table.ids[typeIdx] ?? 'unknown',
    hp: enemies.hp[slot] as number,
    maxHp: enemies.maxHp[slot] as number,
    overshield: enemies.overshield[slot] as number,
    armour: effectiveDefence(world, slot, true, 0, frontX, frontY),
    baseArmour: enemies.armour[slot] as number,
    ward: effectiveDefence(world, slot, false, 0, frontX, frontY),
    baseWard: enemies.ward[slot] as number,
    speed: baseSpeed * speedMultiplier(world, slot),
    baseSpeed,
    statuses,
    threats: threatsOf(world, typeIdx),
    bounty: table.bounty[typeIdx] as number,
    livesCost: table.livesCost[typeIdx] as number,
  };
}

/**
 * The enemy under a tap, or -1: the nearest inspectable one within `radius`
 * world pixels. Underground enemies are not drawn, so they cannot be tapped.
 */
export function enemyNear(world: World, x: number, y: number, radius: number): number {
  const enemies = world.enemies;
  let nearest = -1;
  let nearestSq = radius * radius;

  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (!inspectable(world, slot)) continue;
    const dx = (enemies.x[slot] as number) - x;
    const dy = (enemies.y[slot] as number) - y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= nearestSq) {
      nearest = slot;
      nearestSq = distanceSq;
    }
  }
  return nearest;
}
