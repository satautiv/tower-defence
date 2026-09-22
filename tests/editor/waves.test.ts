import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { emptyDraft } from '@editor/draft';
import type { Draft } from '@editor/draft';
import { allWaveTotals, stageFloorSeconds, waveTotals } from '@editor/waves';

/**
 * The wave composer's live totals (#34).
 *
 * The thing worth testing is not that the arithmetic adds up but that it is
 * the *simulation's* arithmetic: the numbers come out of `buildRuleset`, so a
 * change to the wave-scaling formula moves them without anyone editing this.
 */

const registry = buildRegistry(readContentFromDisk());

function withWaves(waves: Draft['waves']): Draft {
  return { ...emptyDraft('9-9', 'stage.9_9.name'), waves };
}

const group = (enemy: string, count: number, over = {}) => ({
  enemy,
  count,
  intervalSeconds: 0,
  delaySeconds: 0,
  spawnPoint: 0,
  ...over,
});

describe('a wave adds up to what the simulation will spawn', () => {
  it('counts every enemy in every group', () => {
    const draft = withWaves([
      {
        autoStartDelaySeconds: 20,
        clearBonus: 0,
        groups: [group('riftling', 5), group('husk', 3)],
      },
    ]);
    expect(waveTotals(draft, 0, registry).count).toBe(8);
  });

  it('prices the wave in gold, clear bonus included', () => {
    const draft = withWaves([
      { autoStartDelaySeconds: 20, clearBonus: 25, groups: [group('riftling', 4)] },
    ]);
    const bare = withWaves([
      { autoStartDelaySeconds: 20, clearBonus: 0, groups: [group('riftling', 4)] },
    ]);

    const totals = waveTotals(draft, 0, registry);
    expect(totals.bounty).toBe(waveTotals(bare, 0, registry).bounty + 25);
    expect(totals.bounty).toBeGreaterThan(25);
  });

  /* The scaling is §9.2's, read off the ruleset rather than restated. A later
     wave of the same enemies is worth more health than an earlier one. */
  it('scales health by the wave it is, not by the enemies alone', () => {
    const wave = { autoStartDelaySeconds: 20, clearBonus: 0, groups: [group('riftling', 5)] };
    const draft = withWaves([wave, wave, wave]);

    const totals = allWaveTotals(draft, registry);
    expect(totals[0]?.hp).toBeGreaterThan(0);
    expect(totals[1]?.hp).toBeGreaterThan(totals[0]?.hp ?? 0);
    expect(totals[2]?.hp).toBeGreaterThan(totals[1]?.hp ?? 0);
  });

  /* A group of one spawns instantly: the last enemy lands `count - 1`
     intervals in, not `count`. Getting this wrong makes every estimate long. */
  it('measures spawn time from the last enemy, not one past it', () => {
    const one = withWaves([
      {
        autoStartDelaySeconds: 0,
        clearBonus: 0,
        groups: [group('riftling', 1, { intervalSeconds: 2 })],
      },
    ]);
    expect(waveTotals(one, 0, registry).spawnSeconds).toBe(0);

    const four = withWaves([
      {
        autoStartDelaySeconds: 0,
        clearBonus: 0,
        groups: [group('riftling', 4, { intervalSeconds: 2 })],
      },
    ]);
    expect(waveTotals(four, 0, registry).spawnSeconds).toBe(6);
  });

  /* Groups run in parallel, so a wave is as long as its slowest group rather
     than the sum of them. */
  it('takes the slowest group, because groups run together', () => {
    const draft = withWaves([
      {
        autoStartDelaySeconds: 0,
        clearBonus: 0,
        groups: [
          group('riftling', 3, { intervalSeconds: 1 }),
          group('husk', 2, { intervalSeconds: 1, delaySeconds: 10 }),
        ],
      },
    ]);
    expect(waveTotals(draft, 0, registry).spawnSeconds).toBe(11);
  });

  it('names an enemy it cannot find rather than counting it as nothing', () => {
    const draft = withWaves([
      { autoStartDelaySeconds: 20, clearBonus: 0, groups: [group('wyrmlet', 4)] },
    ]);
    const totals = waveTotals(draft, 0, registry);

    expect(totals.unknownEnemies).toEqual(['wyrmlet']);
    expect(totals.count).toBe(0);
  });

  it('returns nothing for a wave that is not there', () => {
    expect(waveTotals(emptyDraft('9-9', 'stage.9_9.name'), 42, registry).count).toBe(0);
  });
});

describe('the stage floor tells an author how long their stage is', () => {
  it('sums every wave delay and its spawn time', () => {
    const draft = withWaves([
      {
        autoStartDelaySeconds: 20,
        clearBonus: 0,
        groups: [group('riftling', 3, { intervalSeconds: 1 })],
      },
      { autoStartDelaySeconds: 30, clearBonus: 0, groups: [group('husk', 1)] },
    ]);
    expect(stageFloorSeconds(draft, registry)).toBe(52);
  });

  /* The shipped stage is the honest check that this is in the right units:
     1-1 is a four-to-six minute stage, so its floor has to be minutes. */
  it('reads in minutes for the stage that exists', () => {
    const stage = registry.stages.get('1-1');
    if (stage === undefined) throw new Error('stage 1-1 missing');

    const floor = stageFloorSeconds(stage, registry);
    expect(floor).toBeGreaterThan(60);
    expect(floor).toBeLessThan(900);
  });
});
