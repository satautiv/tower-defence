import { TICK_HZ } from '../../src/core/constants.js';
import type { ContentRegistry } from '../../src/content/loader.js';
import type { StageDefinition } from '../../src/content/schema/stage.js';
import type { World } from '../../src/sim/index.js';
import { SimEventKind, createWorldForStage, stageResult, tick } from '../../src/sim/index.js';
import { DECISION_INTERVAL } from './strategies.js';
import type { Strategy } from './strategies.js';

/**
 * Running a stage with nobody watching.
 *
 * This is what the whole architecture was for. `sim/` has no renderer, no DOM
 * and no clock, so a stage runs under Node as fast as the CPU will carry it —
 * which turns "is this stage balanced?" from a question answered by playing it
 * forty times into one answered by measuring two thousand runs.
 *
 * The world is built once per batch and `reset()` between runs. Rebuilding it
 * would re-bake every path and re-resolve the whole ruleset for each seed, and
 * that cost would be most of the simulator's runtime rather than the game's.
 */

export interface RunResult {
  seed: number;
  won: boolean;
  stars: number;
  livesRemaining: number;
  startingLives: number;
  durationSeconds: number;
  /** Waves survived. On a loss, where the run ended. */
  wavesCleared: number;
  totalWaves: number;
  enemiesKilled: number;
  enemiesLeaked: number;
  reactionsTriggered: number;
  towersBuilt: number;
  /**
   * Most gold held at once and never spent.
   *
   * A loose economy shows up here before it shows up in a win rate: a player
   * sitting on four hundred gold was never really under pressure.
   */
  peakUnspentGold: number;
  /** Builds by tower type index, for the pick-rate report. */
  buildsByTower: number[];
  /** True when the run hit the tick ceiling rather than finishing. */
  timedOut: boolean;
}

export interface RunOptions {
  /**
   * Longest a run may last before it is abandoned, in ticks.
   *
   * A stall — a board that cannot kill anything against waves that never
   * stop — would otherwise run forever. Fifteen minutes is far beyond any
   * authored stage.
   */
  maxTicks?: number;
}

const DEFAULT_MAX_TICKS = TICK_HZ * 900;

/**
 * Plays one stage to its end and reports what happened.
 *
 * Commands go through `world.commands`, exactly as the interface's do, so the
 * strategy is exercising the surface a human touches rather than a private one.
 */
export function runOnce(
  world: World,
  strategy: Strategy,
  seed: number,
  options: RunOptions = {},
): RunResult {
  const maxTicks = options.maxTicks ?? DEFAULT_MAX_TICKS;

  world.config.seed = seed;
  world.reset();
  /* The player forgets the last run as completely as the world does. Without
     this a batch is not reproducible from its seeds, and splitting it across
     cores gives a different answer per core. */
  strategy.reset();

  const buildsByTower = new Array<number>(world.rules.towers.ids.length).fill(0);
  let peakUnspentGold = 0;
  let ticks = 0;

  while (ticks < maxTicks && !world.finished) {
    if (ticks % DECISION_INTERVAL === 0) strategy.decide(world);

    tick(world);
    ticks++;

    if (world.resources.gold > peakUnspentGold) peakUnspentGold = world.resources.gold;
    collectBuilds(world, buildsByTower);
    /* Nothing is rendering, so this simulator is the only consumer; left
       undrained the buffer would overflow and the counts would be wrong. */
    world.events.clear();
  }

  const result = stageResult(world);
  return {
    seed,
    won: result.won,
    stars: result.stars,
    livesRemaining: result.livesRemaining,
    startingLives: result.startingLives,
    durationSeconds: result.durationSeconds,
    wavesCleared: result.wavesCleared,
    totalWaves: result.totalWaves,
    enemiesKilled: result.enemiesKilled,
    enemiesLeaked: result.enemiesLeaked,
    reactionsTriggered: result.reactionsTriggered,
    towersBuilt: result.towersBuilt,
    peakUnspentGold,
    buildsByTower,
    timedOut: ticks >= maxTicks && !world.finished,
  };
}

/**
 * Builds rather than standing towers.
 *
 * Read from the event stream because that is what actually happened: counting
 * the towers left on the board at the end would miss every one that was sold,
 * and a strategy's choices are what the pick rate is measuring.
 */
function collectBuilds(world: World, into: number[]): void {
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind !== SimEventKind.TowerBuilt) continue;
    const typeIdx = event.b;
    if (typeIdx >= 0 && typeIdx < into.length) into[typeIdx] = (into[typeIdx] as number) + 1;
  }
}

export interface BatchOptions extends RunOptions {
  runs: number;
  /** First seed. Runs use `seedStart .. seedStart + runs - 1`. */
  seedStart?: number;
}

/**
 * Runs one strategy across a span of seeds.
 *
 * Seeds are consecutive from a stated start rather than drawn randomly, so a
 * surprising result can be reproduced exactly — `--runs 2000` twice is the same
 * two thousand games, and any one of them can be replayed on its own.
 */
export function runBatch(
  registry: ContentRegistry,
  stage: StageDefinition,
  strategy: Strategy,
  options: BatchOptions,
): RunResult[] {
  const seedStart = options.seedStart ?? 1;
  const world = createWorldForStage(registry, stage, seedStart);

  const results: RunResult[] = [];
  for (let i = 0; i < options.runs; i++) {
    results.push(runOnce(world, strategy, seedStart + i, options));
  }
  return results;
}
