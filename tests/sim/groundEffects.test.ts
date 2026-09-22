import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  EnemyFlag,
  STATUS_INDEX,
  advance,
  createGroundEffect,
  createWorldForStage,
  enemyIndex,
  groundEffectSystem,
  hashWorld,
  spawnEnemy,
  speedMultiplier,
  targetingSystem,
  tick,
  useInteractable,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Lingering ground (#31): pools, fields, lava and the map's one-shot lever.
 *
 * One pool for all of them, because they differ only in payload — a Firestorm
 * Cannon's burning pool and a region's lava channel are the same object with
 * different numbers.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

/**
 * An enemy at a given distance along the path, with its position resolved.
 *
 * Placed by path distance rather than by pixel: the movement system derives x
 * and y from `pathDist` every tick, so a hand-placed enemy is teleported back
 * onto the road the moment the world advances, and an effect laid where it was
 * standing would then cover nothing.
 */
function enemyAt(world: World, pathDistance: number, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  const at = pointAt(world, pathDistance);

  world.enemies.pathDist[slot] = pathDistance;
  world.enemies.x[slot] = at.x;
  world.enemies.y[slot] = at.y;
  world.enemies.hp[slot] = 100_000;
  world.enemies.maxHp[slot] = 100_000;
  /* Held, so it stays where the test put it instead of walking out of the
     effect while the test is measuring it. */
  world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Blocked;
  return slot;
}

function pointAt(world: World, pathDistance: number): { x: number; y: number } {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);
  return { x: sample.x, y: sample.y };
}

/** Effects query the spatial index, so a hand-placed enemy must be in it. */
function step(world: World): void {
  targetingSystem(world);
  groundEffectSystem(world);
}

const hpLost = (world: World, slot: number): number =>
  (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

describe('an effect acts on what stands in it', () => {
  let world: World;
  let enemy: number;
  let here: { x: number; y: number };
  beforeEach(() => {
    world = freshWorld();
    enemy = enemyAt(world, 400);
    here = pointAt(world, 400);
  });

  it('burns what is inside its radius', () => {
    createGroundEffect(world, {
      ...here,
      radiusTiles: 2,
      seconds: 5,
      damagePerSecond: 30,
      damageType: DAMAGE_INDEX.pyro,
    });

    advance(world, TICK_HZ);
    expect(hpLost(world, enemy)).toBeGreaterThan(0);
  });

  it('leaves what is outside it alone', () => {
    const far = enemyAt(world, 400 + TILE_SIZE * 6);
    createGroundEffect(world, {
      ...here,
      radiusTiles: 2,
      seconds: 5,
      damagePerSecond: 30,
      damageType: DAMAGE_INDEX.pyro,
    });

    advance(world, TICK_HZ);
    expect(hpLost(world, far)).toBe(0);
  });

  it('applies the status it carries', () => {
    createGroundEffect(world, {
      ...here,
      radiusTiles: 2,
      seconds: 5,
      statusId: STATUS_INDEX.scorch,
      statusStacks: 2,
    });

    advance(world, 30);
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.scorch)).toBeGreaterThan(0);
  });

  /* Through the shared queue, so a pool's kill pays bounty and splits a
     splitter exactly as a tower's shot does. */
  it('pays its damage into the shared queue rather than straight to health', () => {
    createGroundEffect(world, {
      ...here,
      radiusTiles: 2,
      seconds: 5,
      damagePerSecond: 60,
      damageType: DAMAGE_INDEX.pyro,
      intervalSeconds: 0.1,
    });

    step(world);
    expect(world.damage.count).toBeGreaterThan(0);
    expect(hpLost(world, enemy)).toBe(0);
  });

  it('does not burn a corpse', () => {
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) | EnemyFlag.Dying;
    createGroundEffect(world, {
      ...here,
      radiusTiles: 2,
      seconds: 5,
      damagePerSecond: 60,
      damageType: DAMAGE_INDEX.pyro,
      intervalSeconds: 0.1,
    });

    step(world);
    expect(world.damage.count).toBe(0);
  });

  it('applies at the authored rate rather than every tick', () => {
    createGroundEffect(world, {
      ...here,
      radiusTiles: 2,
      seconds: 10,
      damagePerSecond: 60,
      damageType: DAMAGE_INDEX.pyro,
      intervalSeconds: 1,
    });

    let applications = 0;
    for (let i = 0; i < TICK_HZ * 3; i++) {
      targetingSystem(world);
      groundEffectSystem(world);
      applications += world.damage.count;
      world.damage.clear();
      world.tick++;
    }
    /* Three seconds at one application a second. */
    expect(applications).toBeLessThanOrEqual(4);
    expect(applications).toBeGreaterThanOrEqual(3);
  });
});

describe('slowing ground', () => {
  let world: World;
  let enemy: number;
  let here: { x: number; y: number };
  beforeEach(() => {
    world = freshWorld();
    enemy = enemyAt(world, 400);
    here = pointAt(world, 400);
  });

  it('slows what is standing in it', () => {
    createGroundEffect(world, { ...here, radiusTiles: 2, seconds: 5, slowMultiplier: 0.25 });
    step(world);
    expect(speedMultiplier(world, enemy)).toBeCloseTo(0.25, 5);
  });

  /**
   * Stacking is decided rather than left to accumulate. Three pools that each
   * halve speed leave an enemy at half, not at an eighth — a player should
   * never be able to stand a wave completely still by layering fields.
   */
  it('takes the strongest rather than multiplying overlapping fields', () => {
    for (const slow of [0.5, 0.5, 0.5]) {
      createGroundEffect(world, { ...here, radiusTiles: 2, seconds: 5, slowMultiplier: slow });
    }
    step(world);
    expect(speedMultiplier(world, enemy)).toBeCloseTo(0.5, 5);
  });

  it('stops slowing the moment the enemy walks out', () => {
    createGroundEffect(world, { ...here, radiusTiles: 2, seconds: 20, slowMultiplier: 0.25 });
    step(world);
    expect(speedMultiplier(world, enemy)).toBeCloseTo(0.25, 5);

    world.enemies.x[enemy] = (here.x as number) + TILE_SIZE * 8;
    step(world);
    expect(speedMultiplier(world, enemy)).toBeCloseTo(1, 5);
  });

  /* Ground and status slows are different kinds of thing, so they compound:
     a Stasis Field is the answer when Chill alone is not enough. */
  it('compounds with a status slow rather than sharing its cap', () => {
    world.enemies.statusStacks[enemy * 7 + STATUS_INDEX.chill] = 2;
    world.enemies.statusExpiry[enemy * 7 + STATUS_INDEX.chill] = 100_000;
    createGroundEffect(world, { ...here, radiusTiles: 2, seconds: 5, slowMultiplier: 0.5 });

    step(world);
    const chillOnly = 1 - 0.12 * 2;
    expect(speedMultiplier(world, enemy)).toBeCloseTo(chillOnly * 0.5, 4);
  });
});

describe('blocking ground', () => {
  it('holds an enemy where it stands', () => {
    const world = freshWorld();
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.pathDist[enemy] = 400;

    tick(world);
    const moved = world.enemies.pathDist[enemy] as number;
    createGroundEffect(world, {
      x: world.enemies.x[enemy] as number,
      y: world.enemies.y[enemy] as number,
      radiusTiles: 2,
      seconds: 10,
      blocks: true,
    });

    /* Movement is step 4 and ground is step 10, so the enemy takes one more
       step before the ground it is standing on is known to hold it. After
       that it does not move again. */
    advance(world, 1);
    const held = world.enemies.pathDist[enemy] as number;
    expect(held).toBeGreaterThanOrEqual(moved);

    advance(world, 30);
    expect(world.enemies.pathDist[enemy]).toBe(held);
  });

  it('lets it go once the ground clears', () => {
    const world = freshWorld();
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.pathDist[enemy] = 400;
    tick(world);

    createGroundEffect(world, {
      x: world.enemies.x[enemy] as number,
      y: world.enemies.y[enemy] as number,
      radiusTiles: 2,
      seconds: 0.5,
      blocks: true,
    });

    advance(world, 60);
    const held = world.enemies.pathDist[enemy] as number;
    advance(world, 30);
    expect(world.enemies.pathDist[enemy]).toBeGreaterThan(held);
  });
});

describe('effects expire cleanly', () => {
  it('frees its slot when its time is up', () => {
    const world = freshWorld();
    createGroundEffect(world, { x: 500, y: 500, radiusTiles: 2, seconds: 1 });
    expect(world.groundEffects.count).toBe(1);

    advance(world, TICK_HZ + 2);
    expect(world.groundEffects.count).toBe(0);
  });

  it('stops acting once it has', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);
    createGroundEffect(world, {
      ...pointAt(world, 400),
      radiusTiles: 2,
      seconds: 1,
      slowMultiplier: 0.25,
    });

    advance(world, TICK_HZ + 2);
    expect(speedMultiplier(world, enemy)).toBeCloseTo(1, 5);
  });

  /* Thirty at once is the budget's worst case, and they must all retire. */
  it('handles thirty at once and leaves nothing behind', () => {
    const world = freshWorld();
    for (let i = 0; i < 30; i++) {
      const at = pointAt(world, 200 + i * 40);
      enemyAt(world, 200 + i * 40);
      createGroundEffect(world, {
        ...at,
        radiusTiles: 1.5,
        seconds: 2,
        damagePerSecond: 20,
        damageType: DAMAGE_INDEX.pyro,
        slowMultiplier: 0.6,
      });
    }
    expect(world.groundEffects.count).toBe(30);

    const watermark = world.groundEffects.watermark;
    advance(world, TICK_HZ * 3);

    expect(world.groundEffects.count).toBe(0);
    expect(world.groundEffects.watermark).toBe(watermark);
    expect(world.damage.dropped).toBe(0);
  });

  it('drops an effect rather than growing the pool', () => {
    const world = freshWorld();
    let made = 0;
    for (let i = 0; i < 200; i++) {
      if (createGroundEffect(world, { x: 500, y: 500, radiusTiles: 1, seconds: 5 }) >= 0) made++;
    }
    expect(made).toBeLessThan(200);
    expect(world.groundEffects.count).toBe(made);
  });
});

describe('the map lever', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  const lever = registry.stages.get('1-1')?.interactable;

  it('is authored on stage 1-1', () => {
    expect(lever).toBeDefined();
    expect(world.rules.interactable).not.toBeNull();
  });

  it('charges its cost and lays its ground', () => {
    const before = world.resources.gold;
    useInteractable(world.commands, 0);
    tick(world);

    expect(world.resources.gold).toBe(before - (lever?.cost ?? 0));
    expect(world.groundEffects.count).toBe(1);
  });

  /* One per stage and one use per run: that is what makes it a decision
     rather than a rotation (docs/GAME_DESIGN.md §5). */
  it('fires once and refuses a second pull', () => {
    useInteractable(world.commands, 0);
    tick(world);
    const afterFirst = world.resources.gold;

    useInteractable(world.commands, 0);
    tick(world);

    expect(world.resources.gold).toBe(afterFirst);
    expect(world.groundEffects.count).toBe(1);
  });

  it('refuses when it cannot be paid for', () => {
    world.resources.gold = 0;
    useInteractable(world.commands, 0);
    tick(world);

    expect(world.groundEffects.count).toBe(0);
    expect(world.interactableUsed).toBe(false);
  });

  it('comes back on a restart, like everything else', () => {
    useInteractable(world.commands, 0);
    tick(world);
    expect(world.interactableUsed).toBe(true);

    world.reset();
    expect(world.interactableUsed).toBe(false);
    expect(world.groundEffects.count).toBe(0);
  });
});

describe('ground effects are deterministic', () => {
  function run(seed: number): string {
    const world = freshWorld(seed);
    for (let i = 0; i < 12; i++) {
      const at = pointAt(world, 200 + i * 48);
      enemyAt(world, 200 + i * 48);
      createGroundEffect(world, {
        ...at,
        radiusTiles: 1.5,
        seconds: 4,
        damagePerSecond: 25,
        damageType: DAMAGE_INDEX.toxic,
        statusId: STATUS_INDEX.corrode,
        statusStacks: 1,
        slowMultiplier: 0.5,
      });
    }
    advance(world, 300);
    return hashWorld(world);
  }

  it('produces an identical world from an identical run', () => {
    expect(run(11)).toBe(run(11));
  });

  it('runs the same at 3x as at 1x', () => {
    const slow = freshWorld(2);
    const fast = freshWorld(2);
    for (const world of [slow, fast]) {
      enemyAt(world, 400);
      createGroundEffect(world, {
        ...pointAt(world, 400),
        radiusTiles: 2,
        seconds: 6,
        damagePerSecond: 40,
        damageType: DAMAGE_INDEX.pyro,
        slowMultiplier: 0.5,
      });
    }

    for (let i = 0; i < 180; i++) advance(slow, 1);
    for (let i = 0; i < 60; i++) advance(fast, 3);

    expect(fast.tick).toBe(slow.tick);
    expect(hashWorld(fast)).toBe(hashWorld(slow));
  });
});
