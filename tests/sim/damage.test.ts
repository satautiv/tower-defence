import { beforeEach, describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  DamageFlag,
  EnemyFlag,
  STATUS_COUNT,
  STATUS_INDEX,
  SimEventKind,
  createWorldForStage,
  damageResolutionSystem,
  effectiveDefence,
  enemyIndex,
  spawnEnemy,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');
const tuning = registry.tuning;

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

function enemy(world: World, id = 'husk'): number {
  return spawnEnemy(world, enemyIndex(world, id), 0);
}

const setStatus = (world: World, slot: number, status: number, stacks: number): void => {
  world.enemies.statusStacks[slot * STATUS_COUNT + status] = stacks;
};

/** The formula from docs/GAME_DESIGN.md §7.1, written out independently. */
function expectedDamage(
  base: number,
  defence: number,
  unravel = 0,
  fracture = 0,
  kinetic = true,
): number {
  const capped = Math.min(Math.max(defence, 0), tuning.defenceCap);
  let damage = base * (1 - capped / (capped + tuning.defenceHalfPoint));
  damage *= 1 + registry.statuses.get('unravel')!.vulnerabilityPerStack * unravel;
  if (kinetic) damage *= 1 + registry.statuses.get('fracture')!.vulnerabilityPerStack * fracture;
  return damage;
}

const hpLost = (world: World, slot: number): number =>
  (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

describe('the damage formula', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = enemy(world);
    world.enemies.armour[slot] = 0;
    world.enemies.ward[slot] = 0;
    world.enemies.hp[slot] = 10_000;
    world.enemies.maxHp[slot] = 10_000;
  });

  it('applies full damage with no defence', () => {
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(100, 4);
  });

  /* The half point is what makes armour a value judgement rather than a wall. */
  it('halves damage at the authored half point', () => {
    world.enemies.armour[slot] = tuning.defenceHalfPoint;
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(50, 4);
  });

  it.each([0, 10, 25, 50, 100, 200, 500])('matches the formula at armour %i', (armour) => {
    world.enemies.armour[slot] = armour;
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(expectedDamage(100, armour), 3);
  });

  /* No enemy is ever immune to a damage type, however armoured. */
  it('never reduces damage to zero, however much armour is stacked', () => {
    world.enemies.armour[slot] = 100_000;
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeGreaterThan(0);
  });

  it('caps effective defence, so the best case reduction is bounded', () => {
    world.enemies.armour[slot] = 100_000;
    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBe(tuning.defenceCap);
  });

  it.each([
    ['pyro', false],
    ['cryo', false],
    ['volt', false],
    ['toxic', false],
    ['arcane', false],
  ])('reduces %s by ward, not armour', (type, _kinetic) => {
    world.enemies.armour[slot] = 200;
    world.enemies.ward[slot] = 0;
    world.damage.push(slot, 100, DAMAGE_INDEX[type as 'pyro'], -1);
    damageResolutionSystem(world);
    /* Heavy armour, no ward: an elemental hit lands in full. */
    expect(hpLost(world, slot)).toBeCloseTo(100, 3);
  });

  it('reduces kinetic by armour, not ward', () => {
    world.enemies.ward[slot] = 200;
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(100, 3);
  });

  it('ignores both for true damage', () => {
    world.enemies.armour[slot] = 200;
    world.enemies.ward[slot] = 200;
    world.damage.push(slot, 100, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(100, 4);
  });
});

describe('statuses change what a hit is worth', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = enemy(world);
    world.enemies.hp[slot] = 10_000;
    world.enemies.maxHp[slot] = 10_000;
    world.enemies.armour[slot] = 0;
    world.enemies.ward[slot] = 0;
  });

  it.each([1, 3, 5])('amplifies everything by %i unravel stacks', (stacks) => {
    setStatus(world, slot, STATUS_INDEX.unravel, stacks);
    world.damage.push(slot, 100, DAMAGE_INDEX.arcane, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(expectedDamage(100, 0, stacks, 0, false), 3);
  });

  it.each([1, 5, 10])('amplifies kinetic by %i fracture stacks', (stacks) => {
    setStatus(world, slot, STATUS_INDEX.fracture, stacks);
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(expectedDamage(100, 0, 0, stacks), 3);
  });

  /* Fracture is the physical-only lane, which is what keeps a pure-Kinetic
     board scaling without touching the reaction economy. */
  it('does not let fracture amplify an elemental hit', () => {
    setStatus(world, slot, STATUS_INDEX.fracture, 10);
    world.damage.push(slot, 100, DAMAGE_INDEX.pyro, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(100, 3);
  });

  it.each([1, 3, 5])('lets %i corrode stacks eat armour and ward alike', (stacks) => {
    const perStack = registry.statuses.get('corrode')!.defenceReductionPerStack;
    world.enemies.armour[slot] = 100;
    setStatus(world, slot, STATUS_INDEX.corrode, stacks);

    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(100 - stacks * perStack, 4);
  });

  it('subtracts armour pierce only from armour', () => {
    world.enemies.armour[slot] = 100;
    world.enemies.ward[slot] = 100;
    expect(effectiveDefence(world, slot, true, 40, 0, 0)).toBeCloseTo(60, 4);
    expect(effectiveDefence(world, slot, false, 40, 0, 0)).toBeCloseTo(100, 4);
  });

  it('applies a temporary defence multiplier, which is what a Superconduct sets', () => {
    world.enemies.armour[slot] = 100;
    world.enemies.defenceMultiplier[slot] = 0.4;
    world.enemies.defenceMultiplierUntil[slot] = world.tick + 300;
    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(40, 4);
  });

  it('lets the multiplier lapse', () => {
    world.enemies.armour[slot] = 100;
    world.enemies.defenceMultiplier[slot] = 0.4;
    world.enemies.defenceMultiplierUntil[slot] = world.tick;
    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(100, 4);
  });

  it('shatters a frozen target struck hard enough, and thaws it', () => {
    setStatus(world, slot, STATUS_INDEX.freeze, 1);
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1, DamageFlag.CanShatter);
    damageResolutionSystem(world);

    expect(hpLost(world, slot)).toBeCloseTo(100 * tuning.shatterMultiplier, 3);
    expect(world.enemies.stacksOf(slot, STATUS_INDEX.freeze)).toBe(0);
  });

  it('does not shatter on a chip below the threshold', () => {
    setStatus(world, slot, STATUS_INDEX.freeze, 1);
    world.damage.push(slot, 1, DAMAGE_INDEX.kinetic, -1, DamageFlag.CanShatter);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(1, 4);
  });
});

describe('overshield', () => {
  it('absorbs before health, so chip damage is the wrong answer', () => {
    const world = freshWorld();
    const slot = enemy(world);
    world.enemies.overshield[slot] = 120;

    world.damage.push(slot, 50, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);

    expect(world.enemies.overshield[slot]).toBeCloseTo(70, 4);
    expect(hpLost(world, slot)).toBe(0);
  });

  it('spills through to health once broken', () => {
    const world = freshWorld();
    const slot = enemy(world);
    world.enemies.hp[slot] = 1000;
    world.enemies.maxHp[slot] = 1000;
    world.enemies.overshield[slot] = 30;
    world.enemies.armour[slot] = 0;

    world.damage.push(slot, 100, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);

    expect(world.enemies.overshield[slot]).toBe(0);
    expect(hpLost(world, slot)).toBeCloseTo(70, 4);
  });
});

describe('directional armour', () => {
  it('is far softer from behind, which is what makes a rear plot worth having', () => {
    const world = freshWorld();
    const slot = enemy(world);
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.DirectionalArmour;
    world.enemies.armour[slot] = 60;
    world.enemies.x[slot] = 0;
    world.enemies.y[slot] = 0;
    /* Facing along +x. */
    world.enemies.facing[slot] = 0;
    world.rules.enemies.rearArmour[world.enemies.typeIdx[slot] as number] = 10;

    const front = effectiveDefence(world, slot, true, 0, 100, 0);
    const rear = effectiveDefence(world, slot, true, 0, -100, 0);
    expect(front).toBeCloseTo(60, 4);
    expect(rear).toBeCloseTo(10, 4);
  });
});

describe('evasion', () => {
  it('only dodges projectiles; beams and burns always land', () => {
    const world = freshWorld();
    const slot = enemy(world);
    world.rules.enemies.evasion[world.enemies.typeIdx[slot] as number] = 1;

    world.damage.push(slot, 50, DAMAGE_INDEX.true, -1, DamageFlag.Evadable);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBe(0);

    world.damage.push(slot, 50, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeCloseTo(50, 4);
  });

  it('is seeded, so a dodge is part of the replay', () => {
    const run = (): number => {
      const world = freshWorld(99);
      const slot = enemy(world);
      world.enemies.hp[slot] = 100_000;
      world.rules.enemies.evasion[world.enemies.typeIdx[slot] as number] = 0.5;
      for (let i = 0; i < 200; i++) {
        world.damage.push(slot, 10, DAMAGE_INDEX.true, -1, DamageFlag.Evadable);
        damageResolutionSystem(world);
      }
      return hpLost(world, slot);
    };
    expect(run()).toBe(run());
  });
});

describe('deaths resolve after the whole queue drains', () => {
  /* The acceptance criterion: the payout cannot depend on which system fired
     first, so five hits in one tick kill once and pay one bounty. */
  it('pays one bounty however many sources landed the killing tick', () => {
    const world = freshWorld();
    const slot = enemy(world);
    const bounty = world.rules.enemies.bounty[world.enemies.typeIdx[slot] as number] as number;
    const gold = world.resources.gold;

    for (let i = 0; i < 5; i++) world.damage.push(slot, 1000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);

    expect(world.resources.gold - gold).toBe(bounty);
    expect(world.enemies.isAlive(slot)).toBe(false);
  });

  it('gives the same result whichever order the sources fired in', () => {
    const run = (order: number[]): number => {
      const world = freshWorld();
      const slot = enemy(world);
      world.enemies.hp[slot] = 10_000;
      world.enemies.maxHp[slot] = 10_000;
      world.enemies.armour[slot] = 30;
      for (const amount of order) world.damage.push(slot, amount, DAMAGE_INDEX.kinetic, -1);
      damageResolutionSystem(world);
      return hpLost(world, slot);
    };

    expect(run([10, 20, 30, 40])).toBeCloseTo(run([40, 30, 20, 10]), 6);
  });

  it('never lets a second hit land on something already dying', () => {
    const world = freshWorld();
    const slot = enemy(world);
    const id = world.enemies.ids[slot] as number;

    world.damage.push(slot, 10_000, DAMAGE_INDEX.true, -1);
    world.damage.push(slot, 10_000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);

    let died = 0;
    let hits = 0;
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind === SimEventKind.EnemyDied && event.a === id) died++;
      if (event.kind === SimEventKind.DamageDealt && event.a === id) hits++;
    }
    expect(died).toBe(1);
    expect(hits).toBe(1);
  });

  it('cannot hit a freed slot', () => {
    const world = freshWorld();
    const slot = enemy(world);
    world.enemies.free(slot);

    world.damage.push(slot, 100, DAMAGE_INDEX.true, -1);
    expect(() => damageResolutionSystem(world)).not.toThrow();
    expect(world.enemies.isAlive(slot)).toBe(false);
  });

  it('charges Aether on a kill, capped', () => {
    const world = freshWorld();
    world.resources.aether = tuning.aetherMax - 0.5;
    const slot = enemy(world);

    world.damage.push(slot, 10_000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    expect(world.resources.aether).toBe(tuning.aetherMax);
  });

  it('announces the death with what killed it, for the death animation', () => {
    const world = freshWorld();
    const slot = enemy(world);
    world.damage.push(slot, 10_000, DAMAGE_INDEX.pyro, -1);
    damageResolutionSystem(world);

    let found = false;
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind === SimEventKind.EnemyDied) {
        expect(event.d).toBe(DAMAGE_INDEX.pyro);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe('splitters', () => {
  const kill = (world: World, slot: number): void => {
    world.damage.push(slot, 100_000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
  };

  it('becomes its children on death', () => {
    const world = freshWorld();
    const mother = enemy(world, 'chitin_mother');
    kill(world, mother);

    expect(world.enemies.count).toBe(2);
    const broodling = enemyIndex(world, 'broodling');
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.isAlive(slot)) expect(world.enemies.typeIdx[slot]).toBe(broodling);
    }
  });

  /* The acceptance criterion: children appear exactly where the parent fell,
     not back at the spawn point. */
  it('places children at the parent path distance', () => {
    const world = freshWorld();
    const mother = enemy(world, 'chitin_mother');
    world.enemies.pathDist[mother] = 777.5;
    kill(world, mother);

    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.isAlive(slot)) expect(world.enemies.pathDist[slot]).toBeCloseTo(777.5, 4);
    }
  });

  it('gives children the parent wave, so the wave still knows to wait for them', () => {
    const world = freshWorld();
    const mother = enemy(world, 'chitin_mother');
    world.enemies.waveIndex[mother] = 4;
    kill(world, mother);

    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.isAlive(slot)) expect(world.enemies.waveIndex[slot]).toBe(4);
    }
  });

  /* Splitting must not consume the random stream, or a splitter dying would
     change what happens everywhere else on the board. */
  it('is deterministic and does not disturb the random stream', () => {
    const run = (): [number, number[]] => {
      const world = freshWorld(2026);
      const mother = enemy(world, 'chitin_mother');
      world.enemies.pathDist[mother] = 400;
      kill(world, mother);
      const offsets: number[] = [];
      for (let slot = 0; slot < world.enemies.watermark; slot++) {
        if (world.enemies.isAlive(slot)) offsets.push(world.enemies.laneOffset[slot] as number);
      }
      return [world.rng.getState(), offsets];
    };

    const [stateA, offsetsA] = run();
    const [stateB, offsetsB] = run();
    expect(stateB).toBe(stateA);
    expect(offsetsB).toEqual(offsetsA);
  });

  it('does not split an ordinary enemy', () => {
    const world = freshWorld();
    kill(world, enemy(world, 'husk'));
    expect(world.enemies.count).toBe(0);
  });
});
