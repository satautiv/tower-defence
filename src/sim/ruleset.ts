import { TICK_HZ, TILE_SIZE } from '@core/constants';
import type { ContentRegistry } from '@content/loader';
import type { StageDefinition } from '@content/schema/stage';
import type { TowerTier } from '@content/schema/tower';
import type { TuningDefinition } from '@content/schema/tuning';
import { LEY_NODE_TYPES, STATUS_BY_DAMAGE_TYPE } from '@content/schema/common';
import { MAX_GROUPS_PER_WAVE } from './capacity.js';
import { STATUS_COUNT, STATUS_INDEX } from './status.js';
import { BehaviourFlag, EnemyFlag, TowerPerk } from './flags.js';
import { DAMAGE_INDEX } from './damage.js';
import { resolveEffect } from './effects.js';
import type { ResolvedEffect } from './effects.js';
import { BakedPath } from './path.js';

/**
 * Authored content, resolved into flat numeric tables.
 *
 * The simulation never reads a JSON object or looks up a string id during a
 * tick. Content is turned into typed arrays once at stage load, and systems
 * index them by `typeIdx`. That keeps the hot path free of property lookups and
 * megamorphic shapes, and it means a balance change is a data edit with no code
 * path to follow.
 *
 * Immutable for the life of a stage. Anything that changes during play lives on
 * the World; anything authored lives here.
 */

export interface EnemyTable {
  /** typeIdx to content id, for events, the codex and debugging. */
  readonly ids: readonly string[];
  readonly hp: Float32Array;
  /** World pixels per second. Content authors tiles per second. */
  readonly speed: Float32Array;
  readonly armour: Float32Array;
  readonly ward: Float32Array;
  readonly rearArmour: Float32Array;
  readonly overshield: Float32Array;
  readonly bounty: Int32Array;
  readonly livesCost: Int32Array;
  readonly meleeDamage: Float32Array;
  readonly meleeIntervalTicks: Float32Array;
  /** Ticks a soldier may hold this enemy before it shoulders past. */
  readonly maxBlockTicks: Float32Array;
  /** Chance in [0,1] to ignore a projectile entirely. */
  readonly evasion: Float32Array;
  /** Enemy index this splits into on death, or -1, and how many. */
  readonly splitsInto: Int16Array;
  readonly splitCount: Uint8Array;
  /** EnemyFlag bits implied by the enemy's traits. */
  readonly flags: Uint16Array;

  /**
   * BehaviourFlag bits, keyed by type rather than held per enemy (#29).
   *
   * Zero for most of the roster, which is what lets the behaviour system reject
   * an ordinary Husk in one test rather than checking eight things about it.
   */
  readonly behaviour: Uint16Array;
  /** World pixels. The reach of a heal, a shield, or either aura. */
  readonly auraRadius: Float32Array;
  /** How many allies a healer or shielder picks. */
  readonly auraTargets: Uint8Array;
  readonly healPerTick: Float32Array;
  /** Overshield a shielder grants, and how often it refreshes. */
  readonly shieldAmount: Float32Array;
  /** Multiplier a Nullifier puts on a tower's rate of fire. 1 for everyone else. */
  readonly towerFireRateMultiplier: Float32Array;
  /** What a Standard Bearer gives its neighbours. Neutral at 1 and 0. */
  readonly allySpeedMultiplier: Float32Array;
  readonly allyArmourBonus: Float32Array;
  /** Ticks a sapper holds a tower down for, and how long it winds up first. */
  readonly disableTicks: Float32Array;
  readonly telegraphTicks: Float32Array;
  /** Single-hit damage that makes a Phase Stalker jump, and how far in pixels. */
  readonly phaseDamageThreshold: Float32Array;
  readonly phaseDistance: Float32Array;
  /** Enemy index a carrier or spawner produces, or -1, how many, how often. */
  readonly spawns: Int16Array;
  readonly spawnCount: Uint8Array;
  readonly spawnIntervalTicks: Float32Array;

  readonly indexOf: ReadonlyMap<string, number>;
}

export interface StatusTable {
  readonly maxStacks: Uint8Array;
  readonly durationTicks: Int32Array;
  readonly damagePerTickPerStack: Float32Array;
  readonly slowPerStack: Float32Array;
  readonly defenceReductionPerStack: Float32Array;
  readonly vulnerabilityPerStack: Float32Array;
  /** Extra chain jumps this status grants, per stack. */
  readonly chainTargetsPerStack: Float32Array;
  /** Damage type a damage-over-time status deals, so armour and ward apply. */
  readonly damageType: Uint8Array;
  /** Status this escalates into at max stacks, or -1. */
  readonly escalatesTo: Int8Array;
  readonly stacksAfterEscalation: Uint8Array;
  readonly reactive: Uint8Array;
}

/**
 * The reaction matrix, flattened (docs/GAME_DESIGN.md §4.3).
 *
 * Authored order is priority order: the system takes the first row whose pair
 * an enemy carries, so a retune that wants Combustion to beat Thermal Shock is
 * a move in the JSON file and nothing else. Amplify is authored last precisely
 * because it should never pre-empt a real reaction.
 */
export interface ReactionTable {
  readonly count: number;
  readonly ids: readonly string[];
  readonly a: Uint8Array;
  /** 255 for `any`, which matches any other reactive status. */
  readonly b: Uint8Array;
  readonly consumes: Uint8Array;
  readonly cooldownTicks: Int32Array;
  readonly baseDamage: Float32Array;
  readonly damagePerStack: Float32Array;
  /** World pixels. */
  readonly radius: Float32Array;
  readonly jumps: Uint8Array;
  /** Ticks to spread the damage over, or 0 to deal it at once. */
  readonly damageOverTicks: Int32Array;
  readonly defenceMultiplier: Float32Array;
  readonly defenceTicks: Int32Array;
  /** 255 when the reaction leaves no status behind. */
  readonly statusId: Uint8Array;
  readonly statusStacks: Uint8Array;
  readonly bonusStacks: Uint8Array;
  readonly durationMultiplier: Float32Array;
}

/**
 * Waves, flattened.
 *
 * Group data is laid out `wave * MAX_GROUPS_PER_WAVE + group` so the spawner
 * indexes arithmetic rather than walking nested arrays, and so the wave preview
 * reads the very same numbers the spawner does — the two cannot drift into
 * telling the player one thing and spawning another.
 */
export interface WaveTable {
  readonly count: number;
  readonly groupCount: Uint8Array;
  readonly autoStartTicks: Int32Array;
  readonly clearBonus: Int32Array;
  /** Total gold every enemy in the wave is worth. Caps the early-call bonus. */
  readonly totalBounty: Int32Array;
  /** Ticks from the wave starting until its last enemy has spawned. */
  readonly spawnDurationTicks: Float32Array;

  readonly groupEnemy: Int16Array;
  readonly groupCountPer: Uint16Array;
  readonly groupIntervalTicks: Float32Array;
  readonly groupDelayTicks: Float32Array;
  readonly groupSpawnPoint: Uint8Array;
}

/**
 * Seven stat blocks per tower: tiers one to three, then two tiers for each of
 * the two specialisations. Flattened `tower * TIER_SLOTS + slot`, so resolving
 * a tower's current stats is one index rather than a walk through nested
 * content.
 */
export const TIER_SLOTS = 7;

export const enum FiringMode {
  Projectile = 0,
  Ballistic,
  Beam,
  Chain,
  Aura,
  Cone,
}

export const enum TargetClass {
  Ground = 0,
  Air,
  Both,
}

export interface TowerTable {
  readonly ids: readonly string[];
  readonly indexOf: ReadonlyMap<string, number>;
  readonly cost: Int32Array;
  readonly damage: Float32Array;
  readonly damageType: Uint8Array;
  /** Ticks between shots. */
  readonly fireIntervalTicks: Float32Array;
  readonly range: Float32Array;
  readonly minRange: Float32Array;
  readonly splashRadius: Float32Array;
  readonly targets: Uint8Array;
  readonly firingMode: Uint8Array;
  /** Pixels per tick. */
  readonly projectileSpeed: Float32Array;
  /**
   * Cosine of the cone's half-angle, precomputed so the containment test is a
   * dot product with no trigonometry in the firing loop.
   */
  readonly coneCos: Float32Array;
  readonly chainTargets: Uint8Array;
  readonly chainFalloff: Float32Array;
  readonly armourPierce: Float32Array;
  readonly bonusGoldPerKill: Float32Array;
  /** 255 when the tier applies no status. */
  readonly statusId: Uint8Array;
  readonly statusStacks: Uint8Array;

  /**
   * TowerPerk bits for this tier (#32), and the numbers each one reads.
   *
   * Keyed by stat index, so an upgrade or a branch picks its perks up through
   * `applyTowerStats` with nothing else to remember, and zero for every tier
   * that is only a stat block.
   */
  readonly perks: Uint16Array;
  readonly pierceFraction: Float32Array;
  /** 255 when the tier has no status it hits harder into. */
  readonly bonusVsStatus: Uint8Array;
  readonly bonusVsStatusMultiplier: Float32Array;
  readonly armourPerChillStack: Float32Array;
  readonly spreadStacks: Uint8Array;
  readonly spreadRadius: Float32Array;
  readonly groundTicks: Float32Array;
  readonly groundRadiusTiles: Float32Array;
  readonly groundDamagePerSecond: Float32Array;
  readonly freezePulseTicks: Float32Array;
  readonly pullDistance: Float32Array;
  readonly refractRadius: Float32Array;
  readonly refractBonusPerType: Float32Array;
  readonly globalGoldFraction: Float32Array;
  readonly tauntTicks: Float32Array;
  readonly tauntRadius: Float32Array;
  readonly reflectFraction: Float32Array;
  readonly markMultiplier: Float32Array;
  readonly markTicks: Float32Array;

  /** Soldiers this tier fields. Zero for every tower that shoots. */
  readonly soldierCount: Uint8Array;
  readonly soldierHp: Float32Array;
  readonly soldierDamage: Float32Array;
  readonly soldierIntervalTicks: Float32Array;
  readonly soldierArmour: Float32Array;
  readonly soldierDamageType: Uint8Array;
  readonly soldierRespawnTicks: Float32Array;
  /** World pixels. */
  readonly rallyRange: Float32Array;
  readonly soldierAttackRange: Float32Array;
  readonly soldierRegenPerTick: Float32Array;
  readonly soldierStatusId: Uint8Array;
  readonly soldierStatusStacks: Uint8Array;
}

export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly pathId: number;
}

export interface BuildPlot {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** Ley node type for display, or null. */
  readonly leyNode: string | null;
  /** Index into `LeyTable`, or -1. What the simulation actually reads. */
  readonly leyNodeIdx: number;
}

/**
 * The ley node bonuses, resolved (docs/GAME_DESIGN.md §5).
 *
 * Indexed by the position of the type in `LEY_NODE_TYPES`, so a tower carries
 * a small integer rather than a string and the stat pipeline multiplies four
 * numbers without ever asking which kind of node it is standing on.
 */
export interface LeyTable {
  readonly ids: readonly string[];
  readonly attackSpeed: Float32Array;
  readonly range: Float32Array;
  readonly statusStacks: Uint8Array;
  readonly reactionDamage: Float32Array;
}

/**
 * The stage's one-shot lever, resolved into the units the simulation works in.
 *
 * Null when the map has none. Every field is already a tick count or a pixel
 * by the time a tick can see it, like the rest of the ruleset.
 */
export interface Interactable {
  readonly id: string;
  readonly nameKey: string;
  readonly x: number;
  readonly y: number;
  readonly cost: number;
  readonly effect: string;
  readonly radiusTiles: number;
  readonly seconds: number;
  readonly damagePerSecond: number;
  readonly damageType: number;
  readonly blocks: boolean;
  /** 255 when the lever leaves no status behind. */
  readonly statusId: number;
  readonly statusStacks: number;
}

/**
 * The Warden Powers, resolved.
 *
 * Cooldowns in ticks, effects in numbers. The player equips two of five before
 * a stage (§6), so the table holds all of them and the loadout is a per-run
 * choice rather than a content one.
 */
export interface PowerTable {
  readonly count: number;
  readonly ids: readonly string[];
  readonly indexOf: ReadonlyMap<string, number>;
  readonly cost: Int32Array;
  readonly cooldownTicks: Int32Array;
  readonly effects: ReadonlyArray<readonly ResolvedEffect[]>;
}

/**
 * The hero, resolved.
 *
 * One hero per run, chosen before the stage, so this is the one the world was
 * built with rather than a table of all of them. Per-level growth is folded in
 * at load, because a hero's level does not change during a stage — it changes
 * between them (docs/GAME_DESIGN.md §11).
 */
export interface HeroRules {
  readonly id: string;
  readonly level: number;
  readonly hp: number;
  readonly damage: number;
  readonly damageType: number;
  readonly attackIntervalTicks: number;
  readonly attackRange: number;
  readonly armour: number;
  readonly respawnTicks: number;
  readonly abilityIds: readonly string[];
  readonly abilityCooldownTicks: Int32Array;
  readonly abilityEffects: ReadonlyArray<readonly ResolvedEffect[]>;
}

/**
 * Wave scaling, resolved for the stage being played (docs/GAME_DESIGN.md §9.2).
 *
 * The region and difficulty parts are fixed for a run, so they are folded once
 * here rather than recomputed at every spawn; only the per-wave term varies.
 */
export interface ScalingRules {
  /** regionMult x difficultyMult — everything that does not vary by wave. */
  readonly hp: number;
  readonly hpGrowthPerWave: number;
  readonly defenceGrowthFraction: number;
  /** sqrt(regionMult) x sqrt(difficultyMult): later regions pay more, sublinearly. */
  readonly bounty: number;
}

export interface Ruleset {
  /** Global combat and economy constants. */
  readonly tuning: TuningDefinition;
  readonly scaling: ScalingRules;
  readonly towers: TowerTable;
  readonly enemies: EnemyTable;
  readonly statuses: StatusTable;
  readonly reactions: ReactionTable;
  readonly powers: PowerTable;
  /** The hero taken into this stage, or null when none is deployed. */
  readonly hero: HeroRules | null;
  readonly waves: WaveTable;
  readonly paths: readonly BakedPath[];
  readonly pathById: ReadonlyMap<number, BakedPath>;
  readonly spawnPoints: readonly SpawnPoint[];
  readonly plots: readonly BuildPlot[];
  readonly plotById: ReadonlyMap<number, BuildPlot>;
  readonly ley: LeyTable;
  /** Decorative ley seams, in world pixels. Read by the view, never by a tick. */
  readonly leySeams: ReadonlyArray<ReadonlyArray<{ readonly x: number; readonly y: number }>>;
  /** Fraction of gold returned on sale, per tower id. */
  readonly towerRefund: ReadonlyMap<string, number>;
  readonly core: { readonly x: number; readonly y: number };
  /** How far apart a pack spreads sideways, in world pixels. */
  readonly laneWidth: number;
  /** The map's one-shot lever, or null. */
  readonly interactable: Interactable | null;
}

/** Traits that map directly onto a per-entity flag. */
const TRAIT_FLAGS: Readonly<Record<string, number>> = {
  flying: EnemyFlag.Flying,
  freeze_immune: EnemyFlag.FreezeImmune,
  directional_armour: EnemyFlag.DirectionalArmour,
  burrow: EnemyFlag.CanBurrow,
};

/** Traits that map onto a behaviour the behaviour system carries out (#29). */
const TRAIT_BEHAVIOURS: Readonly<Record<string, number>> = {
  healer: BehaviourFlag.Healer,
  shielder: BehaviourFlag.Shielder,
  tower_slow_aura: BehaviourFlag.TowerSlowAura,
  ally_haste_aura: BehaviourFlag.AllyHasteAura,
  sapper: BehaviourFlag.Sapper,
  carrier: BehaviourFlag.Carrier,
  stationary_spawner: BehaviourFlag.StationarySpawner,
  phase: BehaviourFlag.Phase,
};

function behaviourForTraits(traits: readonly string[]): number {
  let mask = 0;
  for (const trait of traits) mask |= TRAIT_BEHAVIOURS[trait] ?? 0;
  return mask;
}

function flagsForTraits(traits: readonly string[]): number {
  let flags = 0;
  for (const trait of traits) flags |= TRAIT_FLAGS[trait] ?? 0;
  /* Bosses are immune to hard crowd control by rule rather than by trait, so
     an author cannot forget to mark one (docs/GAME_DESIGN.md §10). */
  if (traits.includes('boss')) {
    flags |= EnemyFlag.Boss | EnemyFlag.FreezeImmune | EnemyFlag.StunImmune;
  }
  return flags;
}

function buildEnemyTable(registry: ContentRegistry): EnemyTable {
  const ids = [...registry.enemies.keys()].sort();
  const count = ids.length;

  const table: EnemyTable = {
    ids,
    hp: new Float32Array(count),
    speed: new Float32Array(count),
    armour: new Float32Array(count),
    ward: new Float32Array(count),
    rearArmour: new Float32Array(count),
    overshield: new Float32Array(count),
    bounty: new Int32Array(count),
    livesCost: new Int32Array(count),
    meleeDamage: new Float32Array(count),
    meleeIntervalTicks: new Float32Array(count),
    maxBlockTicks: new Float32Array(count),
    evasion: new Float32Array(count),
    splitsInto: new Int16Array(count).fill(-1),
    splitCount: new Uint8Array(count),
    flags: new Uint16Array(count),
    behaviour: new Uint16Array(count),
    auraRadius: new Float32Array(count),
    auraTargets: new Uint8Array(count),
    healPerTick: new Float32Array(count),
    shieldAmount: new Float32Array(count),
    /* Neutral defaults, so a system can multiply unconditionally rather than
       branching on whether this enemy happens to carry an aura. */
    towerFireRateMultiplier: new Float32Array(count).fill(1),
    allySpeedMultiplier: new Float32Array(count).fill(1),
    allyArmourBonus: new Float32Array(count),
    disableTicks: new Float32Array(count),
    telegraphTicks: new Float32Array(count),
    phaseDamageThreshold: new Float32Array(count),
    phaseDistance: new Float32Array(count),
    spawns: new Int16Array(count).fill(-1),
    spawnCount: new Uint8Array(count),
    spawnIntervalTicks: new Float32Array(count),
    indexOf: new Map(ids.map((id, index) => [id, index])),
  };

  ids.forEach((id, i) => {
    const enemy = registry.enemies.get(id);
    if (enemy === undefined) return;
    table.hp[i] = enemy.hp;
    table.speed[i] = enemy.speed * TILE_SIZE;
    table.armour[i] = enemy.armour;
    table.ward[i] = enemy.ward;
    table.rearArmour[i] = enemy.traitConfig.rearArmour ?? enemy.armour;
    table.overshield[i] = enemy.traitConfig.overshield ?? 0;
    table.bounty[i] = enemy.bounty;
    table.livesCost[i] = enemy.livesCost;
    table.meleeDamage[i] = enemy.meleeDamage;
    table.meleeIntervalTicks[i] = enemy.meleeIntervalSeconds * TICK_HZ;
    table.maxBlockTicks[i] = enemy.maxBlockSeconds * TICK_HZ;
    table.evasion[i] = enemy.traitConfig.evasionChance ?? 0;
    table.splitCount[i] = enemy.traitConfig.splitCount ?? 0;
    table.flags[i] = flagsForTraits(enemy.traits);

    const config = enemy.traitConfig;
    table.behaviour[i] = behaviourForTraits(enemy.traits);
    table.auraRadius[i] = (config.auraRadiusTiles ?? 0) * TILE_SIZE;
    table.auraTargets[i] = config.auraTargets ?? 0;
    table.healPerTick[i] = (config.healPerSecond ?? 0) / TICK_HZ;
    /* A shielder's `overshield` is the pool it *grants*; on an enemy with the
       overshield trait the same field is the pool it carries. One number, two
       readings, decided by which trait is present. */
    table.shieldAmount[i] = config.overshield ?? 0;
    table.towerFireRateMultiplier[i] = config.towerFireRateMultiplier ?? 1;
    table.allySpeedMultiplier[i] = config.allySpeedMultiplier ?? 1;
    table.allyArmourBonus[i] = config.allyArmourBonus ?? 0;
    table.disableTicks[i] = (config.disableSeconds ?? 0) * TICK_HZ;
    table.telegraphTicks[i] = (config.telegraphSeconds ?? 0) * TICK_HZ;
    table.phaseDamageThreshold[i] = config.phaseDamageThreshold ?? 0;
    table.phaseDistance[i] = (config.phaseDistanceTiles ?? 0) * TILE_SIZE;
    table.spawnCount[i] = config.spawnCount ?? 0;
    /* One column for every periodic behaviour: a shielder's refresh and a
       carrier's drop are the same clock with different payloads. */
    table.spawnIntervalTicks[i] =
      (config.spawnIntervalSeconds ?? config.refreshIntervalSeconds ?? 0) * TICK_HZ;

    /* A stationary spawner is stationary by its trait rather than by an author
       remembering to write speed: 0. */
    if ((table.behaviour[i] as number) & BehaviourFlag.StationarySpawner) table.speed[i] = 0;
  });

  /* Resolved in a second pass: a splitter or a carrier may name an enemy that
     appears later in the sorted list, so every index has to exist first. */
  ids.forEach((id, i) => {
    const config = registry.enemies.get(id)?.traitConfig;
    if (config?.splitsInto !== undefined) {
      table.splitsInto[i] = table.indexOf.get(config.splitsInto) ?? -1;
    }
    if (config?.spawns !== undefined) table.spawns[i] = table.indexOf.get(config.spawns) ?? -1;
  });

  return table;
}

/**
 * Which element's damage a status's damage-over-time deals.
 *
 * Inverted from the authored damage-type-to-status map rather than restated, so
 * Scorch burning as Pyro and Corrode as Toxic follows from the same table
 * content-lint validates towers against. A status with no element of its own —
 * Freeze, which is derived — falls back to Arcane, matching reaction damage.
 */
function dotDamageTypes(): Uint8Array {
  const types = new Uint8Array(STATUS_COUNT).fill(DAMAGE_INDEX.arcane);
  for (const [damageType, status] of Object.entries(STATUS_BY_DAMAGE_TYPE)) {
    if (status === undefined) continue;
    types[STATUS_INDEX[status]] = DAMAGE_INDEX[damageType as keyof typeof DAMAGE_INDEX];
  }
  return types;
}

function buildStatusTable(registry: ContentRegistry): StatusTable {
  const table: StatusTable = {
    maxStacks: new Uint8Array(STATUS_COUNT),
    durationTicks: new Int32Array(STATUS_COUNT),
    damagePerTickPerStack: new Float32Array(STATUS_COUNT),
    slowPerStack: new Float32Array(STATUS_COUNT),
    defenceReductionPerStack: new Float32Array(STATUS_COUNT),
    vulnerabilityPerStack: new Float32Array(STATUS_COUNT),
    chainTargetsPerStack: new Float32Array(STATUS_COUNT),
    damageType: dotDamageTypes(),
    escalatesTo: new Int8Array(STATUS_COUNT).fill(-1),
    stacksAfterEscalation: new Uint8Array(STATUS_COUNT),
    reactive: new Uint8Array(STATUS_COUNT),
  };

  for (const status of registry.statuses.values()) {
    const i = STATUS_INDEX[status.id];
    table.maxStacks[i] = status.maxStacks;
    table.durationTicks[i] = Math.round(status.durationSeconds * TICK_HZ);
    /* Content states damage per second; the simulation works in ticks. */
    table.damagePerTickPerStack[i] = status.damagePerSecondPerStack / TICK_HZ;
    table.slowPerStack[i] = status.slowPerStack;
    table.defenceReductionPerStack[i] = status.defenceReductionPerStack;
    table.vulnerabilityPerStack[i] = status.vulnerabilityPerStack;
    table.chainTargetsPerStack[i] = status.chainTargetsPerStack;
    table.escalatesTo[i] = status.escalatesTo === undefined ? -1 : STATUS_INDEX[status.escalatesTo];
    table.stacksAfterEscalation[i] = status.stacksAfterEscalation;
    table.reactive[i] = status.reactive ? 1 : 0;
  }

  return table;
}

/** `any` in the b column, which no real status index can collide with. */
export const REACTION_ANY = 255;

function buildReactionTable(registry: ContentRegistry): ReactionTable {
  /* Authored order, not sorted: it is the priority order the matrix resolves
     in, so re-sorting here would silently change which reaction wins. */
  const definitions = [...registry.reactions.values()];
  const count = definitions.length;

  const table: ReactionTable = {
    count,
    ids: definitions.map((reaction) => reaction.id),
    a: new Uint8Array(count),
    b: new Uint8Array(count),
    consumes: new Uint8Array(count),
    cooldownTicks: new Int32Array(count),
    baseDamage: new Float32Array(count),
    damagePerStack: new Float32Array(count),
    radius: new Float32Array(count),
    jumps: new Uint8Array(count),
    damageOverTicks: new Int32Array(count),
    defenceMultiplier: new Float32Array(count).fill(1),
    defenceTicks: new Int32Array(count),
    statusId: new Uint8Array(count).fill(255),
    statusStacks: new Uint8Array(count),
    bonusStacks: new Uint8Array(count),
    durationMultiplier: new Float32Array(count).fill(1),
  };

  definitions.forEach((reaction, i) => {
    table.a[i] = STATUS_INDEX[reaction.a];
    table.b[i] = reaction.b === 'any' ? REACTION_ANY : STATUS_INDEX[reaction.b];
    table.consumes[i] = reaction.consumes ? 1 : 0;
    table.cooldownTicks[i] = Math.round(reaction.cooldownSeconds * TICK_HZ);
    table.baseDamage[i] = reaction.baseDamage;
    table.damagePerStack[i] = reaction.damagePerStack;
    table.radius[i] = reaction.radiusTiles * TILE_SIZE;
    table.jumps[i] = reaction.jumps;
    table.damageOverTicks[i] = Math.round(reaction.damageOverSeconds * TICK_HZ);
    table.defenceMultiplier[i] = reaction.defenceMultiplier;
    table.defenceTicks[i] = Math.round(reaction.defenceSeconds * TICK_HZ);
    if (reaction.appliesStatus !== undefined) {
      table.statusId[i] = STATUS_INDEX[reaction.appliesStatus.status];
      table.statusStacks[i] = reaction.appliesStatus.stacks;
    }
    table.bonusStacks[i] = reaction.bonusStacks;
    table.durationMultiplier[i] = reaction.durationMultiplier;
  });

  return table;
}

const MODE_INDEX: Readonly<Record<string, number>> = {
  projectile: FiringMode.Projectile,
  ballistic: FiringMode.Ballistic,
  beam: FiringMode.Beam,
  chain: FiringMode.Chain,
  aura: FiringMode.Aura,
  cone: FiringMode.Cone,
};

const TARGET_INDEX: Readonly<Record<string, number>> = {
  ground: TargetClass.Ground,
  air: TargetClass.Air,
  both: TargetClass.Both,
};

/** What `statusId` and friends hold when a tier names no status. */
const NO_STATUS = 255;

/** Trait id to bit, so a perk is authored by name and read as a mask (#32). */
const PERK_BITS: Readonly<Record<string, number>> = {
  pierce_fraction: TowerPerk.PierceFraction,
  bonus_vs_status: TowerPerk.BonusVsStatus,
  chill_sunders: TowerPerk.ChillSunders,
  discharge_at_cap: TowerPerk.DischargeAtCap,
  spread_on_death: TowerPerk.SpreadOnDeath,
  leaves_ground: TowerPerk.LeavesGround,
  freeze_pulse: TowerPerk.FreezePulse,
  piercing: TowerPerk.Piercing,
  pulls: TowerPerk.Pulls,
  refracts: TowerPerk.Refracts,
  global_gold: TowerPerk.GlobalGold,
  taunts: TowerPerk.Taunts,
  reflects: TowerPerk.Reflects,
  marks_target: TowerPerk.MarksTarget,
};

/**
 * Flattens a tier's perks and their numbers into the table.
 *
 * Every value lands in its own column even when the perk that reads it is
 * absent, so a system can multiply or add unconditionally rather than branch
 * twice — once on the mask and once on whether the number is there.
 */
function applyPerks(table: TowerTable, i: number, tier: TowerTier): void {
  let mask = 0;
  for (const perk of tier.perks) mask |= PERK_BITS[perk] ?? 0;
  table.perks[i] = mask;
  if (mask === 0) return;

  const config = tier.perkConfig;
  table.pierceFraction[i] = config.pierceFraction ?? 0;
  if (config.bonusVsStatus !== undefined) {
    table.bonusVsStatus[i] = STATUS_INDEX[config.bonusVsStatus];
  }
  table.bonusVsStatusMultiplier[i] = config.bonusVsStatusMultiplier ?? 1;
  table.armourPerChillStack[i] = config.armourPerChillStack ?? 0;
  table.spreadStacks[i] = config.spreadStacks ?? 0;
  table.spreadRadius[i] = (config.spreadRadiusTiles ?? 0) * TILE_SIZE;
  /* Ground patches keep their radius in *tiles*: `createGroundEffect` converts,
     and handing it pixels would double the conversion. */
  table.groundTicks[i] = (config.groundSeconds ?? 0) * TICK_HZ;
  table.groundRadiusTiles[i] = config.groundRadiusTiles ?? 0;
  table.groundDamagePerSecond[i] = config.groundDamagePerSecond ?? 0;
  table.freezePulseTicks[i] = (config.freezePulseSeconds ?? 0) * TICK_HZ;
  table.pullDistance[i] = (config.pullTiles ?? 0) * TILE_SIZE;
  table.refractRadius[i] = (config.refractRadiusTiles ?? 0) * TILE_SIZE;
  table.refractBonusPerType[i] = config.refractBonusPerType ?? 0;
  table.globalGoldFraction[i] = config.globalGoldFraction ?? 0;
  table.tauntTicks[i] = (config.tauntSeconds ?? 0) * TICK_HZ;
  table.tauntRadius[i] = (config.tauntRadiusTiles ?? 0) * TILE_SIZE;
  table.reflectFraction[i] = config.reflectFraction ?? 0;
  table.markMultiplier[i] = config.markMultiplier ?? 1;
  table.markTicks[i] = (config.markSeconds ?? 0) * TICK_HZ;
}

function buildTowerTable(registry: ContentRegistry): TowerTable {
  const ids = [...registry.towers.keys()].sort();
  const slots = ids.length * TIER_SLOTS;

  const table: TowerTable = {
    ids,
    indexOf: new Map(ids.map((id, index) => [id, index])),
    cost: new Int32Array(slots),
    damage: new Float32Array(slots),
    damageType: new Uint8Array(slots),
    fireIntervalTicks: new Float32Array(slots),
    range: new Float32Array(slots),
    minRange: new Float32Array(slots),
    splashRadius: new Float32Array(slots),
    targets: new Uint8Array(slots),
    firingMode: new Uint8Array(slots),
    projectileSpeed: new Float32Array(slots),
    coneCos: new Float32Array(slots),
    chainTargets: new Uint8Array(slots),
    chainFalloff: new Float32Array(slots),
    armourPierce: new Float32Array(slots),
    bonusGoldPerKill: new Float32Array(slots),
    statusId: new Uint8Array(slots).fill(255),
    statusStacks: new Uint8Array(slots),
    perks: new Uint16Array(slots),
    pierceFraction: new Float32Array(slots),
    bonusVsStatus: new Uint8Array(slots).fill(NO_STATUS),
    bonusVsStatusMultiplier: new Float32Array(slots).fill(1),
    armourPerChillStack: new Float32Array(slots),
    spreadStacks: new Uint8Array(slots),
    spreadRadius: new Float32Array(slots),
    groundTicks: new Float32Array(slots),
    groundRadiusTiles: new Float32Array(slots),
    groundDamagePerSecond: new Float32Array(slots),
    freezePulseTicks: new Float32Array(slots),
    pullDistance: new Float32Array(slots),
    refractRadius: new Float32Array(slots),
    refractBonusPerType: new Float32Array(slots),
    globalGoldFraction: new Float32Array(slots),
    tauntTicks: new Float32Array(slots),
    tauntRadius: new Float32Array(slots),
    reflectFraction: new Float32Array(slots),
    markMultiplier: new Float32Array(slots).fill(1),
    markTicks: new Float32Array(slots),
    soldierCount: new Uint8Array(slots),
    soldierHp: new Float32Array(slots),
    soldierDamage: new Float32Array(slots),
    soldierIntervalTicks: new Float32Array(slots),
    soldierArmour: new Float32Array(slots),
    soldierDamageType: new Uint8Array(slots),
    soldierRespawnTicks: new Float32Array(slots),
    rallyRange: new Float32Array(slots),
    soldierAttackRange: new Float32Array(slots),
    soldierRegenPerTick: new Float32Array(slots),
    soldierStatusId: new Uint8Array(slots).fill(255),
    soldierStatusStacks: new Uint8Array(slots),
  };

  ids.forEach((id, towerIdx) => {
    const tower = registry.towers.get(id);
    if (tower === undefined) return;

    const blocks = [
      ...tower.tiers,
      ...tower.specialisations[0].tiers,
      ...tower.specialisations[1].tiers,
    ];

    blocks.forEach((tier, slot) => {
      const i = towerIdx * TIER_SLOTS + slot;
      table.cost[i] = tier.cost;
      table.damage[i] = tier.damage;
      table.damageType[i] = DAMAGE_INDEX[tier.damageType];
      /* Content states shots per second; the simulation counts down ticks. */
      table.fireIntervalTicks[i] = TICK_HZ / tier.fireRate;
      table.range[i] = tier.rangeTiles * TILE_SIZE;
      table.minRange[i] = tier.minRangeTiles * TILE_SIZE;
      table.splashRadius[i] = tier.splashRadiusTiles * TILE_SIZE;
      table.targets[i] = TARGET_INDEX[tier.targets] ?? TargetClass.Both;
      table.firingMode[i] = MODE_INDEX[tier.firingMode] ?? FiringMode.Projectile;
      table.projectileSpeed[i] = (tier.projectileSpeedTiles * TILE_SIZE) / TICK_HZ;
      table.coneCos[i] = Math.cos((tier.coneHalfAngleDegrees * Math.PI) / 180);
      table.chainTargets[i] = tier.chainTargets;
      table.chainFalloff[i] = tier.chainFalloff;
      table.armourPierce[i] = tier.armourPierce;
      table.bonusGoldPerKill[i] = tier.bonusGoldPerKill;
      if (tier.statusApplied !== undefined) {
        table.statusId[i] = STATUS_INDEX[tier.statusApplied.status];
        table.statusStacks[i] = tier.statusApplied.stacks;
      }
      applyPerks(table, i, tier);

      const garrison = tier.garrison;
      if (garrison !== undefined) {
        table.soldierCount[i] = garrison.count;
        table.soldierHp[i] = garrison.hp;
        table.soldierDamage[i] = garrison.damage;
        table.soldierIntervalTicks[i] = garrison.attackIntervalSeconds * TICK_HZ;
        table.soldierArmour[i] = garrison.armour;
        table.soldierDamageType[i] = DAMAGE_INDEX[garrison.damageType];
        table.soldierRespawnTicks[i] = garrison.respawnSeconds * TICK_HZ;
        table.rallyRange[i] = garrison.rallyRangeTiles * TILE_SIZE;
        table.soldierAttackRange[i] = garrison.attackRangeTiles * TILE_SIZE;
        table.soldierRegenPerTick[i] = garrison.regenPerSecond / TICK_HZ;
        if (garrison.statusApplied !== undefined) {
          table.soldierStatusId[i] = STATUS_INDEX[garrison.statusApplied.status];
          table.soldierStatusStacks[i] = garrison.statusApplied.stacks;
        }
      }
    });
  });

  return table;
}

function buildPowerTable(registry: ContentRegistry, enemies: EnemyTable): PowerTable {
  const ids = [...registry.powers.keys()].sort();
  const count = ids.length;

  const cost = new Int32Array(count);
  const cooldownTicks = new Int32Array(count);
  const effects: Array<readonly ResolvedEffect[]> = [];

  ids.forEach((id, i) => {
    const power = registry.powers.get(id);
    if (power === undefined) {
      effects.push([]);
      return;
    }
    cost[i] = power.cost;
    cooldownTicks[i] = Math.round(power.cooldownSeconds * TICK_HZ);
    effects.push(
      power.effects.map((effect) =>
        resolveEffect(effect, (enemyId) => enemies.indexOf.get(enemyId) ?? -1),
      ),
    );
  });

  return {
    count,
    ids,
    indexOf: new Map(ids.map((id, index) => [id, index])),
    cost,
    cooldownTicks,
    effects,
  };
}

/**
 * A hero at a level, with its growth already applied.
 *
 * Levels come from stage completions rather than from anything inside a run
 * (§11), so this resolves once and never changes while the stage is playing.
 */
export function buildHeroRules(
  registry: ContentRegistry,
  enemies: EnemyTable,
  heroId: string,
  level: number,
): HeroRules | null {
  const hero = registry.heroes.get(heroId);
  if (hero === undefined) return null;

  /* Level one is the authored stat line; each level after adds its increment. */
  const steps = Math.max(0, Math.min(level, MAX_HERO_LEVEL) - 1);

  return {
    id: hero.id,
    level: Math.max(1, Math.min(level, MAX_HERO_LEVEL)),
    hp: hero.hp + hero.hpPerLevel * steps,
    damage: hero.damage + hero.damagePerLevel * steps,
    damageType: DAMAGE_INDEX[hero.damageType],
    attackIntervalTicks: TICK_HZ / hero.attacksPerSecond,
    attackRange: hero.attackRangeTiles * TILE_SIZE,
    armour: hero.armour,
    respawnTicks: Math.round(hero.respawnSeconds * TICK_HZ),
    abilityIds: hero.abilities.map((ability) => ability.id),
    abilityCooldownTicks: Int32Array.from(
      hero.abilities.map((ability) => Math.round(ability.cooldownSeconds * TICK_HZ)),
    ),
    abilityEffects: hero.abilities.map((ability) =>
      ability.effects.map((effect) =>
        resolveEffect(effect, (enemyId) => enemies.indexOf.get(enemyId) ?? -1),
      ),
    ),
  };
}

/** Levels one to ten across the campaign (§11). */
export const MAX_HERO_LEVEL = 10;

function buildWaveTable(stage: StageDefinition, enemies: EnemyTable): WaveTable {
  const count = stage.waves.length;
  const slots = count * MAX_GROUPS_PER_WAVE;

  const table: WaveTable = {
    count,
    groupCount: new Uint8Array(count),
    autoStartTicks: new Int32Array(count),
    clearBonus: new Int32Array(count),
    totalBounty: new Int32Array(count),
    spawnDurationTicks: new Float32Array(count),
    groupEnemy: new Int16Array(slots).fill(-1),
    groupCountPer: new Uint16Array(slots),
    groupIntervalTicks: new Float32Array(slots),
    groupDelayTicks: new Float32Array(slots),
    groupSpawnPoint: new Uint8Array(slots),
  };

  stage.waves.forEach((wave, w) => {
    table.autoStartTicks[w] = Math.round(wave.autoStartDelaySeconds * TICK_HZ);
    table.clearBonus[w] = wave.clearBonus;

    /* Groups beyond the cap are dropped rather than silently truncating the
       wave mid-group; content-lint should be extended to reject them. */
    const groups = wave.groups.slice(0, MAX_GROUPS_PER_WAVE);
    table.groupCount[w] = groups.length;

    let bounty = 0;
    let longest = 0;
    groups.forEach((group, g) => {
      const i = w * MAX_GROUPS_PER_WAVE + g;
      const typeIdx = enemies.indexOf.get(group.enemy) ?? -1;
      table.groupEnemy[i] = typeIdx;
      table.groupCountPer[i] = group.count;
      table.groupIntervalTicks[i] = group.intervalSeconds * TICK_HZ;
      table.groupDelayTicks[i] = group.delaySeconds * TICK_HZ;
      table.groupSpawnPoint[i] = group.spawnPoint;

      if (typeIdx >= 0) bounty += (enemies.bounty[typeIdx] as number) * group.count;
      const finishes =
        group.delaySeconds * TICK_HZ +
        Math.max(0, group.count - 1) * group.intervalSeconds * TICK_HZ;
      if (finishes > longest) longest = finishes;
    });

    table.totalBounty[w] = bounty;
    table.spawnDurationTicks[w] = longest;
  });

  return table;
}

export interface RulesetOptions {
  /** Hero to take in, and the level the profile has it at. */
  heroId?: string;
  heroLevel?: number;
  /**
   * Difficulty multiplier on health and armour, 1 on Normal.
   *
   * A parameter rather than a stage property: the same stage is played on every
   * difficulty, and which one is a run-time choice (#40).
   */
  difficultyMultiplier?: number;
}

/**
 * Folds the region and difficulty halves of the scaling formula once.
 *
 * A region beyond the authored list falls back to the last one rather than
 * throwing: content-lint is where an unauthored region should be caught, and a
 * stage that loaded but scaled wrongly is easier to diagnose than one that
 * refused to load at all.
 */
function buildScaling(tuning: TuningDefinition, region: number, difficulty: number): ScalingRules {
  const multipliers = tuning.waveScaling.regionMultipliers;
  const regionMult = multipliers[Math.min(Math.max(region, 1), multipliers.length) - 1] ?? 1;

  return {
    hp: regionMult * difficulty,
    hpGrowthPerWave: tuning.waveScaling.hpGrowthPerWave,
    defenceGrowthFraction: tuning.waveScaling.defenceGrowthFraction,
    bounty: Math.sqrt(regionMult) * Math.sqrt(difficulty),
  };
}

export function buildRuleset(
  registry: ContentRegistry,
  stage: StageDefinition,
  options: RulesetOptions = {},
): Ruleset {
  const paths = stage.paths.map((path) => new BakedPath(path));
  const enemies = buildEnemyTable(registry);
  const plots: BuildPlot[] = stage.plots.map((plot) => ({
    id: plot.id,
    x: plot.position.x * TILE_SIZE,
    y: plot.position.y * TILE_SIZE,
    leyNode: plot.leyNode ?? null,
    leyNodeIdx: plot.leyNode === undefined ? -1 : LEY_NODE_TYPES.indexOf(plot.leyNode),
  }));

  return {
    hero:
      options.heroId === undefined
        ? null
        : buildHeroRules(registry, enemies, options.heroId, options.heroLevel ?? 1),
    tuning: registry.tuning,
    scaling: buildScaling(registry.tuning, stage.region, options.difficultyMultiplier ?? 1),
    towers: buildTowerTable(registry),
    enemies,
    statuses: buildStatusTable(registry),
    reactions: buildReactionTable(registry),
    powers: buildPowerTable(registry, enemies),
    waves: buildWaveTable(stage, enemies),
    paths,
    pathById: new Map(paths.map((path) => [path.id, path])),
    spawnPoints: stage.spawnPoints.map((spawn) => ({
      x: spawn.position.x * TILE_SIZE,
      y: spawn.position.y * TILE_SIZE,
      pathId: spawn.pathId,
    })),
    towerRefund: new Map([...registry.towers.values()].map((t) => [t.id, t.sellRefund])),
    plots,
    plotById: new Map(plots.map((plot) => [plot.id, plot])),
    ley: buildLeyTable(registry.tuning),
    leySeams: stage.leySeams.map((seam) =>
      seam.map((point) => ({ x: point.x * TILE_SIZE, y: point.y * TILE_SIZE })),
    ),
    core: { x: stage.core.x * TILE_SIZE, y: stage.core.y * TILE_SIZE },
    laneWidth: TILE_SIZE * 0.6,
    interactable: buildInteractable(stage),
  };
}

/**
 * The ley bonuses, flattened in the order `LEY_NODE_TYPES` declares.
 *
 * Driven by that list rather than by the keys of the authored object, so a new
 * node type added to the enum without a tuning entry is a compile error here
 * instead of a plot that silently grants nothing.
 */
function buildLeyTable(tuning: TuningDefinition): LeyTable {
  const count = LEY_NODE_TYPES.length;
  const table: LeyTable = {
    ids: LEY_NODE_TYPES,
    attackSpeed: new Float32Array(count),
    range: new Float32Array(count),
    statusStacks: new Uint8Array(count),
    reactionDamage: new Float32Array(count),
  };

  LEY_NODE_TYPES.forEach((type, i) => {
    const bonus = tuning.leyNodes[type];
    table.attackSpeed[i] = bonus.attackSpeed;
    table.range[i] = bonus.range;
    table.statusStacks[i] = bonus.statusStacks;
    table.reactionDamage[i] = bonus.reactionDamage;
  });

  return table;
}

function buildInteractable(stage: StageDefinition): Interactable | null {
  const authored = stage.interactable;
  if (authored === undefined) return null;

  return {
    id: authored.id,
    nameKey: authored.nameKey,
    x: authored.position.x * TILE_SIZE,
    y: authored.position.y * TILE_SIZE,
    cost: authored.cost,
    effect: authored.effect,
    radiusTiles: authored.radiusTiles,
    seconds: authored.durationSeconds,
    damagePerSecond: authored.damagePerSecond,
    damageType: DAMAGE_INDEX[authored.damageType],
    blocks: authored.blocks,
    statusId:
      authored.statusApplied === undefined ? 255 : STATUS_INDEX[authored.statusApplied.status],
    statusStacks: authored.statusApplied?.stacks ?? 0,
  };
}

/**
 * A ruleset with no content.
 *
 * Lets a World be built for tests about the pipeline itself, where authored
 * data would be noise. Systems treat empty tables as "nothing to do" rather
 * than special-casing it.
 */
const EMPTY_WAVES: WaveTable = {
  count: 0,
  groupCount: new Uint8Array(0),
  autoStartTicks: new Int32Array(0),
  clearBonus: new Int32Array(0),
  totalBounty: new Int32Array(0),
  spawnDurationTicks: new Float32Array(0),
  groupEnemy: new Int16Array(0),
  groupCountPer: new Uint16Array(0),
  groupIntervalTicks: new Float32Array(0),
  groupDelayTicks: new Float32Array(0),
  groupSpawnPoint: new Uint8Array(0),
};

const EMPTY_TOWERS: TowerTable = {
  ids: [],
  indexOf: new Map(),
  cost: new Int32Array(0),
  damage: new Float32Array(0),
  damageType: new Uint8Array(0),
  fireIntervalTicks: new Float32Array(0),
  range: new Float32Array(0),
  minRange: new Float32Array(0),
  splashRadius: new Float32Array(0),
  targets: new Uint8Array(0),
  firingMode: new Uint8Array(0),
  projectileSpeed: new Float32Array(0),
  coneCos: new Float32Array(0),
  chainTargets: new Uint8Array(0),
  chainFalloff: new Float32Array(0),
  armourPierce: new Float32Array(0),
  bonusGoldPerKill: new Float32Array(0),
  statusId: new Uint8Array(0),
  statusStacks: new Uint8Array(0),
  perks: new Uint16Array(0),
  pierceFraction: new Float32Array(0),
  bonusVsStatus: new Uint8Array(0),
  bonusVsStatusMultiplier: new Float32Array(0),
  armourPerChillStack: new Float32Array(0),
  spreadStacks: new Uint8Array(0),
  spreadRadius: new Float32Array(0),
  groundTicks: new Float32Array(0),
  groundRadiusTiles: new Float32Array(0),
  groundDamagePerSecond: new Float32Array(0),
  freezePulseTicks: new Float32Array(0),
  pullDistance: new Float32Array(0),
  refractRadius: new Float32Array(0),
  refractBonusPerType: new Float32Array(0),
  globalGoldFraction: new Float32Array(0),
  tauntTicks: new Float32Array(0),
  tauntRadius: new Float32Array(0),
  reflectFraction: new Float32Array(0),
  markMultiplier: new Float32Array(0),
  markTicks: new Float32Array(0),
  soldierCount: new Uint8Array(0),
  soldierHp: new Float32Array(0),
  soldierDamage: new Float32Array(0),
  soldierIntervalTicks: new Float32Array(0),
  soldierArmour: new Float32Array(0),
  soldierDamageType: new Uint8Array(0),
  soldierRespawnTicks: new Float32Array(0),
  rallyRange: new Float32Array(0),
  soldierAttackRange: new Float32Array(0),
  soldierRegenPerTick: new Float32Array(0),
  soldierStatusId: new Uint8Array(0),
  soldierStatusStacks: new Uint8Array(0),
};

const NO_LEY_BONUS = { attackSpeed: 1, range: 1, statusStacks: 0, reactionDamage: 1 };

const EMPTY_TUNING: TuningDefinition = {
  defenceHalfPoint: 50,
  defenceCap: 200,
  aetherPerKill: 1,
  aetherPerReaction: 4,
  aetherPerSecond: 0.5,
  aetherMax: 100,
  earlyCallGoldPerSecond: 1.5,
  shatterMultiplier: 2.5,
  shatterThreshold: 40,
  twoStarLivesFraction: 0.6,
  undoWindowSeconds: 3,
  previewArmourThreshold: 30,
  previewWardThreshold: 30,
  waveScaling: { hpGrowthPerWave: 0, defenceGrowthFraction: 0.6, regionMultipliers: [1] },
  leyNodes: {
    flux: NO_LEY_BONUS,
    depth: NO_LEY_BONUS,
    resonance: NO_LEY_BONUS,
    surge: NO_LEY_BONUS,
  },
};

export const EMPTY_RULESET: Ruleset = {
  tuning: EMPTY_TUNING,
  scaling: buildScaling(EMPTY_TUNING, 1, 1),
  towers: EMPTY_TOWERS,
  waves: EMPTY_WAVES,
  enemies: {
    ids: [],
    hp: new Float32Array(0),
    speed: new Float32Array(0),
    armour: new Float32Array(0),
    ward: new Float32Array(0),
    rearArmour: new Float32Array(0),
    overshield: new Float32Array(0),
    bounty: new Int32Array(0),
    livesCost: new Int32Array(0),
    meleeDamage: new Float32Array(0),
    meleeIntervalTicks: new Float32Array(0),
    maxBlockTicks: new Float32Array(0),
    evasion: new Float32Array(0),
    splitsInto: new Int16Array(0),
    splitCount: new Uint8Array(0),
    flags: new Uint16Array(0),
    behaviour: new Uint16Array(0),
    auraRadius: new Float32Array(0),
    auraTargets: new Uint8Array(0),
    healPerTick: new Float32Array(0),
    shieldAmount: new Float32Array(0),
    towerFireRateMultiplier: new Float32Array(0),
    allySpeedMultiplier: new Float32Array(0),
    allyArmourBonus: new Float32Array(0),
    disableTicks: new Float32Array(0),
    telegraphTicks: new Float32Array(0),
    phaseDamageThreshold: new Float32Array(0),
    phaseDistance: new Float32Array(0),
    spawns: new Int16Array(0),
    spawnCount: new Uint8Array(0),
    spawnIntervalTicks: new Float32Array(0),
    indexOf: new Map(),
  },
  statuses: {
    maxStacks: new Uint8Array(STATUS_COUNT),
    durationTicks: new Int32Array(STATUS_COUNT),
    damagePerTickPerStack: new Float32Array(STATUS_COUNT),
    slowPerStack: new Float32Array(STATUS_COUNT),
    defenceReductionPerStack: new Float32Array(STATUS_COUNT),
    vulnerabilityPerStack: new Float32Array(STATUS_COUNT),
    chainTargetsPerStack: new Float32Array(STATUS_COUNT),
    damageType: dotDamageTypes(),
    escalatesTo: new Int8Array(STATUS_COUNT).fill(-1),
    stacksAfterEscalation: new Uint8Array(STATUS_COUNT),
    reactive: new Uint8Array(STATUS_COUNT),
  },
  reactions: {
    count: 0,
    ids: [],
    a: new Uint8Array(0),
    b: new Uint8Array(0),
    consumes: new Uint8Array(0),
    cooldownTicks: new Int32Array(0),
    baseDamage: new Float32Array(0),
    damagePerStack: new Float32Array(0),
    radius: new Float32Array(0),
    jumps: new Uint8Array(0),
    damageOverTicks: new Int32Array(0),
    defenceMultiplier: new Float32Array(0),
    defenceTicks: new Int32Array(0),
    statusId: new Uint8Array(0),
    statusStacks: new Uint8Array(0),
    bonusStacks: new Uint8Array(0),
    durationMultiplier: new Float32Array(0),
  },
  powers: {
    count: 0,
    ids: [],
    indexOf: new Map(),
    cost: new Int32Array(0),
    cooldownTicks: new Int32Array(0),
    effects: [],
  },
  paths: [],
  pathById: new Map(),
  spawnPoints: [],
  plots: [],
  plotById: new Map(),
  ley: buildLeyTable(EMPTY_TUNING),
  leySeams: [],
  towerRefund: new Map(),
  core: { x: 0, y: 0 },
  laneWidth: TILE_SIZE * 0.6,
  interactable: null,
  hero: null,
};
