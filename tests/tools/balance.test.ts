import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { createWorldForStage } from '@sim/index';
import { runBatch, runOnce } from '../../tools/balance-sim/runner.js';
import { splitWork } from '../../tools/balance-sim/parallel.js';
import {
  balanced,
  cheapestTowerId,
  defaultStrategies,
  greedy,
  rush,
  singleType,
  strategyByName,
} from '../../tools/balance-sim/strategies.js';
import {
  MAX_PICK_SPREAD,
  MIN_PICK_RATE,
  findings,
  formatCsv,
  hasFailure,
  summarise,
} from '../../tools/balance-sim/report.js';
import type { RunResult } from '../../tools/balance-sim/runner.js';

/**
 * The headless balance simulator (#35).
 *
 * The tool is only worth anything if its numbers can be trusted, so what is
 * tested here is trustworthiness rather than any particular balance figure: the
 * same seeds give the same answer however the work was divided, a strategy
 * drives the game only through the command queue, and a finding fires on the
 * condition it claims to.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const world = () => createWorldForStage(registry, stage, 1);

describe('a run is decided by its seed and nothing else', () => {
  /**
   * The property the whole tool rests on. A surprising result has to be
   * reproducible on its own — `--runs 2000` twice must be the same two thousand
   * games, and any one of them replayable by itself.
   */
  it('gives the same result for the same seed, twice', () => {
    const first = runOnce(world(), greedy(), 42);
    const second = runOnce(world(), greedy(), 42);
    expect(second).toEqual(first);
  });

  it('gives a different run for a different seed', () => {
    const a = runOnce(world(), greedy(), 1);
    const b = runOnce(world(), greedy(), 2);
    expect(a.seed).not.toBe(b.seed);
  });

  /**
   * Regression, and the reason `Strategy.reset()` is required rather than
   * optional. `balanced` carried its round-robin cursor between runs, so run N
   * depended on run N-1 — which meant splitting a batch across four cores gave
   * four different answers, because each worker started its own sequence.
   */
  it('does not let one run change the next', () => {
    const shared = world();
    const strategy = balanced();

    const inOrder = [1, 2, 3].map((seed) => runOnce(shared, strategy, seed));
    const reversed = [3, 2, 1].map((seed) => runOnce(shared, strategy, seed));

    for (const run of inOrder) {
      const same = reversed.find((r) => r.seed === run.seed);
      expect(same, `seed ${run.seed} differed by order`).toEqual(run);
    }
  });

  it('is unchanged by being run alone or in a batch', () => {
    const alone = runOnce(world(), balanced(), 7);
    const batch = runBatch(registry, stage, balanced(), { runs: 3, seedStart: 6 });
    expect(batch.find((r) => r.seed === 7)).toEqual(alone);
  });
});

describe('work divides without changing the answer', () => {
  it('covers every seed exactly once, whatever the worker count', () => {
    for (const workers of [1, 2, 3, 4, 7, 16]) {
      const slices = splitWork(10, workers, 100);
      const seeds = slices.flatMap((slice) =>
        Array.from({ length: slice.runs }, (_, i) => slice.seedStart + i),
      );
      expect(seeds.sort((a, b) => a - b)).toEqual([
        100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
      ]);
    }
  });

  it('keeps each slice contiguous, so seed order survives concatenation', () => {
    const slices = splitWork(10, 3, 1);
    let expected = 1;
    for (const slice of slices) {
      expect(slice.seedStart).toBe(expected);
      expected += slice.runs;
    }
  });

  it('never asks for more workers than there are runs', () => {
    expect(splitWork(3, 16, 1)).toHaveLength(3);
  });

  it('spreads the remainder rather than leaving one worker with all of it', () => {
    const sizes = splitWork(10, 4, 1).map((s) => s.runs);
    expect(sizes).toEqual([3, 3, 2, 2]);
  });
});

describe('strategies play through the command queue', () => {
  /**
   * The point of the whole exercise: a strategy dispatches the same `Command`
   * objects the interface does. One that reached into the world directly could
   * prove a board winnable in a way no player could reproduce.
   */
  it.each([
    ['greedy', greedy()],
    ['balanced', balanced()],
    ['rush', rush()],
  ])('%s asks rather than acts', (_name, strategy) => {
    const w = world();
    const before = w.towers.count;
    strategy.decide(w);

    /* Nothing has been built: the command is queued and applies at the next
       tick boundary, exactly as a tap does. */
    expect(w.towers.count).toBe(before);
    expect(w.commands.count).toBeGreaterThan(0);
  });

  it('builds something once the queue is drained', () => {
    const result = runOnce(world(), greedy(), 1);
    expect(result.towersBuilt).toBeGreaterThan(0);
  });

  /**
   * The sharpest finding the tool has produced, and not the one expected.
   *
   * Greedy puts *all three* damage types on the board — and still triggers no
   * reaction at all. Building different towers is not sufficient; they have to
   * cover the same stretch of path. Which tower lands on which plot decides
   * it, and filling plots in order does not arrange that by accident.
   */
  it('greedy builds every type and still never reacts', () => {
    const result = runOnce(world(), greedy(), 1);
    const used = result.buildsByTower.filter((builds) => builds > 0);
    expect(used.length).toBeGreaterThan(1);
    expect(result.reactionsTriggered).toBe(0);
  });

  it('balanced spreads across the roster and triggers reactions', () => {
    const result = runOnce(world(), balanced(), 1);
    const used = result.buildsByTower.filter((builds) => builds > 0);
    expect(used.length).toBeGreaterThan(1);
    expect(result.reactionsTriggered).toBeGreaterThan(0);
  });

  it('single-type builds only what it was named', () => {
    const w = world();
    const towerId = w.rules.towers.ids[1] as string;
    const result = runOnce(w, singleType(towerId), 1);

    const typeIdx = w.rules.towers.indexOf.get(towerId) as number;
    expect(result.buildsByTower[typeIdx]).toBeGreaterThan(0);
    expect(result.buildsByTower.filter((b) => b > 0)).toHaveLength(1);
  });

  it('names every strategy the command line offers', () => {
    const w = world();
    expect(strategyByName('greedy', w).name).toBe('greedy');
    expect(strategyByName('balanced', w).name).toBe('balanced');
    expect(strategyByName('rush', w).name).toBe('rush');
    expect(strategyByName('single:flame_vent', w).name).toBe('single:flame_vent');
  });

  it('falls back to the cheapest tower for a bare single', () => {
    const w = world();
    expect(strategyByName('single', w).name).toBe(`single:${cheapestTowerId(w)}`);
  });

  it('refuses a strategy it does not have, rather than guessing', () => {
    expect(() => strategyByName('nonsense', world())).toThrow(/unknown strategy/);
  });

  it('offers one run per tower by default, so no tower goes unmeasured', () => {
    const w = world();
    const names = defaultStrategies(w).map((s) => s.name);
    for (const id of w.rules.towers.ids) expect(names).toContain(`single:${id}`);
  });
});

describe('the report names design problems', () => {
  const target = { minWinRate: 0.95, maxWinRate: 1 };
  const towerIds = ['a', 'b', 'c'];

  const run = (over: Partial<RunResult> = {}): RunResult => ({
    seed: 1,
    won: true,
    stars: 3,
    livesRemaining: 20,
    startingLives: 20,
    durationSeconds: 100,
    wavesCleared: 10,
    totalWaves: 10,
    enemiesKilled: 50,
    enemiesLeaked: 0,
    reactionsTriggered: 5,
    towersBuilt: 3,
    peakUnspentGold: 100,
    buildsByTower: [1, 1, 1],
    timedOut: false,
    ...over,
  });

  it('accepts a win rate inside the authored band', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [run(), run()]);
    expect(summary.withinTarget).toBe(true);
    expect(findings(summary)).toHaveLength(0);
  });

  /* A band is written down so a change can fail a build. A stage drifting out
     of it is breakage, not a note. */
  it('fails a win rate outside it', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [run(), run({ won: false })]);
    expect(summary.withinTarget).toBe(false);
    expect(findings(summary).some((f) => f.severity === 'fail')).toBe(true);
    expect(hasFailure([summary])).toBe(true);
  });

  it('fails a run that never finished', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [run({ timedOut: true })]);
    expect(findings(summary).some((f) => f.code === 'runs-timed-out')).toBe(true);
  });

  /* Pillar P1: no dead towers. This is the 1:14 Flame Vent problem, measured. */
  it('warns about a tower nobody builds', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [
      run({ buildsByTower: [98, 1, 1] }),
    ]);
    const codes = findings(summary).map((f) => f.code);
    expect(codes).toContain('tower-unpicked');
    expect(codes).toContain('pick-spread');
  });

  it('holds the spread limit where the criterion puts it', () => {
    const inside = summarise('1-1', 'greedy', towerIds, target, [
      run({ buildsByTower: [MAX_PICK_SPREAD, 1, 1] }),
    ]);
    expect(findings(inside).some((f) => f.code === 'pick-spread')).toBe(false);

    const outside = summarise('1-1', 'greedy', towerIds, target, [
      run({ buildsByTower: [MAX_PICK_SPREAD * 2 + 1, 1, 1] }),
    ]);
    expect(findings(outside).some((f) => f.code === 'pick-spread')).toBe(true);
  });

  /* A single-type run has a 100% pick rate by construction; reporting that as
     a dead roster would bury the finding that matters under noise. */
  it('says nothing about pick rates for a strategy that had no choice', () => {
    const summary = summarise('1-1', 'single:a', towerIds, target, [
      run({ buildsByTower: [10, 0, 0] }),
    ]);
    const codes = findings(summary).map((f) => f.code);
    expect(codes).not.toContain('tower-unpicked');
    expect(codes).not.toContain('pick-spread');
  });

  /* The question #62 exists to answer, asked of the simulator instead. */
  it('warns when the signature mechanic never fires', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [
      run({ reactionsTriggered: 0 }),
      run({ reactionsTriggered: 0 }),
    ]);
    const finding = findings(summary).find((f) => f.code === 'reactions-never-fire');
    expect(finding?.message).toMatch(/2 of 2/);
  });

  it('reports the pick rate as a share of builds', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [
      run({ buildsByTower: [1, 1, 2] }),
    ]);
    expect(summary.picks.map((p) => p.rate)).toEqual([0.25, 0.25, 0.5]);
  });

  it('keeps the floor where the criterion puts it', () => {
    expect(MIN_PICK_RATE).toBe(0.2);
  });

  /* Losses only: a loss-wave percentile that counted wins would describe runs
     that never lost. */
  it('reports loss waves from the losses alone', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [
      run({ won: false, wavesCleared: 3 }),
      run({ won: false, wavesCleared: 7 }),
      run({ won: true, wavesCleared: 10 }),
    ]);
    expect(summary.losses).toBe(2);
    expect(summary.lossWaveP50).toBe(3);
    expect(summary.lossWaveP90).toBe(7);
  });

  it('medians the clear time over wins only', () => {
    const summary = summarise('1-1', 'greedy', towerIds, target, [
      run({ won: true, durationSeconds: 100 }),
      run({ won: false, durationSeconds: 10 }),
    ]);
    expect(summary.medianClearSeconds).toBe(100);
  });
});

describe('the CSV is machine-readable', () => {
  it('writes one header and one row per summary', () => {
    const summaries = ['greedy', 'balanced'].map((strategy) =>
      summarise('1-1', strategy, ['a', 'b'], { minWinRate: 0, maxWinRate: 1 }, []),
    );
    const lines = formatCsv(summaries, ['a', 'b']).trim().split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('pick_a,pick_b');
    /* Same column count on every row, or nothing downstream can read it. */
    const widths = new Set(lines.map((line) => line.split(',').length));
    expect(widths.size).toBe(1);
  });
});
