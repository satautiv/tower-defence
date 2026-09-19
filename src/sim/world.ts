import { SPATIAL_CELL_SIZE, TILE_SIZE } from '@core/constants';
import { Rng } from '@core/rng';
import { SpatialHash } from '@core/spatial';
import type { ContentRegistry } from '@content/loader';
import type { StageDefinition } from '@content/schema/stage';
import { EMPTY_RULESET, buildRuleset } from './ruleset.js';
import type { Ruleset } from './ruleset.js';
import { MAX_ENEMIES, MAX_QUERY_RESULTS } from './capacity.js';
import { CommandQueue } from './commands.js';
import { DamageQueue, DeathList } from './damage.js';
import { EnemyPool } from './entities/enemies.js';
import { GroundEffectPool } from './entities/groundEffects.js';
import { ProjectilePool } from './entities/projectiles.js';
import { SoldierPool } from './entities/soldiers.js';
import { TowerPool } from './entities/towers.js';
import { SimEvents } from './events.js';

/**
 * The entire mutable state of one stage in progress.
 *
 * Everything the simulation needs and nothing it does not: no renderer, no DOM,
 * no clock. Time is `tick`, randomness is `rng`, and both serialise, which is
 * what makes a run reproducible from a seed plus a command list.
 */

export const enum StagePhase {
  /** Before the first wave. The player builds; nothing is spawning. */
  Building = 0,
  Running,
  Won,
  Lost,
}

export interface WorldConfig {
  seed: number;
  widthTiles: number;
  heightTiles: number;
  startingGold: number;
  lives: number;
  totalWaves: number;
  /** Multiplier on all reaction damage, raised by talents and ley nodes. */
  reactionPower?: number;
}

export interface Resources {
  gold: number;
  /** 0-100. Spent on Warden Powers, filled by kills and reactions. */
  aether: number;
  lives: number;
}

export interface WaveState {
  /** Index of the highest wave started. -1 before the first. */
  index: number;
  /** Waves in flight. More than one when the player calls early. */
  active: number;
  /** Ticks until the next wave starts on its own. */
  autoStartIn: number;
  cleared: number;
}

export class World {
  readonly config: WorldConfig;
  readonly rng: Rng;
  /**
   * Authored content, resolved into flat numeric tables. Immutable for the life
   * of the stage: anything that changes during play lives on the World.
   */
  readonly rules: Ruleset;

  /** Ticks elapsed. The simulation's only notion of time. */
  tick = 0;
  phase: StagePhase = StagePhase.Building;
  /** Player's chosen speed. Multiplies ticks per frame; never scales a tick. */
  speed = 1;
  reactionPower: number;

  readonly enemies = new EnemyPool();
  readonly towers = new TowerPool();
  readonly projectiles = new ProjectilePool();
  readonly soldiers = new SoldierPool();
  readonly groundEffects = new GroundEffectPool();

  readonly commands = new CommandQueue();
  readonly events = new SimEvents();
  readonly damage = new DamageQueue();
  readonly deaths = new DeathList();

  /**
   * Separate indexes so an anti-air tower never scans ground entities, and
   * vice versa. Rebuilt once per tick rather than maintained incrementally —
   * cheap at these counts, and impossible to leave stale.
   */
  readonly groundIndex: SpatialHash;
  readonly airIndex: SpatialHash;
  /** Shared scratch for range queries, so querying allocates nothing. */
  readonly queryBuffer = new Int32Array(MAX_QUERY_RESULTS);

  readonly resources: Resources;
  readonly wave: WaveState;

  constructor(config: WorldConfig, rules: Ruleset = EMPTY_RULESET) {
    this.config = config;
    this.rules = rules;
    this.rng = new Rng(config.seed);
    this.reactionPower = config.reactionPower ?? 1;

    const worldWidth = config.widthTiles * TILE_SIZE;
    const worldHeight = config.heightTiles * TILE_SIZE;
    this.groundIndex = new SpatialHash(SPATIAL_CELL_SIZE, worldWidth, worldHeight, MAX_ENEMIES);
    this.airIndex = new SpatialHash(SPATIAL_CELL_SIZE, worldWidth, worldHeight, MAX_ENEMIES);

    this.resources = { gold: config.startingGold, aether: 0, lives: config.lives };
    this.wave = { index: -1, active: 0, autoStartIn: 0, cleared: 0 };
  }

  /** Back to the state a fresh stage starts in, reusing every allocation. */
  reset(): void {
    this.tick = 0;
    this.phase = StagePhase.Building;
    this.speed = 1;
    this.reactionPower = this.config.reactionPower ?? 1;

    this.rng.setState(this.config.seed);

    this.enemies.clear();
    this.towers.clear();
    this.projectiles.clear();
    this.soldiers.clear();
    this.groundEffects.clear();

    this.commands.reset();
    this.events.reset();
    this.damage.reset();
    this.deaths.clear();

    this.groundIndex.clear();
    this.airIndex.clear();

    this.resources.gold = this.config.startingGold;
    this.resources.aether = 0;
    this.resources.lives = this.config.lives;

    this.wave.index = -1;
    this.wave.active = 0;
    this.wave.autoStartIn = 0;
    this.wave.cleared = 0;
  }

  get finished(): boolean {
    return this.phase === StagePhase.Won || this.phase === StagePhase.Lost;
  }
}

/**
 * Builds a world from authored stage content.
 *
 * Only the fields the world itself owns. Paths, waves and plots stay in the
 * stage definition and are read by the systems that need them (#11, #12, #15),
 * because copying them into the world would mean two sources of truth for data
 * that never changes during a run.
 */
export function createWorldForStage(
  registry: ContentRegistry,
  stage: StageDefinition,
  seed: number,
): World {
  return new World(
    {
      seed,
      widthTiles: stage.widthTiles,
      heightTiles: stage.heightTiles,
      startingGold: stage.startingGold,
      lives: stage.lives,
      totalWaves: stage.waves.length,
    },
    buildRuleset(registry, stage),
  );
}
