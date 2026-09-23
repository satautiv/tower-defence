import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import {
  DEFAULT_DIFFICULTY,
  buildRuleset,
  createWorldForStage,
  resolveDifficulty,
} from '@sim/index';
import type { Ruleset, World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Play modes (#40, docs/GAME_DESIGN.md §9.2).
 *
 * A mode is authored data, resolved once, so no system asks which one it is
 * running — it reads a scaled health and a lives count exactly as it did when
 * there was only one mode.
 *
 * The test that matters most is the last block: every authored mode must
 * actually differ from the baseline in something a player would feel. A
 * difficulty setting that changes no number is the failure this whole issue
 * exists to avoid, and asserting the table is non-empty would not catch it.
 */

const STAGE = '1-6';
const registry = loadContent();
const MODES = Object.keys(registry.tuning.difficulties);

function rulesOn(difficulty?: string): Ruleset {
  const stage = registry.stages.get(STAGE);
  if (stage === undefined) throw new Error(`no stage ${STAGE}`);
  return buildRuleset(registry, stage, { ...FULL_ROSTER, difficulty });
}

function worldOn(difficulty?: string): World {
  const stage = registry.stages.get(STAGE);
  if (stage === undefined) throw new Error(`no stage ${STAGE}`);
  return createWorldForStage(registry, stage, 7, { ...FULL_ROSTER, difficulty });
}

describe('naming a mode', () => {
  it('defaults to the baseline', () => {
    expect(rulesOn().difficulty.id).toBe(DEFAULT_DIFFICULTY);
    expect(rulesOn(DEFAULT_DIFFICULTY).difficulty).toMatchObject({ hp: 1, gold: 1 });
  });

  /* A saved run or a replay naming a mode this build has retired should open
     on the baseline rather than refuse to load. */
  it('falls back to the baseline rather than throwing', () => {
    const resolved = resolveDifficulty(registry.tuning, 'a-mode-that-was-removed');
    expect(resolved.id).toBe(DEFAULT_DIFFICULTY);
    expect(rulesOn('nonsense').difficulty.id).toBe(DEFAULT_DIFFICULTY);
  });

  it('carries the id so a result can say which mode it was', () => {
    expect(rulesOn('veteran').difficulty.id).toBe('veteran');
  });
});

describe('what a mode changes', () => {
  it('scales enemy health', () => {
    expect(rulesOn('veteran').scaling.hp).toBeCloseTo(rulesOn().scaling.hp * 1.35, 5);
    expect(rulesOn('impossible').scaling.hp).toBeCloseTo(rulesOn().scaling.hp * 1.8, 5);
  });

  /* Gold reached nothing at all before #40: the multiplier was authored in the
     design and read by no code. */
  it('scales starting gold, in whole gold', () => {
    const normal = worldOn().config.startingGold;
    const mean = worldOn('impossible').config.startingGold;
    expect(mean).toBe(Math.round(normal * 0.7));
    expect(Number.isInteger(mean)).toBe(true);
  });

  it('scales bounty sublinearly, so a harder mode is not simply poorer', () => {
    expect(rulesOn('impossible').scaling.bounty).toBeCloseTo(Math.sqrt(1.8), 5);
  });

  it('sets the lives, which the stage no longer decides', () => {
    expect(worldOn().config.lives).toBe(20);
    expect(worldOn('veteran').config.lives).toBe(15);
    expect(worldOn('impossible').config.lives).toBe(10);
    expect(worldOn('relaxed').config.lives).toBe(30);
  });

  it('gives Impossible more enemies in every group', () => {
    const normal = rulesOn().waves;
    const mean = rulesOn('impossible').waves;
    let compared = 0;
    for (let i = 0; i < normal.groupCountPer.length; i++) {
      const before = normal.groupCountPer[i] as number;
      if (before === 0) continue;
      expect(mean.groupCountPer[i] as number).toBeGreaterThan(before);
      compared++;
    }
    expect(compared).toBeGreaterThan(5);
  });

  /* Copied from the heaviest authored wave and inserted second-to-last, so a
     boss stage still ends on its boss. */
  it('gives Impossible one extra wave, and not at the end', () => {
    const normal = rulesOn().waves;
    const mean = rulesOn('impossible').waves;
    expect(mean.count).toBe(normal.count + 1);

    const lastNormal = normal.count - 1;
    const lastMean = mean.count - 1;
    expect(mean.groupEnemy[lastMean * 8]).toBe(normal.groupEnemy[lastNormal * 8]);
  });

  it('leaves the baseline wave list exactly as authored', () => {
    const stage = registry.stages.get(STAGE);
    if (stage === undefined) throw new Error('no stage');
    expect(rulesOn().waves.count).toBe(stage.waves.length);
  });
});

describe('Relaxed is kind without being the best way to farm', () => {
  it('gives more lives and more gold', () => {
    expect(worldOn('relaxed').config.lives).toBeGreaterThan(worldOn().config.lives);
    expect(worldOn('relaxed').config.startingGold).toBeGreaterThan(worldOn().config.startingGold);
  });

  /* §18 says no shame and no lockout — but awarding stars would make it the
     optimal route to the talent tree, which is a different thing from kind. */
  it('awards no stars', () => {
    expect(rulesOn('relaxed').difficulty.awardsStars).toBe(false);
    expect(rulesOn().difficulty.awardsStars).toBe(true);
  });

  it('does not make enemies weaker, only the run more forgiving', () => {
    expect(rulesOn('relaxed').scaling.hp).toBe(rulesOn().scaling.hp);
  });
});

/**
 * The guard. A mode that changes no number is a setting that does nothing.
 */
describe('every authored mode is a different game', () => {
  it.each(MODES.filter((id) => id !== DEFAULT_DIFFICULTY))('%s differs from the baseline', (id) => {
    const base = rulesOn();
    const mode = rulesOn(id);
    const baseWorld = worldOn();
    const modeWorld = worldOn(id);

    const changed =
      mode.scaling.hp !== base.scaling.hp ||
      mode.scaling.bounty !== base.scaling.bounty ||
      modeWorld.config.lives !== baseWorld.config.lives ||
      modeWorld.config.startingGold !== baseWorld.config.startingGold ||
      mode.waves.count !== base.waves.count ||
      mode.difficulty.awardsStars !== base.difficulty.awardsStars;

    expect(changed, `"${id}" is authored but plays identically to the baseline`).toBe(true);
  });

  it('has a baseline that really is 1.0', () => {
    const normal = registry.tuning.difficulties[DEFAULT_DIFFICULTY];
    expect(normal).toMatchObject({ hp: 1, gold: 1 });
  });
});
