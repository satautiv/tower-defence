import { TALENT_BRANCHES } from '@content/schema/talent';
import type { TalentBranch, TalentDefinition } from '@content/schema/talent';
import type { Profile } from './profile.js';
import { totalStars } from './profile.js';

/**
 * Spending stars on the Warden Talent tree (#37, docs/GAME_DESIGN.md §14.1).
 *
 * Pure, so the rules are testable without a store or a browser, and so the
 * caller decides when a write happens — the same split `recordStageResult`
 * takes in `profile.ts`.
 *
 * Everything here answers to one design rule: **the tree is fully respeccable
 * at any time, for free.** Locking a player out of experimenting in a strategy
 * game is a design failure (pillar P5), so nothing in this file charges for
 * taking a rank back, and no path through it can leave a player with fewer
 * stars than they earned.
 */

export type TalentTree = ReadonlyMap<string, TalentDefinition>;

export interface TalentState {
  /** Ranks taken, by node id. */
  readonly ranks: Readonly<Record<string, number>>;
  readonly earned: number;
  readonly spent: number;
  readonly available: number;
}

export function ranksOf(profile: Profile, id: string): number {
  return profile.talents[id] ?? 0;
}

/**
 * Stars committed to the tree.
 *
 * Counts only what the tree still offers. A node retired between builds should
 * hand its stars back rather than keep charging for something the player can no
 * longer see — and a profile naming a node that does not exist must not be able
 * to make `available` negative.
 */
export function starsSpent(profile: Profile, tree: TalentTree): number {
  let spent = 0;
  for (const [id, ranks] of Object.entries(profile.talents)) {
    const talent = tree.get(id);
    if (talent === undefined || ranks <= 0) continue;
    spent += Math.min(ranks, talent.maxRanks) * talent.starCostPerRank;
  }
  return spent;
}

export function talentState(profile: Profile, tree: TalentTree): TalentState {
  const earned = totalStars(profile);
  const spent = starsSpent(profile, tree);
  return { ranks: profile.talents, earned, spent, available: Math.max(0, earned - spent) };
}

/** Why a rank cannot be taken, or null when it can. */
export type RankRefusal = 'unknown' | 'maxed' | 'locked' | 'unaffordable';

/**
 * Whether a node's prerequisites are met.
 *
 * "Met" is one rank, not all of them: §14.1 draws the tree as a dependency
 * graph rather than a ladder, so a prerequisite gates access and does not
 * demand mastery.
 */
export function prerequisitesMet(profile: Profile, talent: TalentDefinition): boolean {
  return talent.requires.every((id) => ranksOf(profile, id) > 0);
}

export function refuseRank(profile: Profile, tree: TalentTree, id: string): RankRefusal | null {
  const talent = tree.get(id);
  if (talent === undefined) return 'unknown';
  if (ranksOf(profile, id) >= talent.maxRanks) return 'maxed';
  if (!prerequisitesMet(profile, talent)) return 'locked';
  if (talentState(profile, tree).available < talent.starCostPerRank) return 'unaffordable';
  return null;
}

export function canTakeRank(profile: Profile, tree: TalentTree, id: string): boolean {
  return refuseRank(profile, tree, id) === null;
}

/** Takes one rank, or returns the profile unchanged when it cannot be taken. */
export function takeRank(profile: Profile, tree: TalentTree, id: string): Profile {
  if (!canTakeRank(profile, tree, id)) return profile;
  return { ...profile, talents: { ...profile.talents, [id]: ranksOf(profile, id) + 1 } };
}

/** Nodes that would be left with an unmet prerequisite if `id` dropped a rank. */
export function dependentsOf(profile: Profile, tree: TalentTree, id: string): string[] {
  if (ranksOf(profile, id) !== 1) return [];
  const stranded: string[] = [];
  for (const talent of tree.values()) {
    if (ranksOf(profile, talent.id) > 0 && talent.requires.includes(id)) stranded.push(talent.id);
  }
  return stranded;
}

/**
 * Gives one rank back.
 *
 * Refused when it would strand a node deeper in the branch — dropping the last
 * rank of a prerequisite while something downstream still holds ranks would
 * leave a build the tree itself says is impossible, and the next load would
 * have to decide what to do about it. Respec exists for that case and costs
 * nothing, so the player is never stuck.
 */
export function refundRank(profile: Profile, tree: TalentTree, id: string): Profile {
  const current = ranksOf(profile, id);
  if (current <= 0 || !tree.has(id)) return profile;
  if (dependentsOf(profile, tree, id).length > 0) return profile;

  const talents = { ...profile.talents };
  if (current === 1) delete talents[id];
  else talents[id] = current - 1;
  return { ...profile, talents };
}

/**
 * Hands every star back.
 *
 * Instant, free, and loses nothing: the stars return to the pool and the
 * player spends them again. This is pillar P5 in one function.
 */
export function respec(profile: Profile): Profile {
  return { ...profile, talents: {} };
}

/**
 * Nodes of one branch, prerequisites before the nodes that need them.
 *
 * Ordered by depth rather than by a pairwise comparator. A comparator cannot
 * do this: "a comes before b when b requires a" is not transitive across a
 * chain, so `resonant_bloom → cascade → catalyst → detonation` sorts into an
 * order that puts a prerequisite below its dependent, and `Array.sort` is free
 * to produce any of them. Depth is well defined for a directed acyclic graph,
 * and `content:lint` already refuses a cycle.
 */
export function branchNodes(tree: TalentTree, branch: TalentBranch): TalentDefinition[] {
  const nodes = [...tree.values()].filter((talent) => talent.branch === branch);

  const depth = new Map<string, number>();
  const depthOf = (id: string, seen: ReadonlySet<string>): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    /* A cycle cannot reach here from valid content, but a guard costs nothing
       and beats a stack overflow if one ever does. */
    if (seen.has(id)) return 0;

    const talent = tree.get(id);
    let deepest = 0;
    if (talent !== undefined) {
      const inner = new Set(seen).add(id);
      for (const required of talent.requires) {
        deepest = Math.max(deepest, depthOf(required, inner) + 1);
      }
    }
    depth.set(id, deepest);
    return deepest;
  };

  for (const talent of nodes) depthOf(talent.id, new Set());

  return nodes.sort((a, b) => {
    const byDepth = (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0);
    return byDepth !== 0 ? byDepth : a.id.localeCompare(b.id);
  });
}

export const BRANCHES: readonly TalentBranch[] = TALENT_BRANCHES;

/**
 * What one more rank would change, in words a player can read.
 *
 * Returned as a signed percentage or a flat amount rather than a sentence, so
 * the screen decides the wording and this stays testable.
 */
export interface RankPreview {
  readonly ranksNow: number;
  readonly maxRanks: number;
  readonly perRank: number;
  readonly mode: 'multiplier' | 'flat';
  /** Total the player has from this node now. */
  readonly totalNow: number;
  /** Total after one more rank, or the same when it is maxed. */
  readonly totalNext: number;
  readonly cost: number;
}

export function previewRank(profile: Profile, talent: TalentDefinition): RankPreview {
  const ranksNow = Math.min(ranksOf(profile, talent.id), talent.maxRanks);
  const next = Math.min(ranksNow + 1, talent.maxRanks);
  return {
    ranksNow,
    maxRanks: talent.maxRanks,
    perRank: talent.modifier.perRank,
    mode: talent.modifier.mode,
    totalNow: talent.modifier.perRank * ranksNow,
    totalNext: talent.modifier.perRank * next,
    cost: talent.starCostPerRank,
  };
}
