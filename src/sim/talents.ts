/**
 * The Warden Talent tree, resolved into numbers (#37, docs/GAME_DESIGN.md §14.1).
 *
 * Talents take the same bargain unlocks, perks and ley nodes already take: they
 * are folded into the flat tables once, at ruleset build time, so **no system
 * knows a talent exists**. A tick reads `towers.damage[i]` exactly as it did
 * before, and the +2%/rank is already in the number.
 *
 * The vocabulary itself lives in the schema, so an unknown stat fails at load
 * rather than at lint or — worst — not at all. A node authored against a stat
 * nothing applies is one the player buys and never receives, the same failure
 * as the Gilded Alembic perk whose 15% of a 6-gold bounty rounded to zero.
 * What lives here is how each stat *combines*: a multiplier or a flat amount,
 * and the floor below which it must not fall.
 */

import type { TalentStat } from '@content/schema/talent';
import { TALENT_STATS as TALENT_STAT_LIST } from '@content/schema/talent';

export type { TalentStat };

/** How an amount combines with the value it modifies. */
export const enum TalentMode {
  /** `value * (1 + total)`. A +2%/rank node at 5 ranks is `* 1.1`. */
  Multiplier = 0,
  /** `value + total`. Seconds, tiles, gold. */
  Flat = 1,
}

export interface TalentStatSpec {
  readonly mode: TalentMode;
  /**
   * Floor for the resulting multiplier or offset, where one is needed.
   *
   * A cooldown reduction stacked past 100% would make a power free and a
   * reaction continuous, which §14.1's cap exists to prevent — but the cap is a
   * design budget, not a runtime guarantee, and a runtime guarantee is what
   * stops a mis-authored tree from dividing by zero.
   */
  readonly floor?: number;
}

export const TALENT_SPECS: Readonly<Record<TalentStat, TalentStatSpec>> = {
  reactionPower: { mode: TalentMode.Multiplier },
  /* Seconds off the per-enemy lockout, never below a tick. */
  reactionCooldown: { mode: TalentMode.Flat },
  aetherPerReaction: { mode: TalentMode.Flat },

  towerDamage: { mode: TalentMode.Multiplier },
  towerRange: { mode: TalentMode.Multiplier },
  /* Authored negative: -3%/rank is cheaper. Floored so a tree can never make
     building free, which would break the economy rather than ease it. */
  buildCost: { mode: TalentMode.Multiplier, floor: 0.25 },
  sellRefund: { mode: TalentMode.Flat },

  soldierHp: { mode: TalentMode.Multiplier },
  heroRespawn: { mode: TalentMode.Flat },
  rallyRange: { mode: TalentMode.Flat },
  heroAbilityCooldown: { mode: TalentMode.Multiplier, floor: 0.25 },

  startingGold: { mode: TalentMode.Flat },
  aetherRegen: { mode: TalentMode.Flat },
  powerCooldown: { mode: TalentMode.Multiplier, floor: 0.25 },
};

/** Every stat a talent may name; the schema refuses anything else at load. */
export const TALENT_STAT_NAMES: readonly string[] = TALENT_STAT_LIST;

export function isTalentStat(stat: string): stat is TalentStat {
  return Object.prototype.hasOwnProperty.call(TALENT_SPECS, stat);
}

/** Resolved totals, by stat. Absent means the player has bought nothing into it. */
export type TalentTotals = ReadonlyMap<TalentStat, number>;

/** Ranks the player has taken, by talent id. */
export type TalentRanks = Readonly<Record<string, number>>;

export interface TalentModifier {
  readonly stat: string;
  readonly perRank: number;
  readonly mode: 'multiplier' | 'flat';
}

export interface TalentLike {
  readonly id: string;
  readonly maxRanks: number;
  readonly modifier: TalentModifier;
}

/**
 * Adds up what the player has bought.
 *
 * Ranks are clamped to the node's own maximum rather than trusted. They arrive
 * from a save file, and a profile edited by hand should give a player a bigger
 * number than they earned rather than a stat the tree never offered.
 */
export function totalTalents(
  talents: Iterable<TalentLike>,
  ranks: TalentRanks,
): Map<TalentStat, number> {
  const totals = new Map<TalentStat, number>();

  for (const talent of talents) {
    const taken = ranks[talent.id];
    if (taken === undefined || taken <= 0) continue;
    if (!isTalentStat(talent.modifier.stat)) continue;

    const capped = Math.min(Math.floor(taken), talent.maxRanks);
    const stat = talent.modifier.stat;
    totals.set(stat, (totals.get(stat) ?? 0) + talent.modifier.perRank * capped);
  }

  return totals;
}

/**
 * The multiplier a stat's total comes to, or 1 when nothing was bought.
 *
 * Only meaningful for `Multiplier` stats; a flat one is read with `flat`.
 */
export function multiplierFor(totals: TalentTotals, stat: TalentStat): number {
  const total = totals.get(stat);
  if (total === undefined) return 1;
  const floor = TALENT_SPECS[stat].floor;
  const value = 1 + total;
  return floor === undefined ? value : Math.max(floor, value);
}

export function flatFor(totals: TalentTotals, stat: TalentStat): number {
  return totals.get(stat) ?? 0;
}
