import type { BalanceTarget } from '../../src/content/schema/stage.js';
import type { RunResult } from './runner.js';

/**
 * Turning two thousand runs into something a person can act on.
 *
 * The numbers chosen are the ones that name a *design* problem rather than a
 * tuning one. A win rate says whether a stage is beatable; a pick-rate spread
 * says whether the roster has a dead tower in it, and a reaction count says
 * whether the mechanic the whole game is built around is firing at all. Those
 * last two are what #35 exists for — the first is just the price of entry.
 */

export interface TowerPick {
  id: string;
  builds: number;
  /** Share of all builds, 0 to 1. */
  rate: number;
}

export interface Summary {
  stage: string;
  strategy: string;
  runs: number;
  winRate: number;
  target: BalanceTarget;
  /** True when the win rate sits inside the stage's authored band. */
  withinTarget: boolean;
  medianLivesRemaining: number;
  startingLives: number;
  medianClearSeconds: number;
  /** Where losses happened: 10th, 50th and 90th percentile wave. */
  lossWaveP10: number;
  lossWaveP50: number;
  lossWaveP90: number;
  losses: number;
  medianPeakUnspentGold: number;
  medianReactions: number;
  /** Runs that triggered no reaction at all. */
  runsWithoutReaction: number;
  picks: TowerPick[];
  timedOut: number;
}

/** Design problems the numbers name outright. Reported, never auto-corrected. */
export interface Finding {
  severity: 'warn' | 'fail';
  code: string;
  message: string;
}

/**
 * Least share of an *even* split a tower must reach to count as picked.
 *
 * Relative, not absolute. #35 asks for "any tower below a 20% pick rate", which
 * was written loosely and does not survive the roster it was written for: with
 * the eight towers of §8.1 an even split is 12.5% each, so a flat 20% floor
 * flags every tower in a perfectly balanced game and says nothing. Half of an
 * even share is the same question asked in a way that scales — 6.3% at eight
 * towers, 16.7% at three, and it still rejects the three-tower distribution
 * that prompted the criterion.
 *
 * Widened deliberately and once, with the reason written down. Nudging it again
 * because a warning is inconvenient is precisely what this tool exists to stop.
 */
export const MIN_PICK_SHARE = 0.5;
/**
 * Widest acceptable ratio between the most and least picked tower.
 *
 * #35's own acceptance criterion, and it is phrased as a design rule rather
 * than a threshold to tune: *if pick-rate spread exceeds 4:1, that's a design
 * problem to fix, not a number to nudge*.
 */
export const MAX_PICK_SPREAD = 4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Nearest-rank percentile, so every value reported is one that occurred. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[rank] as number;
}

export function summarise(
  stage: string,
  strategy: string,
  towerIds: readonly string[],
  target: BalanceTarget,
  results: RunResult[],
): Summary {
  const wins = results.filter((r) => r.won);
  const losses = results.filter((r) => !r.won);
  const lossWaves = losses.map((r) => r.wavesCleared);
  const winRate = results.length === 0 ? 0 : wins.length / results.length;

  const builds = towerIds.map((_, typeIdx) =>
    results.reduce((total, run) => total + ((run.buildsByTower[typeIdx] as number) ?? 0), 0),
  );
  const totalBuilds = builds.reduce((a, b) => a + b, 0);

  return {
    stage,
    strategy,
    runs: results.length,
    winRate,
    target,
    withinTarget: winRate >= target.minWinRate && winRate <= target.maxWinRate,
    medianLivesRemaining: median(results.map((r) => r.livesRemaining)),
    startingLives: results[0]?.startingLives ?? 0,
    /* Wins only: a median clear time that averaged in losses would describe a
       run nobody had. */
    medianClearSeconds: median(wins.map((r) => r.durationSeconds)),
    lossWaveP10: percentile(lossWaves, 10),
    lossWaveP50: percentile(lossWaves, 50),
    lossWaveP90: percentile(lossWaves, 90),
    losses: losses.length,
    medianPeakUnspentGold: median(results.map((r) => r.peakUnspentGold)),
    medianReactions: median(results.map((r) => r.reactionsTriggered)),
    runsWithoutReaction: results.filter((r) => r.reactionsTriggered === 0).length,
    picks: towerIds.map((id, typeIdx) => ({
      id,
      builds: builds[typeIdx] as number,
      rate: totalBuilds === 0 ? 0 : (builds[typeIdx] as number) / totalBuilds,
    })),
    timedOut: results.filter((r) => r.timedOut).length,
  };
}

/**
 * What the numbers say is wrong, in the language of the design.
 *
 * A finding names the pillar or the criterion it comes from, because a bare
 * number invites someone to nudge it until the warning stops — which is
 * precisely the failure this tool exists to prevent.
 */
/**
 * Strategies the authored band is a statement about.
 *
 * `rush` is deliberately excluded. It calls every wave the instant it can,
 * which is the game's main risk/reward dial turned to its limit — a player
 * doing that *should* be able to lose, and holding it to the same band as
 * careful play would make the band mean nothing. It gets its own finding
 * instead.
 */
function bandApplies(strategy: string): boolean {
  return strategy !== 'rush';
}

export function findings(summary: Summary): Finding[] {
  const out: Finding[] = [];

  if (!summary.withinTarget && bandApplies(summary.strategy)) {
    out.push({
      severity: 'fail',
      code: 'win-rate-out-of-band',
      message:
        `win rate ${pct(summary.winRate)} is outside the authored band ` +
        `${pct(summary.target.minWinRate)}–${pct(summary.target.maxWinRate)}`,
    });
  }

  /**
   * The early-call bonus is a bet. Whether it is priced right shows up at the
   * extremes: if rushing never costs anything the bonus is free money, and if
   * it never pays off nobody will ever press the button.
   */
  if (summary.strategy === 'rush' && summary.runs > 0) {
    if (summary.winRate >= 0.95 && summary.medianLivesRemaining === summary.startingLives) {
      out.push({
        severity: 'warn',
        code: 'early-call-free',
        message:
          `rushing every wave wins ${pct(summary.winRate)} without losing a life — ` +
          'the early-call bonus costs nothing, so it is not a decision',
      });
    } else if (summary.winRate <= 0.05) {
      out.push({
        severity: 'warn',
        code: 'early-call-fatal',
        message:
          `rushing every wave wins ${pct(summary.winRate)} — nobody will press the button, ` +
          'so the risk/reward dial has no usable range',
      });
    }
  }

  if (summary.timedOut > 0) {
    out.push({
      severity: 'fail',
      code: 'runs-timed-out',
      message: `${summary.timedOut} run(s) never finished — a board that cannot clear a wave`,
    });
  }

  /* Only meaningful for a strategy that was free to choose. A single-type run
     has a 100% pick rate by construction and says nothing about the roster. */
  if (summary.strategy === 'greedy' || summary.strategy === 'balanced') {
    const evenShare = summary.picks.length > 0 ? 1 / summary.picks.length : 0;
    const floor = evenShare * MIN_PICK_SHARE;

    for (const pick of summary.picks) {
      if (pick.rate < floor) {
        out.push({
          severity: 'warn',
          code: 'tower-unpicked',
          message:
            `${pick.id} is ${pct(pick.rate)} of builds, under the ${pct(floor)} floor ` +
            `(half an even share of ${summary.picks.length}) — pillar P1 (no dead towers)`,
        });
      }
    }

    const rates = summary.picks.map((p) => p.rate).filter((r) => r > 0);
    const spread = rates.length > 0 ? Math.max(...rates) / Math.min(...rates) : 0;
    if (spread > MAX_PICK_SPREAD) {
      out.push({
        severity: 'warn',
        code: 'pick-spread',
        message:
          `pick rates span ${spread.toFixed(1)}:1, past the ${MAX_PICK_SPREAD}:1 limit — ` +
          'a design problem to fix, not a number to nudge',
      });
    }
  }

  if (summary.medianReactions === 0) {
    out.push({
      severity: 'warn',
      code: 'reactions-never-fire',
      message:
        `the median run triggers no reaction at all (${summary.runsWithoutReaction} of ` +
        `${summary.runs} runs trigger none) — the signature mechanic is not in play`,
    });
  }

  return out;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** A short console block per strategy. Read by a person, not a machine. */
export function formatConsole(summary: Summary): string {
  const lines: string[] = [];
  const verdict = summary.withinTarget ? 'within band' : 'OUT OF BAND';

  lines.push(`${summary.stage} · ${summary.strategy} · ${summary.runs} runs`);
  lines.push(
    `  win rate        ${pct(summary.winRate)}  (target ${pct(summary.target.minWinRate)}–` +
      `${pct(summary.target.maxWinRate)}, ${verdict})`,
  );
  lines.push(
    `  lives left      ${summary.medianLivesRemaining} of ${summary.startingLives} (median)`,
  );
  lines.push(`  clear time      ${summary.medianClearSeconds.toFixed(1)}s (median of wins)`);
  if (summary.losses > 0) {
    lines.push(
      `  lost on wave    p10 ${summary.lossWaveP10} · p50 ${summary.lossWaveP50} · ` +
        `p90 ${summary.lossWaveP90}  (${summary.losses} losses)`,
    );
  }
  lines.push(`  peak unspent    ${summary.medianPeakUnspentGold} gold (median)`);
  lines.push(
    `  reactions       ${summary.medianReactions} (median) · ` +
      `${summary.runsWithoutReaction} run(s) with none`,
  );

  const picks = summary.picks.map((pick) => `${pick.id} ${pct(pick.rate)}`).join(' · ');
  lines.push(`  tower picks     ${picks || 'none'}`);

  for (const finding of findings(summary)) {
    lines.push(`  ${finding.severity === 'fail' ? '✗' : '⚠'} ${finding.message}`);
  }
  return lines.join('\n');
}

/** One row per strategy. Stable column order, so a diff of two runs is readable. */
export function formatCsv(summaries: Summary[], towerIds: readonly string[]): string {
  const header = [
    'stage',
    'strategy',
    'runs',
    'winRate',
    'targetMin',
    'targetMax',
    'withinTarget',
    'medianLives',
    'medianClearSeconds',
    'lossWaveP10',
    'lossWaveP50',
    'lossWaveP90',
    'losses',
    'medianPeakUnspentGold',
    'medianReactions',
    'runsWithoutReaction',
    'timedOut',
    ...towerIds.map((id) => `pick_${id}`),
  ];

  const rows = summaries.map((s) =>
    [
      s.stage,
      s.strategy,
      s.runs,
      s.winRate.toFixed(4),
      s.target.minWinRate,
      s.target.maxWinRate,
      s.withinTarget,
      s.medianLivesRemaining,
      s.medianClearSeconds.toFixed(2),
      s.lossWaveP10,
      s.lossWaveP50,
      s.lossWaveP90,
      s.losses,
      s.medianPeakUnspentGold,
      s.medianReactions,
      s.runsWithoutReaction,
      s.timedOut,
      ...towerIds.map((id) => (s.picks.find((p) => p.id === id)?.rate ?? 0).toFixed(4)),
    ].join(','),
  );

  return [header.join(','), ...rows].join('\n') + '\n';
}

export function formatJson(summaries: Summary[]): string {
  return (
    JSON.stringify(
      summaries.map((summary) => ({ ...summary, findings: findings(summary) })),
      null,
      2,
    ) + '\n'
  );
}

/** True when anything found is serious enough to fail a build. */
export function hasFailure(summaries: Summary[]): boolean {
  return summaries.some((s) => findings(s).some((f) => f.severity === 'fail'));
}
