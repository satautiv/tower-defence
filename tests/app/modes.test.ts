import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import {
  DEFAULT_MODE_ID,
  ENDLESS_STARS,
  defaultMode,
  lockReason,
  maxStarsFor,
  modeById,
  modeLocked,
  modesFor,
} from '@app/modes';
import { EMPTY_PROFILE, STARS_PER_STAGE, recordStageResult } from '@app/profile';
import type { StageResult } from '@sim/index';
import locale from '../../src/i18n/en.json';

/**
 * The ways one map can be played (#48, §12.4 and §13).
 *
 * §12.4 says a stage is worth eleven stars and §13 says a map is reused five
 * ways. Both are claims about what the *content* offers, so both are checked
 * against the content rather than against a list restated here — a fifth
 * difficulty or a second Heroic must change the answer by being authored.
 */

const registry = loadContent();
const stageIds = [...registry.stages.keys()];

describe('what a stage can be played as', () => {
  it.each(stageIds)('%s offers every difficulty and its own three variants', (stageId) => {
    const modes = modesFor(stageId);
    const difficulties = Object.keys(registry.tuning.difficulties);

    expect(
      modes
        .filter((mode) => mode.kind === 'difficulty')
        .map((mode) => mode.id)
        .sort(),
    ).toEqual(difficulties.sort());
    expect(modes.filter((mode) => mode.kind === 'challenge')).toHaveLength(2);
    expect(modes.filter((mode) => mode.kind === 'endless')).toHaveLength(1);
  });

  /* A challenge belongs to one map. Offering 1-3's Heroic on 1-7 would hand
     the player a puzzle whose plots are not there. */
  it.each(stageIds)('%s offers only its own challenges', (stageId) => {
    for (const mode of modesFor(stageId)) {
      if (mode.challengeId === undefined) continue;
      expect(registry.challenges.get(mode.challengeId)?.stageId).toBe(stageId);
    }
  });

  /* Most forgiving first, read from the lives each grants rather than from a
     hand-written order. */
  it('lists the difficulties gentlest first', () => {
    const first = stageIds[0];
    if (first === undefined) throw new Error('no stages');
    const ids = modesFor(first)
      .filter((mode) => mode.kind === 'difficulty')
      .map((mode) => mode.id);
    expect(ids).toEqual(['relaxed', 'normal', 'veteran', 'impossible']);
  });

  it('opens on Normal', () => {
    const first = stageIds[0];
    if (first === undefined) throw new Error('no stages');
    expect(defaultMode(first)?.id).toBe(DEFAULT_MODE_ID);
    expect(modeById(first, DEFAULT_MODE_ID)?.difficulty).toBe('normal');
    expect(modeById(first, 'nonsense')).toBeUndefined();
  });

  it('carries the difficulty and challenge a ruleset is built from', () => {
    const first = stageIds[0];
    if (first === undefined) throw new Error('no stages');
    const modes = modesFor(first);

    for (const mode of modes) {
      expect(registry.tuning.difficulties[mode.difficulty]).toBeDefined();
      if (mode.kind === 'difficulty') expect(mode.challengeId).toBeUndefined();
      else expect(mode.challengeId).toBe(mode.id);
    }
  });
});

/**
 * §12.4's eleven, and the one thing that would make it quietly wrong.
 *
 * `STARS_PER_STAGE` is a constant in `profile.ts`, which stays pure and reads
 * no content. That is the right split and it is also exactly how the two
 * numbers could drift, so this is where they are held together.
 */
describe('eleven stars a stage', () => {
  it.each(stageIds)('%s is worth what §12.4 says', (stageId) => {
    expect(maxStarsFor(stageId)).toBe(STARS_PER_STAGE);
  });

  it('is nine from the scoring difficulties and one each from Heroic and Iron', () => {
    const first = stageIds[0];
    if (first === undefined) throw new Error('no stages');
    const modes = modesFor(first);

    const byStars = (n: number): number => modes.filter((mode) => mode.maxStars === n).length;
    expect(byStars(3)).toBe(3);
    expect(byStars(1)).toBe(2);
    /* Relaxed and Endless: playable, and worth nothing. */
    expect(byStars(0)).toBe(2);
  });

  it('pays nothing for Relaxed, which is the point of it', () => {
    const first = stageIds[0];
    if (first === undefined) throw new Error('no stages');
    expect(modeById(first, 'relaxed')?.maxStars).toBe(0);
    expect(registry.tuning.difficulties['relaxed']?.awardsStars).toBe(false);
  });
});

/**
 * The picker shows words, and a missing key renders as the key itself.
 *
 * `content:lint` already checks the challenges' keys, because those live in
 * content. A difficulty's do not — they are named after an id in `tuning.json`
 * — so nothing else would catch "difficulty.brutal.name" appearing on a
 * button.
 */
describe('every mode says what it is', () => {
  const keys = new Set(Object.keys(locale as Record<string, string>));

  it.each(stageIds)('%s names and describes each one', (stageId) => {
    for (const mode of modesFor(stageId)) {
      expect(keys.has(mode.nameKey), `${mode.id}: ${mode.nameKey}`).toBe(true);
      expect(keys.has(mode.descriptionKey), `${mode.id}: ${mode.descriptionKey}`).toBe(true);
    }
  });
});

/**
 * §14.2 gates Endless and nothing else.
 *
 * "3-star the stage" is a thing done on one mode rather than a total summed
 * across four — eleven stars spread thinly is not mastery of the map, which is
 * what the gate is for.
 */
describe('what Endless costs to open', () => {
  function won(over: Partial<StageResult> = {}): StageResult {
    return {
      won: true,
      stars: 3,
      livesRemaining: 20,
      startingLives: 20,
      durationSeconds: 300,
      wavesCleared: 10,
      totalWaves: 10,
      enemiesKilled: 10,
      enemiesLeaked: 0,
      goldEarned: 100,
      towersBuilt: 3,
      reactionsTriggered: 1,
      ...over,
    };
  }

  const stageId = '1-1';
  const endless = modeById(stageId, 'endless_1_1');
  if (endless === undefined) throw new Error('no Endless challenge on 1-1');

  it('is the only mode that is gated at all', () => {
    for (const mode of modesFor(stageId)) {
      expect(mode.requiresStars, mode.id).toBe(mode.kind === 'endless' ? ENDLESS_STARS : 0);
      if (mode.kind !== 'endless') expect(modeLocked(EMPTY_PROFILE, stageId, mode)).toBe(false);
    }
  });

  it('is closed before the stage has been mastered', () => {
    expect(modeLocked(EMPTY_PROFILE, stageId, endless)).toBe(true);

    const oneStar = recordStageResult(EMPTY_PROFILE, stageId, 'normal', won({ stars: 1 }));
    expect(modeLocked(oneStar, stageId, endless)).toBe(true);
  });

  it('opens on three stars on any one mode', () => {
    const onNormal = recordStageResult(EMPTY_PROFILE, stageId, 'normal', won());
    expect(modeLocked(onNormal, stageId, endless)).toBe(false);

    const onVeteran = recordStageResult(EMPTY_PROFILE, stageId, 'veteran', won());
    expect(modeLocked(onVeteran, stageId, endless)).toBe(false);
  });

  /* Three stars scraped across three modes is not mastery of the map. */
  it('does not open on three stars added up across modes', () => {
    let profile = recordStageResult(EMPTY_PROFILE, stageId, 'normal', won({ stars: 1 }));
    profile = recordStageResult(profile, stageId, 'veteran', won({ stars: 1 }));
    profile = recordStageResult(profile, stageId, 'impossible', won({ stars: 1 }));
    expect(modeLocked(profile, stageId, endless)).toBe(true);
  });

  /* And it is this stage's stars, not the campaign's. */
  it('is per stage', () => {
    const elsewhere = recordStageResult(EMPTY_PROFILE, '1-2', 'normal', won());
    expect(modeLocked(elsewhere, stageId, endless)).toBe(true);
  });

  it('says what opens it', () => {
    expect(lockReason(endless)).toContain('3-star');
  });
});
