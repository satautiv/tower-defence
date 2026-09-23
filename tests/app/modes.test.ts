import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import { DEFAULT_MODE_ID, defaultMode, maxStarsFor, modeById, modesFor } from '@app/modes';
import { STARS_PER_STAGE } from '@app/profile';
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
