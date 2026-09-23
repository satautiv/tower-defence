import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import type { ChallengeDefinition } from '@content/schema/challenge';
import { ChallengeSchema } from '@content/schema/challenge';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { Ruleset, RulesetOptions, World } from '@sim/index';
import {
  RejectReason,
  SimEventKind,
  buildRuleset,
  buildTower,
  createWorldForStage,
  sellTower,
  specialiseTower,
  tick,
  towerIndex,
  undoBuild,
  upgradeTower,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Challenge variants (#45, docs/GAME_DESIGN.md §13).
 *
 * The issue's whole claim is that a challenge is a rule the **simulation**
 * enforces, not a suggestion the build menu makes — a command can arrive from
 * a replay, from a test, or from the balance simulator's scripted player, and
 * all three have to meet the same refusal. So almost nothing here inspects the
 * ruleset: it dispatches the command a player would and reads what the world
 * did about it.
 *
 * The other half is the bargain every system in this project takes: a
 * challenge resolves into the flat tables once, and **no system knows a
 * challenge exists**. A banned tower is a zero in `towers.unlocked`, tripled
 * Ward is a bigger float, and three bits carry the three refusals.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

/** A challenge, authored through the real schema so its defaults apply. */
function challenge(rules: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return ChallengeSchema.parse({
    id: 'probe',
    stageId: '1-1',
    kind: 'heroic',
    nameKey: 'challenge.probe.name',
    descriptionKey: 'challenge.probe.desc',
    rules,
    ...over,
  });
}

/** The registry with one synthetic challenge added, as the game would load it. */
function withChallenge(definition: ChallengeDefinition): typeof registry {
  const challenges = new Map<string, ChallengeDefinition>(registry.challenges);
  challenges.set(definition.id, definition);
  return { ...registry, challenges };
}

function rulesFor(definition: ChallengeDefinition | null, over: RulesetOptions = {}): Ruleset {
  if (definition === null) return buildRuleset(registry, stage!, { ...FULL_ROSTER, ...over });
  return buildRuleset(withChallenge(definition), stage!, {
    ...FULL_ROSTER,
    challengeId: definition.id,
    ...over,
  });
}

function worldFor(definition: ChallengeDefinition, over: RulesetOptions = {}): World {
  return createWorldForStage(withChallenge(definition), stage!, 7, {
    ...FULL_ROSTER,
    challengeId: definition.id,
    ...over,
  });
}

function plainWorld(): World {
  return createWorldForStage(registry, stage!, 7, FULL_ROSTER);
}

const rejections = (world: World): number[] => {
  const out: number[] = [];
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.CommandRejected) out.push(event.b);
  }
  return out;
};

/** Builds through the command queue, returning the slot or -1. */
function build(world: World, id: string, plotId: number): number {
  buildTower(world.commands, plotId, towerIndex(world, id));
  tick(world);
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (world.towers.isAlive(slot) && world.towers.plotId[slot] === plotId) return slot;
  }
  return -1;
}

const liveTowers = (world: World): number => {
  let count = 0;
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (world.towers.isAlive(slot)) count++;
  }
  return count;
};

describe('a stage played without a challenge', () => {
  it('is exactly what it was', () => {
    const plain = rulesFor(null);
    expect(plain.challenge).toBeNull();
    expect(plain.restrictions).toBe(0);
    expect(plain.startingTowers).toEqual([]);
  });

  /* A saved run naming a challenge this build has retired should open on the
     plain stage rather than refuse to load, the same bargain an unknown
     difficulty takes. */
  it('is also what an unknown challenge id gets', () => {
    const unknown = buildRuleset(registry, stage!, { ...FULL_ROSTER, challengeId: 'gone' });
    expect(unknown.challenge).toBeNull();
    expect(unknown.restrictions).toBe(0);
  });
});

describe('the roster a challenge allows', () => {
  it('locks every tower it does not name', () => {
    const only = rulesFor(challenge({ allowedTowers: ['frost_cairn', 'arbalest_post'] }));
    only.towers.ids.forEach((id, i) => {
      const allowed = id === 'frost_cairn' || id === 'arbalest_post';
      expect(only.towers.unlocked[i], id).toBe(allowed ? 1 : 0);
    });
  });

  /* §13's own wording: "Only Cryo and Kinetic towers". */
  it('can be stated by damage type instead', () => {
    const elemental = rulesFor(challenge({ allowedDamageTypes: ['cryo', 'pyro'] }));
    const unlocked = elemental.towers.ids.filter(
      (_, i) => (elemental.towers.unlocked[i] as number) === 1,
    );
    expect([...unlocked].sort()).toEqual(['flame_vent', 'frost_cairn']);
  });

  /* Intersected, not replaced: "only Cryo, and the one Kinetic tower". */
  it('intersects the two lists rather than choosing between them', () => {
    const both = rulesFor(
      challenge({ allowedTowers: ['frost_cairn', 'flame_vent'], allowedDamageTypes: ['cryo'] }),
    );
    const unlocked = both.towers.ids.filter((_, i) => (both.towers.unlocked[i] as number) === 1);
    expect(unlocked).toEqual(['frost_cairn']);
  });

  /* The point of the whole issue. The menu is not the only way in. */
  it('refuses the build command, not merely the build menu', () => {
    const world = worldFor(challenge({ allowedTowers: ['frost_cairn'] }));
    const gold = world.resources.gold;

    expect(build(world, 'flame_vent', 0)).toBe(-1);
    expect(world.resources.gold).toBe(gold);

    expect(build(world, 'frost_cairn', 0)).toBeGreaterThanOrEqual(0);
    expect(world.resources.gold).toBeLessThan(gold);
  });

  /* A tower the challenge hands over must stay placeable, or the starting
     position could not be built in the first place. */
  it('keeps a starting tower buildable even when the list excludes it', () => {
    const rules = rulesFor(
      challenge({
        allowedTowers: ['frost_cairn'],
        startingTowers: [{ plotId: 0, tower: 'flame_vent' }],
      }),
    );
    const vent = rules.towers.indexOf.get('flame_vent') as number;
    expect(rules.towers.unlocked[vent]).toBe(1);
  });

  /* Talents are folded in first; a challenge's roster has the last word. */
  it('is not handed back by a talent that cheapened the banned tower', () => {
    const rules = rulesFor(challenge({ allowedTowers: ['frost_cairn'] }), {
      talents: { foundry_edge: 5 },
    });
    const vent = rules.towers.indexOf.get('flame_vent') as number;
    expect(rules.towers.unlocked[vent]).toBe(0);
  });
});

describe('enemies a challenge toughens', () => {
  it('multiplies ward, armour and health', () => {
    const plain = rulesFor(null);
    const hard = rulesFor(
      challenge({
        enemyWardMultiplier: 3,
        enemyArmourMultiplier: 2,
        enemyHealthMultiplier: 1.5,
      }),
    );

    const riftling = hard.enemies.indexOf.get('riftling') as number;
    expect(hard.enemies.ward[riftling]).toBeCloseTo(
      (plain.enemies.ward[riftling] as number) * 3,
      4,
    );
    expect(hard.enemies.hp[riftling]).toBeCloseTo((plain.enemies.hp[riftling] as number) * 1.5, 4);
  });

  /* Derived from armour at authoring time, so leaving it behind would quietly
     tell the player to flank a boss whose front had tripled. */
  it('takes rear armour with the front', () => {
    const plain = rulesFor(null);
    const hard = rulesFor(challenge({ enemyArmourMultiplier: 4 }));

    let checked = 0;
    plain.enemies.ids.forEach((_, i) => {
      const before = plain.enemies.rearArmour[i] as number;
      if (before <= 0) return;
      expect(hard.enemies.rearArmour[i]).toBeCloseTo(before * 4, 3);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('leaves them alone when the challenge says nothing', () => {
    const plain = rulesFor(null);
    const same = rulesFor(challenge({ noSelling: true }));
    expect(Array.from(same.enemies.ward)).toEqual(Array.from(plain.enemies.ward));
    expect(Array.from(same.enemies.hp)).toEqual(Array.from(plain.enemies.hp));
  });
});

describe('the position a challenge starts the player in', () => {
  it('replaces the stage gold rather than scaling it', () => {
    const broke = worldFor(challenge({ startingGold: 0 }), { difficulty: 'relaxed' });
    expect(broke.resources.gold).toBe(0);
  });

  it('replaces the mode lives', () => {
    const iron = worldFor(challenge({ lives: 1 }), { difficulty: 'relaxed' });
    expect(iron.resources.lives).toBe(1);
    expect(iron.config.lives).toBe(1);
  });

  it('builds the towers it hands over', () => {
    const world = worldFor(
      challenge({
        startingGold: 0,
        startingTowers: [
          { plotId: 0, tower: 'frost_cairn' },
          { plotId: 3, tower: 'flame_vent', tier: 2 },
        ],
      }),
    );

    expect(liveTowers(world)).toBe(2);
    const vent = [...Array(world.towers.watermark).keys()].find(
      (slot) => world.towers.isAlive(slot) && world.towers.plotId[slot] === 3,
    ) as number;
    expect(world.towers.tier[vent]).toBe(2);
    expect(world.resources.gold).toBe(0);
  });

  /* The results screen reports what the player did, not what they were given. */
  it('does not count a gift as a tower the player built', () => {
    const world = worldFor(challenge({ startingTowers: [{ plotId: 0, tower: 'frost_cairn' }] }));
    expect(world.stats.towersBuilt).toBe(0);

    build(world, 'frost_cairn', 1);
    expect(world.stats.towersBuilt).toBe(1);
  });

  /* A retry starts the challenge over, not the plain stage. */
  it('survives a restart', () => {
    const world = worldFor(challenge({ startingTowers: [{ plotId: 0, tower: 'frost_cairn' }] }));
    build(world, 'frost_cairn', 1);
    expect(liveTowers(world)).toBe(2);

    world.reset();
    expect(liveTowers(world)).toBe(1);
    expect(world.stats.towersBuilt).toBe(0);
    expect(world.towers.plotId[0]).toBe(0);
  });

  it('gives a plain stage none of it', () => {
    expect(liveTowers(plainWorld())).toBe(0);
  });
});

describe('what a challenge forbids', () => {
  it('refuses to sell', () => {
    const world = worldFor(challenge({ noSelling: true }));
    const slot = build(world, 'frost_cairn', 0);
    expect(slot).toBeGreaterThanOrEqual(0);

    const gold = world.resources.gold;
    sellTower(world.commands, slot);
    tick(world);

    expect(rejections(world)).toContain(RejectReason.ForbiddenByChallenge);
    expect(world.towers.isAlive(slot)).toBe(true);
    expect(world.resources.gold).toBe(gold);
  });

  it('refuses to upgrade, and to specialise', () => {
    const world = worldFor(challenge({ noUpgrading: true }));
    const slot = build(world, 'frost_cairn', 0);

    upgradeTower(world.commands, slot);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.ForbiddenByChallenge);
    expect(world.towers.tier[slot]).toBe(0);

    specialiseTower(world.commands, slot, 0);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.ForbiddenByChallenge);
    expect(world.towers.specialisation[slot]).toBe(-1);
  });

  /* Every placement is final. With selling already refused, nothing else in
     the game removes a tower, so the undo window is the last route to a plot
     that has been built on. */
  it('refuses to take a placement back', () => {
    const world = worldFor(challenge({ noSelling: true, noRebuilding: true }));
    const slot = build(world, 'frost_cairn', 0);
    const gold = world.resources.gold;

    undoBuild(world.commands);
    tick(world);

    expect(rejections(world)).toContain(RejectReason.ForbiddenByChallenge);
    expect(world.towers.isAlive(slot)).toBe(true);
    expect(world.resources.gold).toBe(gold);
  });

  it('forbids none of it on a plain stage', () => {
    const world = plainWorld();
    const slot = build(world, 'frost_cairn', 0);

    upgradeTower(world.commands, slot);
    tick(world);
    expect(world.towers.tier[slot]).toBe(1);

    sellTower(world.commands, slot);
    tick(world);
    expect(world.towers.isAlive(slot)).toBe(false);
    expect(rejections(world)).not.toContain(RejectReason.ForbiddenByChallenge);
  });
});

describe('a challenge that sets how many waves the run is', () => {
  const authored = stage!.waves.length;

  it('cuts a longer stage down', () => {
    const short = rulesFor(challenge({ waveLimit: 4 }));
    expect(short.waves.count).toBe(4);
  });

  it('lengthens a shorter one by repeating its own waves', () => {
    const long = rulesFor(challenge({ waveLimit: authored + 5 }));
    expect(long.waves.count).toBe(authored + 5);
  });

  /* The rule `wavesFor` already follows for Impossible's extra elite wave: a
     boss stage still ends on its boss. */
  it('leaves the stage ending on the wave it was built to end on', () => {
    const plain = rulesFor(null);
    const last = plain.waves.count - 1;

    for (const limit of [4, authored + 5]) {
      const limited = rulesFor(challenge({ waveLimit: limit }));
      const end = limited.waves.count - 1;
      expect(limited.waves.totalBounty[end]).toBe(plain.waves.totalBounty[last]);
      expect(limited.waves.groupCount[end]).toBe(plain.waves.groupCount[last]);
    }
  });

  /* Wave scaling is applied per wave *index* at spawn time, so a repeat is
     already a harder fight than the wave it copies. Nothing here arranges it,
     which is the point. */
  it('repeats the body rather than inventing content', () => {
    const long = rulesFor(challenge({ waveLimit: authored + 2 }));
    const plain = rulesFor(null);
    const bodies = new Set(
      Array.from(plain.waves.totalBounty.slice(0, plain.waves.count - 1)).map(Number),
    );
    for (let w = 0; w < long.waves.count - 1; w++) {
      expect(bodies.has(long.waves.totalBounty[w] as number)).toBe(true);
    }
  });

  it('tells the world how long the run is', () => {
    const world = worldFor(challenge({ waveLimit: 3 }));
    expect(world.config.totalWaves).toBe(3);
  });
});
