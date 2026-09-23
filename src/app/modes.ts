import { loadContent } from '@content/load';
import type { ChallengeDefinition } from '@content/schema/challenge';

/**
 * The ways one map can be played (#48, docs/GAME_DESIGN.md §12.4 and §13).
 *
 * §13's whole argument is that a map is reused five ways rather than built
 * five times, and this is the list that says which five for a given stage:
 * the authored difficulties, that stage's Heroic and Iron challenges, and its
 * Endless run. Read from content rather than listed here, so a fifth
 * difficulty or a second Heroic appears by being authored.
 *
 * A mode is what the *profile* records against and what the *ruleset* is built
 * from, and those are two different things — Veteran is a difficulty and Iron
 * is a challenge played on Normal's numbers. Keeping both fields on one object
 * is what lets a screen offer them in one list and `GameSession` build either
 * without a branch.
 */

export type ModeKind = 'difficulty' | 'challenge' | 'endless';

export interface PlayMode {
  /** What the profile records under. Unique within a stage. */
  readonly id: string;
  readonly kind: ModeKind;
  /** Locale keys, not words: `app/` does not reach into the interface. */
  readonly nameKey: string;
  readonly descriptionKey: string;
  /**
   * Stars this mode can pay.
   *
   * Three for each of the star-awarding difficulties, one each for Heroic and
   * Iron, none for Relaxed or Endless — which is §12.4's eleven per stage.
   */
  readonly maxStars: 0 | 1 | 3;
  /** Passed as `RulesetOptions.difficulty`. */
  readonly difficulty: string;
  /** Passed as `RulesetOptions.challengeId`, when this mode is one. */
  readonly challengeId?: string;
}

/** What a stage opens on, and the baseline every other figure is quoted against. */
export const DEFAULT_MODE_ID = 'normal';

/** §12.4's number, checked against `modesFor` by `tests/app/modes.test.ts`. */
export const STARS_PER_STAGE = 11;

function challengeMode(challenge: ChallengeDefinition): PlayMode {
  return {
    id: challenge.id,
    kind: challenge.kind === 'endless' ? 'endless' : 'challenge',
    nameKey: challenge.nameKey,
    descriptionKey: challenge.descriptionKey,
    /* Heroic and Iron are worth one star each and Endless is a leaderboard
       (§13). A challenge is one star for clearing it at all, never three:
       there is no half-solving a fixed-constraint puzzle. */
    maxStars: challenge.kind === 'endless' ? 0 : 1,
    difficulty: DEFAULT_MODE_ID,
    challengeId: challenge.id,
  };
}

/**
 * Every mode a stage can be played on, in the order a picker should show them.
 *
 * Difficulties come first, ordered by the lives they grant — most forgiving
 * first. Read from the tuning rather than listed, because a hand-written order
 * is a second place for a new mode to be forgotten, and lives is the field
 * that actually says how gentle a mode is.
 */
export function modesFor(stageId: string): PlayMode[] {
  const registry = loadContent();

  const difficulties = Object.entries(registry.tuning.difficulties)
    .sort(([, a], [, b]) => b.lives - a.lives)
    .map(([id, row]) => ({
      id,
      kind: 'difficulty' as const,
      nameKey: `difficulty.${id}.name`,
      descriptionKey: `difficulty.${id}.desc`,
      maxStars: (row.awardsStars ? 3 : 0) as 0 | 3,
      difficulty: id,
    }));

  /* Heroic, then Iron, then Endless: the order §13 introduces them in, which
     is also hardest-last. */
  const order: Readonly<Record<string, number>> = { heroic: 0, iron: 1, endless: 2 };
  const challenges = [...registry.challenges.values()]
    .filter((challenge) => challenge.stageId === stageId)
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
    .map(challengeMode);

  return [...difficulties, ...challenges];
}

export function modeById(stageId: string, id: string): PlayMode | undefined {
  return modesFor(stageId).find((mode) => mode.id === id);
}

/**
 * The mode a stage opens on, for a caller that has none.
 *
 * Falls back to the first mode offered rather than throwing, so a build that
 * retired `normal` would open on something rather than on nothing.
 */
export function defaultMode(stageId: string): PlayMode | undefined {
  const modes = modesFor(stageId);
  return modes.find((mode) => mode.id === DEFAULT_MODE_ID) ?? modes[0];
}

/** What one stage is worth, from what it actually offers. */
export function maxStarsFor(stageId: string): number {
  return modesFor(stageId).reduce((total, mode) => total + mode.maxStars, 0);
}
