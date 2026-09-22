import type { RulesetOptions } from '@sim/index';

/**
 * A world with every tower available (#36).
 *
 * Unlocks belong to the player's progress, not to the stage, so a test about
 * a mechanic has to say which player it is testing as. Almost all of them mean
 * "someone with the whole toolkit" — a Prism Tower's refraction and a
 * garrison's blocking are not questions about the campaign's teaching order —
 * and saying so here keeps that choice in one place rather than in sixty.
 *
 * A test that is about gating should say so instead, by passing its own
 * `progressStageId`. `tests/sim/unlocks.test.ts` is the one that does.
 */
export const FULL_ROSTER: RulesetOptions = { progressStageId: '1-10' };
