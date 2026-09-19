import { TICK_HZ, TILE_SIZE } from '@core/constants';
import type { ContentRegistry } from '@content/loader';
import type { StageDefinition } from '@content/schema/stage';
import { STATUS_COUNT, STATUS_INDEX } from './status.js';
import { EnemyFlag } from './flags.js';
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

export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly pathId: number;
}

export interface Ruleset {
  readonly enemies: EnemyTable;
  readonly statuses: StatusTable;
  readonly paths: readonly BakedPath[];
  readonly pathById: ReadonlyMap<number, BakedPath>;
  readonly spawnPoints: readonly SpawnPoint[];
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
    table.flags[i] = flagsForTraits(enemy.traits);
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

export function buildRuleset(registry: ContentRegistry, stage: StageDefinition): Ruleset {
  const paths = stage.paths.map((path) => new BakedPath(path));

  return {
    enemies: buildEnemyTable(registry),
    statuses: buildStatusTable(registry),
    paths,
    pathById: new Map(paths.map((path) => [path.id, path])),
    spawnPoints: stage.spawnPoints.map((spawn) => ({
      x: spawn.position.x * TILE_SIZE,
      y: spawn.position.y * TILE_SIZE,
      pathId: spawn.pathId,
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
export const EMPTY_RULESET: Ruleset = {
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
  core: { x: 0, y: 0 },
  laneWidth: TILE_SIZE * 0.6,
};
