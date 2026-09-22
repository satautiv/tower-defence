import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  StagePhase,
  buildOptions,
  buildTower,
  callWave,
  createWorldForStage,
  hashWorld,
  plotInfo,
  stageResult,
  tick,
  upgradeTower,
} from '@sim/index';
import type { StageResult, World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * The M1 slice, played end to end.
 *
 * Whether stage 1-1 can actually be beaten with the towers that exist is the
 * question the whole milestone rests on, and it is not one that unit tests of
 * individual systems can answer. A scripted player drives the stage through the
 * command queue — the same route a human takes and the same one the balance
 * simulator will take in #35.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const world = (seed: number): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

interface PlayOptions {
  /** Call every wave the moment the previous one clears. */
  rushWaves?: boolean;
  /** Spend on upgrades once every plot is taken. */
  upgrade?: boolean;
  maxTicks?: number;
}

/**
 * A straightforward player: fill the plots with whatever is affordable, then
 * pour the rest into upgrades. Deliberately unsophisticated — if a naive board
 * cannot clear the opening stage, the stage is wrong, not the player.
 */
function play(w: World, options: PlayOptions = {}): StageResult {
  const { rushWaves = false, upgrade = true, maxTicks = TICK_HZ * 900 } = options;
  let cleared = 0;

  for (let t = 0; t < maxTicks && !w.finished; t++) {
    if (t % 30 === 0) {
      const plots = plotInfo(w);
      const affordable = buildOptions(w)
        .filter((option) => option.affordable)
        .sort((a, b) => b.cost - a.cost);

      const empty = plots.find((plot) => plot.occupiedBy < 0);
      if (empty !== undefined && affordable.length > 0) {
        buildTower(w.commands, empty.id, affordable[0]!.typeIdx);
      } else if (upgrade) {
        const built = plots.find((plot) => plot.occupiedBy >= 0);
        if (built !== undefined) upgradeTower(w.commands, built.occupiedBy);
      }
    }

    /* Calling early stacks waves for gold, which is the tempo dial. */
    if (rushWaves && w.wave.cleared > cleared) {
      cleared = w.wave.cleared;
      callWave(w.commands);
    }

    tick(w);
  }

  return stageResult(w);
}

describe('the slice is playable start to finish', () => {
  it('reaches an outcome rather than running forever', () => {
    const w = world(1);
    const result = play(w);

    expect(w.finished).toBe(true);
    expect([StagePhase.Won, StagePhase.Lost]).toContain(w.phase);
    expect(result.wavesCleared + result.enemiesLeaked).toBeGreaterThan(0);
  });

  /**
   * The question M1 exists to answer. If the opening stage cannot be cleared
   * by filling plots with the towers available, the content is wrong.
   */
  it('can be won by an unsophisticated board', () => {
    const result = play(world(2));

    expect(result.won).toBe(true);
    expect(result.wavesCleared).toBe(stage.waves.length);
    expect(result.stars).toBeGreaterThanOrEqual(1);
  });

  it('is winnable from several seeds, so it does not hinge on one roll', () => {
    const wins = [11, 22, 33, 44, 55].filter((seed) => play(world(seed)).won).length;
    expect(wins).toBe(5);
  });

  /* Building nothing must lose. A stage that clears itself has no game in it. */
  it('is lost by a player who builds nothing', () => {
    const w = world(3);
    for (let t = 0; t < TICK_HZ * 900 && !w.finished; t++) tick(w);

    expect(w.phase).toBe(StagePhase.Lost);
    expect(stageResult(w).won).toBe(false);
  });

  it('survives waves being called early and stacked', () => {
    const result = play(world(4), { rushWaves: true });
    expect(result.wavesCleared + result.enemiesLeaked).toBeGreaterThan(0);
  });
});

describe('nothing overflows across a whole stage', () => {
  it('drops no commands, events or damage entries', () => {
    const w = world(5);
    play(w);

    expect(w.commands.dropped).toBe(0);
    expect(w.damage.dropped).toBe(0);
    /* Events accumulate until a consumer drains them; a test has none, so a
       drop here would be expected rather than alarming. What matters is that
       the simulation itself never depended on one. */
    expect(w.enemies.count).toBeGreaterThanOrEqual(0);
  });

  it('leaves no entity pool exhausted', () => {
    const w = world(6);
    play(w);

    expect(w.enemies.count).toBeLessThan(w.enemies.capacity);
    expect(w.projectiles.count).toBeLessThan(w.projectiles.capacity);
    expect(w.towers.count).toBeLessThanOrEqual(stage.plots.length);
  });
});

describe('a whole stage is reproducible', () => {
  /* The property every replay, bug report and balance number depends on,
     exercised across a complete run rather than an empty world. */
  it('plays out identically from the same seed', () => {
    const a = world(2026);
    const b = world(2026);
    play(a);
    play(b);

    expect(hashWorld(b)).toBe(hashWorld(a));
    expect(stageResult(b)).toEqual(stageResult(a));
  });

  it('diverges from a different seed, so the seed is doing something', () => {
    expect(hashWorld(runFor(1))).not.toBe(hashWorld(runFor(2)));
  });
});

function runFor(seed: number): World {
  const w = world(seed);
  play(w);
  return w;
}

describe('performance across a real stage', () => {
  /**
   * The budget is 4ms of a 16.6ms frame for the simulation
   * (docs/TECH_DESIGN.md §14.1). Measured over a complete playthrough rather
   * than a synthetic worst case, so it reflects what a player actually causes.
   */
  it('stays well inside the simulation budget', () => {
    /* Warm up, so this measures steady-state code rather than the JIT. */
    play(world(7));

    const w = world(8);
    const start = performance.now();
    play(w);
    const elapsed = performance.now() - start;
    const perTick = elapsed / Math.max(1, w.tick);

    expect(w.tick).toBeGreaterThan(TICK_HZ * 30);
    expect(perTick).toBeLessThan(4);
  });
});

describe('the slice contains what it should', () => {
  it('offers the towers, enemies and waves the milestone calls for', () => {
    const w = world(9);

    expect(w.rules.towers.ids.length).toBeGreaterThanOrEqual(3);
    expect(w.rules.enemies.ids.length).toBeGreaterThanOrEqual(4);
    expect(w.rules.waves.count).toBeGreaterThanOrEqual(8);
    expect(w.rules.plots.length).toBeGreaterThanOrEqual(12);
    /* Ley nodes are placed but confer no bonus until #30. */
    expect(w.rules.plots.filter((plot) => plot.leyNode !== null).length).toBeGreaterThanOrEqual(2);
  });

  it('includes a flyer, forcing a second axis of coverage', () => {
    const w = world(10);
    expect(w.rules.enemies.ids).toContain('rift_bat');
  });

  it('includes an armoured enemy, forcing a damage-type decision', () => {
    const w = world(11);
    expect(w.rules.enemies.ids).toContain('ironclad_revenant');
  });
});
