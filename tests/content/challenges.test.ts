import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import type { ChallengeDefinition } from '@content/schema/challenge';
import { createWorldForStage, sellTower, tick, towerIndex } from '@sim/index';
import type { RulesetOptions, World } from '@sim/index';
import { readContentFromDisk } from '../../tools/content/io.js';
import { runOnce } from '../../tools/balance-sim/runner.js';
import { strategyByName } from '../../tools/balance-sim/strategies.js';
import { buildTower } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Region 1's challenge variants, and the criterion that decides them (#46).
 *
 * > Every Heroic challenge has at least one verified solution.
 *
 * "Verified" is the word that matters. A Heroic puzzle nobody has solved is
 * indistinguishable from an unwinnable one until a player wastes an evening on
 * it, and hand-checking twenty of them once is a claim that rots the first time
 * a tower is retuned. So the solution is *recorded* — which scripted board
 * clears which challenge — and replayed here on every CI run.
 *
 * The scripted players are caricatures: `greedy` takes the dearest tower it
 * can afford and `balanced` round-robins the roster. Neither reads the map.
 * That is deliberately a low bar, and it is the right one for this claim: a
 * challenge a caricature clears is certainly solvable by a person, while
 * "solvable in principle" is not a thing a test can assert.
 *
 * Iron is not on that list, and the file says why below.
 */

const registry = buildRegistry(readContentFromDisk());

/**
 * Which scripted board clears each Heroic, found with the balance simulator.
 *
 * Read as the answer key: if a retune breaks one of these, the challenge has
 * become unsolvable-as-far-as-we-know and wants re-authoring, not a looser
 * assertion.
 */
const SOLUTIONS: Readonly<Record<string, string>> = {
  heroic_1_1: 'single:frost_cairn',
  heroic_1_2: 'single:arcane_spire',
  heroic_1_3: 'balanced',
  heroic_1_4: 'single:frost_cairn',
  heroic_1_5: 'balanced',
  heroic_1_6: 'balanced',
  heroic_1_7: 'balanced',
  heroic_1_8: 'balanced',
  heroic_1_9: 'balanced',
  heroic_1_10: 'balanced',
};

const SEEDS = [1, 2, 3];

/** Challenges are post-campaign content: §14.2 hands everything over by 1-10. */
function optionsFor(challenge: ChallengeDefinition): RulesetOptions {
  return { ...FULL_ROSTER, challengeId: challenge.id };
}

function worldFor(challenge: ChallengeDefinition, seed = 1): World {
  const stage = registry.stages.get(challenge.stageId);
  if (stage === undefined) throw new Error(`no stage ${challenge.stageId}`);
  return createWorldForStage(registry, stage, seed, optionsFor(challenge));
}

const all = [...registry.challenges.values()];
const heroic = all.filter((c) => c.kind === 'heroic');
const iron = all.filter((c) => c.kind === 'iron');
const endless = all.filter((c) => c.kind === 'endless');
const stageIds = [...registry.stages.keys()].sort();

describe('every stage carries its two challenge stars', () => {
  /* §12.4: 3 stars per difficulty × 3 modes, plus 2 challenge stars, is the
     eleven a stage is worth. Two challenges per map is where those two come
     from, so a map missing one is a star the player can never earn. */
  it.each(stageIds)('%s has one Heroic and one Iron', (stageId) => {
    expect(heroic.filter((c) => c.stageId === stageId)).toHaveLength(1);
    expect(iron.filter((c) => c.stageId === stageId)).toHaveLength(1);
  });

  /* Endless is the third variant and the one that pays no star: §13 puts it on
     a leaderboard rather than in the star count, so it is deliberately not
     part of the pair above. `tests/content/endless.test.ts` is where it is
     held to its own claims. */
  it.each(stageIds)('%s also has an Endless run, which earns no star', (stageId) => {
    expect(endless.filter((c) => c.stageId === stageId)).toHaveLength(1);
  });
});

describe('a challenge is a different game from the stage it is on', () => {
  /* A challenge whose constraints all default is a star for replaying the
     stage, which is not what §13 is buying. */
  it.each(all.map((c) => [c.id, c] as const))('%s constrains something', (_id, challenge) => {
    const { rules } = challenge;
    const constrained =
      rules.allowedTowers.length > 0 ||
      rules.allowedDamageTypes.length > 0 ||
      rules.startingTowers.length > 0 ||
      rules.startingGold !== undefined ||
      rules.lives !== undefined ||
      rules.waveLimit !== undefined ||
      rules.noSelling ||
      rules.noUpgrading ||
      rules.noRebuilding ||
      rules.enemyWardMultiplier !== 1 ||
      rules.enemyArmourMultiplier !== 1 ||
      rules.enemyHealthMultiplier !== 1;
    expect(constrained).toBe(true);
  });

  /* And the constraint has to reach the numbers, not merely be authored. */
  it.each(heroic.map((c) => [c.id, c] as const))('%s reaches the ruleset', (_id, challenge) => {
    const stage = registry.stages.get(challenge.stageId);
    if (stage === undefined) throw new Error('no stage');
    const plain = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    const under = worldFor(challenge);

    const differs =
      Array.from(under.rules.towers.unlocked).join() !==
        Array.from(plain.rules.towers.unlocked).join() ||
      Array.from(under.rules.enemies.ward).join() !== Array.from(plain.rules.enemies.ward).join() ||
      under.resources.gold !== plain.resources.gold ||
      under.rules.startingTowers.length > 0;
    expect(differs).toBe(true);
  });
});

describe('every Heroic challenge has a verified solution', () => {
  it.each(heroic.map((c) => [c.id, c] as const))('%s is winnable', (id, challenge) => {
    const name = SOLUTIONS[id];
    expect(name, `${id} has no recorded solution`).toBeDefined();

    const world = worldFor(challenge);
    const strategy = strategyByName(name as string, world);
    for (const seed of SEEDS) {
      const result = runOnce(world, strategy, seed);
      expect(result.won, `${id}: ${name} lost on seed ${seed} at wave ${result.wavesCleared}`).toBe(
        true,
      );
    }
  });
});

/**
 * Iron is the same sentence on every map, and it is deliberately not on the
 * solved list.
 *
 * "Survive fifteen waves with no rebuilding, no selling, and one life" means a
 * single leak ends the run, and none of the scripted boards reads a map well
 * enough to leak nothing — they are caricatures, and this is the one variant
 * built to punish exactly that. §13 calls it brutal and optional; what a test
 * can hold it to is that it is the same brutal thing everywhere and that the
 * simulation really does refuse what it forbids.
 */
describe('Iron is one rule, on every map', () => {
  it.each(iron.map((c) => [c.id, c] as const))('%s is the same sentence', (_id, challenge) => {
    expect(challenge.rules).toMatchObject({
      waveLimit: 15,
      lives: 1,
      noSelling: true,
      noRebuilding: true,
    });
  });

  it.each(iron.map((c) => [c.id, c] as const))('%s is fifteen waves and one life', (_id, c) => {
    const world = worldFor(c);
    expect(world.rules.waves.count).toBe(15);
    expect(world.resources.lives).toBe(1);
  });

  it('refuses a sale in a run that is actually being played', () => {
    const challenge = iron[0];
    if (challenge === undefined) throw new Error('no Iron challenge authored');
    const world = worldFor(challenge);

    const type = towerIndex(world, 'frost_cairn');
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage has no plots');
    buildTower(world.commands, plot.id, type);
    tick(world);

    let slot = -1;
    for (let i = 0; i < world.towers.watermark; i++) if (world.towers.isAlive(i)) slot = i;
    expect(slot).toBeGreaterThanOrEqual(0);

    sellTower(world.commands, slot);
    tick(world);
    expect(world.towers.isAlive(slot)).toBe(true);
  });
});
