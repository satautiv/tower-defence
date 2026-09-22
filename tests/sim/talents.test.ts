import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import { TALENT_STATS } from '@content/schema/talent';
import type { TalentStat } from '@content/schema/talent';
import { buildRuleset, createWorldForStage } from '@sim/index';
import type { Ruleset, RulesetOptions, World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Talents take the bargain unlocks, perks and ley nodes already take: folded
 * into the flat tables once, so no system knows they exist.
 *
 * The test that matters most is the last one. Every stat in the schema's
 * vocabulary must actually *move* something, because the failure this design
 * invites is a node authored against a stat nothing applies — a rank the
 * player buys and never receives. Asserting the catalogue is non-empty would
 * not catch it; driving each stat through `buildRuleset` and watching a number
 * change does.
 */

const SEED = 20260922;
const STAGE = '1-6';
const registry = loadContent();

function rulesFor(options: RulesetOptions = {}): Ruleset {
  const stage = registry.stages.get(STAGE);
  if (stage === undefined) throw new Error(`no stage ${STAGE}`);
  return buildRuleset(registry, stage, { ...FULL_ROSTER, heroId: 'kaelen', ...options });
}

function worldFor(options: RulesetOptions = {}): World {
  const stage = registry.stages.get(STAGE);
  if (stage === undefined) throw new Error(`no stage ${STAGE}`);
  return createWorldForStage(registry, stage, SEED, { ...FULL_ROSTER, ...options });
}

/**
 * A synthetic node for one stat, so the test does not depend on what the tree
 * happens to be authored as today.
 */
function nodeFor(stat: TalentStat, perRank: number, maxRanks = 1) {
  return {
    id: `probe_${stat}`,
    nameKey: 'talent.probe.name',
    descriptionKey: 'talent.probe.desc',
    branch: 'foundry' as const,
    maxRanks,
    starCostPerRank: 1,
    modifier: { stat, perRank, mode: 'multiplier' as const },
    requires: [],
  };
}

/** Builds a ruleset with one synthetic talent at full rank. */
function withProbe(stat: TalentStat, perRank: number): Ruleset {
  const probe = nodeFor(stat, perRank);
  const talents = new Map(registry.talents);
  talents.set(probe.id, probe as unknown as ReturnType<typeof talents.get> & object);
  const stage = registry.stages.get(STAGE);
  if (stage === undefined) throw new Error('no stage');
  return buildRuleset({ ...registry, talents } as typeof registry, stage, {
    ...FULL_ROSTER,
    heroId: 'kaelen',
    talents: { [probe.id]: 1 },
  });
}

describe('a talent reaches the numbers a tick reads', () => {
  it('leaves everything alone when nothing is bought', () => {
    const none = rulesFor();
    const empty = rulesFor({ talents: {} });
    expect(Array.from(empty.towers.damage)).toEqual(Array.from(none.towers.damage));
    expect(empty.talentWorld).toEqual({ startingGold: 0, reactionPower: 1 });
  });

  it('scales tower damage', () => {
    const base = rulesFor();
    const buffed = withProbe('towerDamage', 0.5);
    expect(buffed.towers.damage[0]).toBeCloseTo((base.towers.damage[0] as number) * 1.5, 4);
  });

  it('scales tower range', () => {
    const base = rulesFor();
    const buffed = withProbe('towerRange', 0.25);
    expect(buffed.towers.range[0]).toBeCloseTo((base.towers.range[0] as number) * 1.25, 4);
  });

  it('makes building cheaper, in whole gold', () => {
    const base = rulesFor();
    const cheap = withProbe('buildCost', -0.2);
    expect(cheap.towers.cost[0]).toBe(Math.round((base.towers.cost[0] as number) * 0.8));
    expect(Number.isInteger(cheap.towers.cost[0])).toBe(true);
  });

  it('raises the sell refund without ever passing the full price', () => {
    const generous = withProbe('sellRefund', 5);
    for (const fraction of generous.towerRefund.values()) {
      expect(fraction).toBeLessThanOrEqual(1);
    }
    expect([...generous.towerRefund.values()].every((f) => f === 1)).toBe(true);
  });

  it('shortens a reaction lockout but never below a tick', () => {
    const base = rulesFor();
    const quick = withProbe('reactionCooldown', -0.5);
    expect(quick.reactions.cooldownTicks[0]).toBe((base.reactions.cooldownTicks[0] as number) - 30);

    const absurd = withProbe('reactionCooldown', -999);
    expect(absurd.reactions.cooldownTicks[0]).toBe(1);
  });

  it('shortens a power cooldown but never below a tick', () => {
    const base = rulesFor();
    const quick = withProbe('powerCooldown', -0.3);
    expect(quick.powers.cooldownTicks[0]).toBe(
      Math.round((base.powers.cooldownTicks[0] as number) * 0.7),
    );
  });

  it('toughens soldiers', () => {
    const base = rulesFor();
    const tough = withProbe('soldierHp', 0.4);
    const index = Array.from(base.towers.soldierHp).findIndex((hp) => hp > 0);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(tough.towers.soldierHp[index]).toBeCloseTo(
      (base.towers.soldierHp[index] as number) * 1.4,
      3,
    );
  });

  /* Zero means "not a garrison". Handing every tower a rally range would make
     a Flame Vent look like a barracks to everything that checks. */
  it('extends a rally range only where there is a garrison', () => {
    const base = rulesFor();
    const wide = withProbe('rallyRange', 2);
    for (let i = 0; i < base.towers.rallyRange.length; i++) {
      const before = base.towers.rallyRange[i] as number;
      const after = wide.towers.rallyRange[i] as number;
      if (before === 0) expect(after).toBe(0);
      else expect(after).toBeGreaterThan(before);
    }
  });

  it('shortens hero respawn and ability cooldowns', () => {
    const base = rulesFor();
    const quick = withProbe('heroRespawn', -3);
    expect(quick.hero?.respawnTicks).toBe((base.hero?.respawnTicks ?? 0) - 180);

    const ready = withProbe('heroAbilityCooldown', -0.25);
    expect(ready.hero?.abilityCooldownTicks[0]).toBe(
      Math.round((base.hero?.abilityCooldownTicks[0] as number) * 0.75),
    );
  });

  it('adds aether regeneration and reaction aether to the tuning', () => {
    const base = rulesFor();
    const regen = withProbe('aetherRegen', 0.5);
    expect(regen.tuning.aetherPerSecond).toBeCloseTo(base.tuning.aetherPerSecond + 0.5, 4);

    const overflow = withProbe('aetherPerReaction', 2);
    expect(overflow.tuning.aetherPerReaction).toBeCloseTo(base.tuning.aetherPerReaction + 2, 4);
  });

  /* The registry is shared by every stage the balance simulator builds. */
  it('does not leak one player’s talents into the next ruleset built', () => {
    const before = rulesFor().tuning.aetherPerSecond;
    withProbe('aetherRegen', 5);
    expect(rulesFor().tuning.aetherPerSecond).toBe(before);
    expect(registry.tuning.aetherPerSecond).toBe(before);
  });
});

describe('talents that land on the world rather than a table', () => {
  it('reports starting gold and reaction power on the ruleset', () => {
    const rich = withProbe('startingGold', 120);
    expect(rich.talentWorld.startingGold).toBe(120);

    const loud = withProbe('reactionPower', 0.3);
    expect(loud.talentWorld.reactionPower).toBeCloseTo(1.3, 4);
  });

  it('applies them when the world is built', () => {
    const plain = worldFor();
    const rich = worldFor({ talents: { foundry_edge: 5 } });
    expect(rich.rules.towers.damage[0]).toBeGreaterThan(plain.rules.towers.damage[0] as number);
  });

  it('applies a real authored node end to end', () => {
    const plain = worldFor();
    const bloomed = worldFor({ talents: { resonant_bloom: 5 } });
    /* resonant_bloom is +10%/rank reaction power, five ranks. */
    expect(bloomed.reactionPower).toBeCloseTo(plain.reactionPower * 1.5, 4);
  });
});

describe('ranks that did not come from the tree', () => {
  it('clamps a rank past the node’s maximum', () => {
    const honest = worldFor({ talents: { foundry_edge: 5 } });
    const cheated = worldFor({ talents: { foundry_edge: 9999 } });
    expect(cheated.rules.towers.damage[0]).toBe(honest.rules.towers.damage[0]);
  });

  it('ignores a node that is not in the tree', () => {
    const plain = worldFor();
    const nonsense = worldFor({ talents: { not_a_talent: 5 } });
    expect(nonsense.rules.towers.damage[0]).toBe(plain.rules.towers.damage[0]);
  });

  it('ignores a negative or zero rank', () => {
    const plain = worldFor();
    expect(worldFor({ talents: { foundry_edge: 0 } }).rules.towers.damage[0]).toBe(
      plain.rules.towers.damage[0],
    );
    expect(worldFor({ talents: { foundry_edge: -3 } }).rules.towers.damage[0]).toBe(
      plain.rules.towers.damage[0],
    );
  });
});

/**
 * The guard. A stat the schema accepts but nothing applies is a rank bought
 * and never received.
 */
describe('every stat in the vocabulary actually does something', () => {
  it.each(TALENT_STATS)('%s moves a number', (stat) => {
    const base = rulesFor();
    const probed = withProbe(stat, stat === 'startingGold' ? 100 : 0.5);

    const moved =
      JSON.stringify(Array.from(probed.towers.damage)) !==
        JSON.stringify(Array.from(base.towers.damage)) ||
      JSON.stringify(Array.from(probed.towers.range)) !==
        JSON.stringify(Array.from(base.towers.range)) ||
      JSON.stringify(Array.from(probed.towers.cost)) !==
        JSON.stringify(Array.from(base.towers.cost)) ||
      JSON.stringify(Array.from(probed.towers.soldierHp)) !==
        JSON.stringify(Array.from(base.towers.soldierHp)) ||
      JSON.stringify(Array.from(probed.towers.rallyRange)) !==
        JSON.stringify(Array.from(base.towers.rallyRange)) ||
      JSON.stringify(Array.from(probed.reactions.cooldownTicks)) !==
        JSON.stringify(Array.from(base.reactions.cooldownTicks)) ||
      JSON.stringify(Array.from(probed.powers.cooldownTicks)) !==
        JSON.stringify(Array.from(base.powers.cooldownTicks)) ||
      JSON.stringify([...probed.towerRefund]) !== JSON.stringify([...base.towerRefund]) ||
      probed.hero?.respawnTicks !== base.hero?.respawnTicks ||
      JSON.stringify(Array.from(probed.hero?.abilityCooldownTicks ?? [])) !==
        JSON.stringify(Array.from(base.hero?.abilityCooldownTicks ?? [])) ||
      probed.tuning.aetherPerSecond !== base.tuning.aetherPerSecond ||
      probed.tuning.aetherPerReaction !== base.tuning.aetherPerReaction ||
      probed.talentWorld.startingGold !== base.talentWorld.startingGold ||
      probed.talentWorld.reactionPower !== base.talentWorld.reactionPower;

    expect(moved, `"${stat}" is in the schema but nothing applies it`).toBe(true);
  });
});
