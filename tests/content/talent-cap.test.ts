import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import { TALENT_BRANCHES } from '@content/schema/talent';
import type { TalentStat } from '@content/schema/talent';
import { runBatch } from '../../tools/balance-sim/runner.js';
import { balanced } from '../../tools/balance-sim/strategies.js';

/**
 * §14.1's hard requirement: total talent contribution must not exceed roughly
 * **+35% effective power**. Talents smooth the curve for players who struggle;
 * they do not replace skill.
 *
 * Checked two ways, because "effective power" is not one number. The arithmetic
 * check bounds each multiplier the tree can reach, which is precise and cheap.
 * The measured check answers the question the arithmetic cannot: does the tree
 * turn a stage a player was losing into one they win? It must not — a zero-talent
 * player has to be able to 3-star Normal on their own.
 */

const registry = loadContent();

/** Every stat's total if the whole tree were bought to its last rank. */
function fullTreeTotals(): Map<string, number> {
  const totals = new Map<string, number>();
  for (const talent of registry.talents.values()) {
    const { stat, perRank } = talent.modifier;
    totals.set(stat, (totals.get(stat) ?? 0) + perRank * talent.maxRanks);
  }
  return totals;
}

/** Stats that scale a value, where the cap is a percentage of it. */
const CAPPED: readonly TalentStat[] = [
  'reactionPower',
  'towerDamage',
  'towerRange',
  'buildCost',
  'soldierHp',
  'heroAbilityCooldown',
  'powerCooldown',
];

const CAP = 0.35;

describe('the tree stays inside its power budget', () => {
  const totals = fullTreeTotals();

  it.each(CAPPED)('%s does not exceed the cap even fully bought', (stat) => {
    const total = Math.abs(totals.get(stat) ?? 0);
    expect(
      total,
      `${stat} totals ${(total * 100).toFixed(1)}% across the whole tree`,
    ).toBeLessThanOrEqual(CAP);
  });

  it('has something in every branch', () => {
    for (const branch of TALENT_BRANCHES) {
      const nodes = [...registry.talents.values()].filter((t) => t.branch === branch);
      expect(nodes.length, `branch "${branch}" is empty`).toBeGreaterThanOrEqual(8);
    }
  });

  /* Region 1 yields 30 stars on Normal, and the tree costs far more. That is
     deliberate — §14.1 funds it from 110 per region once difficulties and
     challenges land (#40) — but it must not be *cheap*, or the cap above is
     reached before the campaign ends. */
  it('costs more than one region on Normal can pay for', () => {
    let cost = 0;
    for (const talent of registry.talents.values())
      cost += talent.maxRanks * talent.starCostPerRank;
    expect(cost).toBeGreaterThan(30 * 2);
  });
});

/**
 * The measured half. Slow, so it runs few seeds on the stages that discriminate:
 * the first, where a zero-talent player must still be perfect, and the hardest,
 * where a fully-talented one must not be handed the win.
 */
describe('talents smooth the curve rather than replace skill', () => {
  const FULL: Record<string, number> = {};
  for (const talent of registry.talents.values()) FULL[talent.id] = talent.maxRanks;

  function play(stageId: string, talents: Record<string, number>) {
    const stage = registry.stages.get(stageId);
    if (stage === undefined) throw new Error(`no stage ${stageId}`);
    const results = runBatch(registry, stage, balanced(), { runs: 12, rules: { talents } });
    const lives = results.map((r) => r.livesRemaining).sort((a, b) => a - b);
    return {
      winRate: results.filter((r) => r.won).length / results.length,
      medianLives: lives[Math.floor(lives.length / 2)] ?? 0,
    };
  }

  /* "A zero-talent player must still be able to 3-star Normal." Stars come from
     lives (§12.4), and three stars is finishing with all of them. */
  it('lets a player with no talents at all 3-star the first stage', () => {
    const none = play('1-1', {});
    expect(none.winRate).toBe(1);
    expect(none.medianLives).toBe(20);
  });

  it('does not turn a stage the player was losing into one they win', () => {
    for (const stageId of ['1-9', '1-10']) {
      const none = play(stageId, {});
      const full = play(stageId, FULL);
      /* The tree may widen the margin — that is what it is for — but the board
         has to have been winning it already. */
      expect(full.winRate, `${stageId} win rate`).toBeGreaterThanOrEqual(none.winRate);
      expect(none.winRate, `${stageId} is not winnable without talents`).toBeGreaterThan(0);
    }
  }, 300000);
});
