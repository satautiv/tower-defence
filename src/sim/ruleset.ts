import { TICK_HZ, TILE_SIZE } from '@core/constants';
import type { ContentRegistry } from '@content/loader';
import type { StageDefinition } from '@content/schema/stage';
import type { TuningDefinition } from '@content/schema/tuning';
import { MAX_GROUPS_PER_WAVE } from './capacity.js';
import { STATUS_COUNT, STATUS_INDEX } from './status.js';
import { EnemyFlag } from './flags.js';
import { DAMAGE_INDEX } from './damage.js';
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
  /** Chance in [0,1] to ignore a projectile entirely. */
  readonly evasion: Float32Array;
  /** Enemy index this splits into on death, or -1, and how many. */
  readonly splitsInto: Int16Array;
  readonly splitCount: Uint8Array;
  /** EnemyFlag bits implied by the enemy's traits. */
  readonly flags: Uint16Array;
  readonly indexOf: ReadonlyMap<string, number>;
}

export interface StatusTable {
  readonly maxStacks: Uint8Array;
  readonly durationTicks: Int32Array;
  readonly damagePerTickPerStack: Float32Array;
  readonly slowPerStack: Float32Array;
  readonly defenceReductionPerStack: Float32Array;
  readonly vulnerabilityPerStack: Float32Array;
  /** Status this escalates into at max stacks, or -1. */
  readonly escalatesTo: Int8Array;
  readonly stacksAfterEscalation: Uint8Array;
  readonly reactive: Uint8Array;
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
  /** Ley node type, or null. The bonus itself lands with #30. */
  readonly leyNode: string | null;
}

export interface Ruleset {
  /** Global combat and economy constants. */
  readonly tuning: TuningDefinition;
  readonly towers: TowerTable;
  readonly enemies: EnemyTable;
  readonly statuses: StatusTable;
  readonly waves: WaveTable;
  readonly paths: readonly BakedPath[];
  readonly pathById: ReadonlyMap<number, BakedPath>;
  readonly spawnPoints: readonly SpawnPoint[];
  readonly plots: readonly BuildPlot[];
  /** Fraction of gold returned on sale, per tower id. */
  readonly towerRefund: ReadonlyMap<string, number>;
  readonly core: { readonly x: number; readonly y: number };
  /** How far apart a pack spreads sideways, in world pixels. */
  readonly laneWidth: number;
}

/** Traits that map directly onto a per-entity flag. */
const TRAIT_FLAGS: Readonly<Record<string, number>> = {
  flying: EnemyFlag.Flying,
  freeze_immune: EnemyFlag.FreezeImmune,
  directional_armour: EnemyFlag.DirectionalArmour,
};

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
    evasion: new Float32Array(count),
    splitsInto: new Int16Array(count).fill(-1),
    splitCount: new Uint8Array(count),
    flags: new Uint16Array(count),
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
    table.evasion[i] = enemy.traitConfig.evasionChance ?? 0;
    table.splitCount[i] = enemy.traitConfig.splitCount ?? 0;
    table.flags[i] = flagsForTraits(enemy.traits);
  });

  /* Resolved in a second pass: a splitter may name an enemy that appears later
     in the sorted list, so every index has to exist first. */
  ids.forEach((id, i) => {
    const into = registry.enemies.get(id)?.traitConfig.splitsInto;
    if (into !== undefined) table.splitsInto[i] = table.indexOf.get(into) ?? -1;
  });

  return table;
}

function buildStatusTable(registry: ContentRegistry): StatusTable {
  const table: StatusTable = {
    maxStacks: new Uint8Array(STATUS_COUNT),
    durationTicks: new Int32Array(STATUS_COUNT),
    damagePerTickPerStack: new Float32Array(STATUS_COUNT),
    slowPerStack: new Float32Array(STATUS_COUNT),
    defenceReductionPerStack: new Float32Array(STATUS_COUNT),
    vulnerabilityPerStack: new Float32Array(STATUS_COUNT),
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
    table.escalatesTo[i] = status.escalatesTo === undefined ? -1 : STATUS_INDEX[status.escalatesTo];
    table.stacksAfterEscalation[i] = status.stacksAfterEscalation;
    table.reactive[i] = status.reactive ? 1 : 0;
  }

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
    });
  });

  return table;
}

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

export function buildRuleset(registry: ContentRegistry, stage: StageDefinition): Ruleset {
  const paths = stage.paths.map((path) => new BakedPath(path));
  const enemies = buildEnemyTable(registry);

  return {
    tuning: registry.tuning,
    towers: buildTowerTable(registry),
    enemies,
    statuses: buildStatusTable(registry),
    waves: buildWaveTable(stage, enemies),
    paths,
    pathById: new Map(paths.map((path) => [path.id, path])),
    spawnPoints: stage.spawnPoints.map((spawn) => ({
      x: spawn.position.x * TILE_SIZE,
      y: spawn.position.y * TILE_SIZE,
      pathId: spawn.pathId,
    })),
    towerRefund: new Map([...registry.towers.values()].map((t) => [t.id, t.sellRefund])),
    plots: stage.plots.map((plot) => ({
      id: plot.id,
      x: plot.position.x * TILE_SIZE,
      y: plot.position.y * TILE_SIZE,
      leyNode: plot.leyNode ?? null,
    })),
    core: { x: stage.core.x * TILE_SIZE, y: stage.core.y * TILE_SIZE },
    laneWidth: TILE_SIZE * 0.6,
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
};

export const EMPTY_RULESET: Ruleset = {
  tuning: {
    defenceHalfPoint: 50,
    defenceCap: 200,
    aetherPerKill: 1,
    aetherPerReaction: 4,
    aetherPerSecond: 0.5,
    aetherMax: 100,
    earlyCallGoldPerSecond: 1.5,
    shatterMultiplier: 2.5,
    shatterThreshold: 40,
  },
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
    evasion: new Float32Array(0),
    splitsInto: new Int16Array(0),
    splitCount: new Uint8Array(0),
    flags: new Uint16Array(0),
    indexOf: new Map(),
  },
  statuses: {
    maxStacks: new Uint8Array(STATUS_COUNT),
    durationTicks: new Int32Array(STATUS_COUNT),
    damagePerTickPerStack: new Float32Array(STATUS_COUNT),
    slowPerStack: new Float32Array(STATUS_COUNT),
    defenceReductionPerStack: new Float32Array(STATUS_COUNT),
    vulnerabilityPerStack: new Float32Array(STATUS_COUNT),
    escalatesTo: new Int8Array(STATUS_COUNT).fill(-1),
    stacksAfterEscalation: new Uint8Array(STATUS_COUNT),
    reactive: new Uint8Array(STATUS_COUNT),
  },
  paths: [],
  pathById: new Map(),
  spawnPoints: [],
  plots: [],
  towerRefund: new Map(),
  core: { x: 0, y: 0 },
  laneWidth: TILE_SIZE * 0.6,
};
