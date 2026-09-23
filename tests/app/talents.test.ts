import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import type { TalentDefinition } from '@content/schema/talent';
import { EMPTY_PROFILE, recordStageResult, totalStars } from '@app/profile';
import type { Profile } from '@app/profile';
import {
  branchNodes,
  canTakeRank,
  dependentsOf,
  prerequisitesMet,
  previewRank,
  ranksOf,
  refundRank,
  refuseRank,
  respec,
  starsSpent,
  takeRank,
  talentState,
} from '@app/talents';
import type { TalentTree } from '@app/talents';
import type { StageResult } from '@sim/index';

/**
 * Spending stars, and giving them back.
 *
 * One rule governs the lot: the tree is fully respeccable at any time, for
 * free (pillar P5). No path through these functions may leave a player with
 * fewer stars than they earned, or stuck in a build they cannot leave.
 */

function node(over: Partial<TalentDefinition> & { id: string }): TalentDefinition {
  return {
    nameKey: 'talent.x.name',
    descriptionKey: 'talent.x.desc',
    branch: 'foundry',
    maxRanks: 3,
    starCostPerRank: 1,
    modifier: { stat: 'towerDamage', perRank: 0.02, mode: 'multiplier' },
    requires: [],
    ...over,
  } as TalentDefinition;
}

/** A small tree: a root, a child that needs it, and one unrelated node. */
const TREE: TalentTree = new Map<string, TalentDefinition>([
  ['root', node({ id: 'root', maxRanks: 3, starCostPerRank: 1 })],
  ['child', node({ id: 'child', maxRanks: 2, starCostPerRank: 2, requires: ['root'] })],
  ['loner', node({ id: 'loner', branch: 'dominion', maxRanks: 1, starCostPerRank: 5 })],
]);

function won(stars: 1 | 2 | 3): StageResult {
  return {
    won: true,
    stars,
    livesRemaining: 20,
    startingLives: 20,
    durationSeconds: 300,
    wavesCleared: 12,
    totalWaves: 12,
    enemiesKilled: 10,
    enemiesLeaked: 0,
    goldEarned: 100,
    towersBuilt: 3,
    reactionsTriggered: 1,
  };
}

/** A profile holding exactly `stars` stars, spread over as many stages as needed. */
function withStars(stars: number): Profile {
  let profile = EMPTY_PROFILE;
  let left = stars;
  let stage = 1;
  while (left > 0) {
    const take = Math.min(3, left) as 1 | 2 | 3;
    profile = recordStageResult(profile, `1-${stage}`, 'normal', won(take));
    left -= take;
    stage++;
  }
  return profile;
}

describe('the star pool', () => {
  it('is what the campaign earned, before anything is spent', () => {
    const profile = withStars(7);
    expect(totalStars(profile)).toBe(7);
    expect(talentState(profile, TREE)).toMatchObject({ earned: 7, spent: 0, available: 7 });
  });

  it('shrinks as ranks are taken', () => {
    let profile = withStars(6);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'root');
    expect(talentState(profile, TREE)).toMatchObject({ spent: 2, available: 4 });
  });

  it('charges each node its own price', () => {
    let profile = withStars(9);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'child');
    expect(starsSpent(profile, TREE)).toBe(3);
  });

  /* A node retired between builds should hand its stars back rather than keep
     charging for something the player can no longer see. */
  it('does not charge for a node the tree no longer offers', () => {
    const profile: Profile = { ...withStars(5), talents: { gone: 4, root: 1 } };
    expect(starsSpent(profile, TREE)).toBe(1);
    expect(talentState(profile, TREE).available).toBe(4);
  });

  it('never reports a negative pool, however odd the profile', () => {
    const profile: Profile = { ...EMPTY_PROFILE, talents: { loner: 1 } };
    expect(talentState(profile, TREE).available).toBe(0);
  });

  it('ignores ranks beyond a node’s maximum when charging', () => {
    const profile: Profile = { ...withStars(9), talents: { root: 99 } };
    expect(starsSpent(profile, TREE)).toBe(3);
  });
});

describe('taking a rank', () => {
  it('is refused with a reason', () => {
    const broke = withStars(1);
    expect(refuseRank(broke, TREE, 'nope')).toBe('unknown');
    expect(refuseRank(broke, TREE, 'child')).toBe('locked');
    expect(refuseRank(broke, TREE, 'loner')).toBe('unaffordable');

    let maxed = withStars(9);
    for (let i = 0; i < 3; i++) maxed = takeRank(maxed, TREE, 'root');
    expect(refuseRank(maxed, TREE, 'root')).toBe('maxed');
  });

  it('opens up once its prerequisite has a single rank', () => {
    let profile = withStars(9);
    expect(prerequisitesMet(profile, TREE.get('child')!)).toBe(false);
    profile = takeRank(profile, TREE, 'root');
    expect(prerequisitesMet(profile, TREE.get('child')!)).toBe(true);
    expect(canTakeRank(profile, TREE, 'child')).toBe(true);
  });

  it('changes nothing when it is refused', () => {
    const profile = withStars(1);
    expect(takeRank(profile, TREE, 'loner')).toBe(profile);
    expect(takeRank(profile, TREE, 'child')).toBe(profile);
  });

  it('leaves the profile it was given alone', () => {
    const before = withStars(5);
    takeRank(before, TREE, 'root');
    expect(before.talents).toEqual({});
  });

  it('cannot spend past the pool', () => {
    let profile = withStars(2);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'root');
    expect(ranksOf(profile, 'root')).toBe(2);
    expect(talentState(profile, TREE).available).toBe(0);
  });
});

describe('giving a rank back', () => {
  it('returns the stars', () => {
    let profile = withStars(4);
    profile = takeRank(profile, TREE, 'root');
    expect(talentState(profile, TREE).available).toBe(3);
    profile = refundRank(profile, TREE, 'root');
    expect(talentState(profile, TREE).available).toBe(4);
    expect(ranksOf(profile, 'root')).toBe(0);
  });

  it('drops the entry rather than leaving a zero behind', () => {
    let profile = takeRank(withStars(4), TREE, 'root');
    profile = refundRank(profile, TREE, 'root');
    expect('root' in profile.talents).toBe(false);
  });

  /* Dropping the last rank of a prerequisite while something downstream still
     holds ranks would leave a build the tree itself says is impossible. */
  it('refuses to strand a node deeper in the branch', () => {
    let profile = withStars(9);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'child');

    expect(dependentsOf(profile, TREE, 'root')).toEqual(['child']);
    expect(refundRank(profile, TREE, 'root')).toBe(profile);
  });

  it('allows it once the dependent has been given back', () => {
    let profile = withStars(9);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'child');
    profile = refundRank(profile, TREE, 'child');
    profile = refundRank(profile, TREE, 'root');
    expect(ranksOf(profile, 'root')).toBe(0);
  });

  it('allows dropping a rank that is not the last one', () => {
    let profile = withStars(9);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'child');
    expect(dependentsOf(profile, TREE, 'root')).toEqual([]);
    expect(ranksOf(refundRank(profile, TREE, 'root'), 'root')).toBe(1);
  });

  it('does nothing for a node with no ranks', () => {
    const profile = withStars(3);
    expect(refundRank(profile, TREE, 'root')).toBe(profile);
  });
});

describe('respec', () => {
  /* Pillar P5 in one test. */
  it('is instant, free, and loses nothing', () => {
    let profile = withStars(9);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'child');
    profile = takeRank(profile, TREE, 'loner');

    const after = respec(profile);
    expect(after.talents).toEqual({});
    expect(talentState(after, TREE).available).toBe(talentState(after, TREE).earned);
    expect(totalStars(after)).toBe(totalStars(profile));
  });

  it('frees a build that refunds alone could not unwind', () => {
    let profile = withStars(9);
    profile = takeRank(profile, TREE, 'root');
    profile = takeRank(profile, TREE, 'child');
    expect(refundRank(profile, TREE, 'root')).toBe(profile);
    expect(respec(profile).talents).toEqual({});
  });

  it('keeps the rest of the profile', () => {
    const profile = takeRank(withStars(5), TREE, 'root');
    expect(respec(profile).stages).toEqual(profile.stages);
  });
});

describe('the authored tree', () => {
  const registry = loadContent();

  it('draws prerequisites above the nodes that need them', () => {
    const conduction = branchNodes(registry.talents, 'conduction');
    const ids = conduction.map((talent) => talent.id);
    for (const talent of conduction) {
      for (const required of talent.requires) {
        if (!ids.includes(required)) continue;
        expect(ids.indexOf(required)).toBeLessThan(ids.indexOf(talent.id));
      }
    }
  });

  it('can be bought into with real stars', () => {
    let profile = withStars(12);
    for (const talent of branchNodes(registry.talents, 'foundry')) {
      if (canTakeRank(profile, registry.talents, talent.id)) {
        profile = takeRank(profile, registry.talents, talent.id);
      }
    }
    expect(starsSpent(profile, registry.talents)).toBeGreaterThan(0);
    expect(talentState(profile, registry.talents).available).toBeGreaterThanOrEqual(0);
  });
});

describe('what a rank would change', () => {
  it('reports the total now and after', () => {
    const profile = takeRank(withStars(9), TREE, 'root');
    const preview = previewRank(profile, TREE.get('root')!);
    expect(preview).toMatchObject({ ranksNow: 1, maxRanks: 3, cost: 1, mode: 'multiplier' });
    expect(preview.totalNow).toBeCloseTo(0.02, 5);
    expect(preview.totalNext).toBeCloseTo(0.04, 5);
  });

  it('stops climbing at the last rank', () => {
    let profile = withStars(9);
    for (let i = 0; i < 3; i++) profile = takeRank(profile, TREE, 'root');
    const preview = previewRank(profile, TREE.get('root')!);
    expect(preview.totalNext).toBe(preview.totalNow);
  });
});
