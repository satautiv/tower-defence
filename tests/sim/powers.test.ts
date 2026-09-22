import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { EFFECT_KINDS } from '@content/schema/common';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  STATUS_INDEX,
  SimEventKind,
  advance,
  applyStatus,
  castPower,
  createWorldForStage,
  effectiveDefence,
  enemyIndex,
  forceReaction,
  hashWorld,
  spawnEnemy,
  speedMultiplier,
  targetingSystem,
  tick,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Warden Powers and the primitives they are built from (#26).
 *
 * The acceptance criterion is a claim about the *architecture*: all five
 * powers, all sixteen tower capstones and all nine hero abilities compose from
 * only eight primitives, and if one does not, the answer is a new primitive
 * rather than a special case. That claim is testable, and most of this file
 * tests it.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

const powerIndex = (world: World, id: string): number => {
  const index = world.rules.powers.indexOf.get(id);
  if (index === undefined) throw new Error(`no power ${id}`);
  return index;
};

function pointAt(world: World, pathDistance: number): { x: number; y: number } {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);
  return { x: sample.x, y: sample.y };
}

/** An enemy on the road, held so a test can measure it where it put it. */
function enemyAt(world: World, pathDistance: number, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  const at = pointAt(world, pathDistance);

  world.enemies.pathDist[slot] = pathDistance;
  world.enemies.x[slot] = at.x;
  world.enemies.y[slot] = at.y;
  world.enemies.hp[slot] = 100_000;
  world.enemies.maxHp[slot] = 100_000;
  world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Blocked;
  return slot;
}

/** Casts with the aether paid for, since earning it is the economy's business. */
function cast(world: World, id: string, at: { x: number; y: number }): void {
  world.resources.aether = 100;
  targetingSystem(world);
  castPower(world.commands, powerIndex(world, id), at.x, at.y);
  tick(world);
}

const hpLost = (world: World, slot: number): number =>
  (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

describe('the roster of powers', () => {
  it('has all five the design names', () => {
    expect([...registry.powers.keys()].sort()).toEqual([
      'aether_siphon',
      'rally_banner',
      'rift_seal',
      'riftfall',
      'stasis_field',
    ]);
  });

  it.each([
    ['riftfall', 40, 12],
    ['stasis_field', 35, 20],
    ['rally_banner', 30, 18],
    ['aether_siphon', 50, 25],
    ['rift_seal', 60, 40],
  ])('costs and cools %s as the table says', (id, cost, cooldown) => {
    const power = registry.powers.get(id);
    expect(power?.cost).toBe(cost);
    expect(power?.cooldownSeconds).toBe(cooldown);
  });

  /**
   * The architectural claim, checked rather than asserted: everything composes
   * from the eight primitives. A power that needed a ninth would fail here,
   * which is the moment to add one deliberately.
   */
  it('builds every power, capstone and hero ability from the eight primitives', () => {
    const used = new Set<string>();

    const collect = (effects: ReadonlyArray<{ kind: string }>): void => {
      for (const effect of effects) used.add(effect.kind);
    };

    for (const power of registry.powers.values()) collect(power.effects);
    for (const tower of registry.towers.values()) {
      for (const spec of tower.specialisations) collect(spec.ability.effects);
    }
    for (const hero of registry.heroes.values()) {
      for (const ability of hero.abilities) collect(ability.effects);
    }

    for (const kind of used) {
      expect(EFFECT_KINDS, `${kind} is not a primitive`).toContain(kind);
    }
    expect(used.size).toBeGreaterThan(1);
  });
});

describe('casting', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('spends the aether it costs', () => {
    world.resources.aether = 100;
    castPower(world.commands, powerIndex(world, 'riftfall'), 500, 500);
    tick(world);
    expect(world.resources.aether).toBe(100 - 40);
  });

  it('refuses when the aether is not there', () => {
    world.resources.aether = 5;
    castPower(world.commands, powerIndex(world, 'riftfall'), 500, 500);
    tick(world);
    expect(world.resources.aether).toBe(5);
  });

  it('refuses a second cast while it is cooling', () => {
    cast(world, 'riftfall', pointAt(world, 400));
    const after = world.resources.aether;

    world.resources.aether = 100;
    castPower(world.commands, powerIndex(world, 'riftfall'), 500, 500);
    tick(world);
    expect(world.resources.aether).toBe(100);
    expect(after).toBeLessThan(100);
  });

  it('allows it once the cooldown has run', () => {
    cast(world, 'riftfall', pointAt(world, 400));
    advance(world, 12 * TICK_HZ + 2);

    world.resources.aether = 100;
    castPower(world.commands, powerIndex(world, 'riftfall'), 500, 500);
    tick(world);
    expect(world.resources.aether).toBe(60);
  });

  it('cools each power on its own clock', () => {
    cast(world, 'riftfall', pointAt(world, 400));

    world.resources.aether = 100;
    castPower(world.commands, powerIndex(world, 'rift_seal'), 500, 500);
    tick(world);
    /* Rift Seal costs 60 and was never cast, so its own cooldown is clear. */
    expect(world.resources.aether).toBe(40);
  });

  it('announces itself, for the effect and the sound', () => {
    cast(world, 'riftfall', pointAt(world, 400));

    let cast_ = 0;
    for (let i = 0; i < world.events.count; i++) {
      if (world.events.at(i).kind === SimEventKind.PowerCast) cast_++;
    }
    expect(cast_).toBe(1);
  });

  it('comes off cooldown on a restart', () => {
    cast(world, 'riftfall', pointAt(world, 400));
    expect(world.powerReadyTick[powerIndex(world, 'riftfall')]).toBeGreaterThan(0);

    world.reset();
    expect(world.powerReadyTick[powerIndex(world, 'riftfall')]).toBe(0);
  });
});

describe('Riftfall', () => {
  it('damages everything inside its radius', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    const enemy = enemyAt(world, 400);

    cast(world, 'riftfall', at);
    expect(hpLost(world, enemy)).toBeGreaterThan(0);
  });

  it('leaves what is outside it alone', () => {
    const world = freshWorld();
    const far = enemyAt(world, 400 + TILE_SIZE * 10);
    cast(world, 'riftfall', pointAt(world, 400));
    expect(hpLost(world, far)).toBe(0);
  });

  it('scorches what it hits', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);
    cast(world, 'riftfall', pointAt(world, 400));
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.scorch)).toBeGreaterThan(0);
  });
});

describe('Stasis Field', () => {
  it('slows what stands in it and chills it over time', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);

    cast(world, 'stasis_field', pointAt(world, 400));
    advance(world, 40);

    expect(speedMultiplier(world, enemy)).toBeLessThan(1);
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.chill)).toBeGreaterThan(0);
  });

  it('lets go when it lapses', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);

    cast(world, 'stasis_field', pointAt(world, 400));
    advance(world, 5 * TICK_HZ);
    /* The chill outlives the field, so speed is read once both have gone. */
    advance(world, 4 * TICK_HZ);
    expect(speedMultiplier(world, enemy)).toBeCloseTo(1, 5);
  });
});

describe('Rift Seal', () => {
  it('stops ground enemies where they stand', () => {
    const world = freshWorld();
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.pathDist[enemy] = 400;
    tick(world);

    world.resources.aether = 100;
    targetingSystem(world);
    castPower(
      world.commands,
      powerIndex(world, 'rift_seal'),
      world.enemies.x[enemy] as number,
      world.enemies.y[enemy] as number,
    );
    advance(world, 3);

    const held = world.enemies.pathDist[enemy] as number;
    advance(world, 30);
    expect(world.enemies.pathDist[enemy]).toBe(held);
  });

  it('opens the road again when it expires', () => {
    const world = freshWorld();
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.pathDist[enemy] = 400;
    tick(world);

    world.resources.aether = 100;
    targetingSystem(world);
    castPower(
      world.commands,
      powerIndex(world, 'rift_seal'),
      world.enemies.x[enemy] as number,
      world.enemies.y[enemy] as number,
    );
    advance(world, 5 * TICK_HZ + 10);

    const opened = world.enemies.pathDist[enemy] as number;
    advance(world, 30);
    expect(world.enemies.pathDist[enemy]).toBeGreaterThan(opened);
  });
});

describe('Rally Banner', () => {
  it('holds ground enemies near the banner', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked;

    cast(world, 'rally_banner', pointAt(world, 400));
    expect((world.enemies.flags[enemy] as number) & EnemyFlag.Blocked).not.toBe(0);
  });

  /* A banner is planted in the ground; a flyer is not standing on it. */
  it('does not hold a flyer', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400, 'rift_bat');
    world.enemies.flags[enemy] =
      ((world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked) | EnemyFlag.Flying;

    cast(world, 'rally_banner', pointAt(world, 400));
    expect((world.enemies.flags[enemy] as number) & EnemyFlag.Blocked).toBe(0);
  });
});

/**
 * Aether Siphon, and the criterion written specifically for it:
 *
 * > correctly forces every valid reaction in radius **simultaneously**,
 * > bypassing the per-enemy cooldown.
 */
describe('Aether Siphon', () => {
  let world: World;
  let at: { x: number; y: number };
  beforeEach(() => {
    world = freshWorld();
    at = pointAt(world, 400);
  });

  const primed = (pathDistance: number): number => {
    const slot = enemyAt(world, pathDistance);
    applyStatus(world, slot, STATUS_INDEX.scorch, 3);
    applyStatus(world, slot, STATUS_INDEX.chill, 1);
    return slot;
  };

  it('detonates a primed enemy', () => {
    const enemy = primed(400);
    const before = world.stats.reactionsTriggered;

    cast(world, 'aether_siphon', at);
    expect(world.stats.reactionsTriggered).toBeGreaterThan(before);
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.scorch)).toBe(0);
  });

  it('detonates every primed enemy in radius at once', () => {
    const enemies = [400, 408, 416, 424].map(primed);
    cast(world, 'aether_siphon', at);

    for (const enemy of enemies) {
      expect(world.enemies.stacksOf(enemy, STATUS_INDEX.scorch)).toBe(0);
    }
    expect(world.stats.reactionsTriggered).toBeGreaterThanOrEqual(enemies.length);
  });

  /* The bypass is the whole power. Without it the Siphon would do nothing to
     anything that had just reacted, which is most of a busy board. */
  it('ignores a per-enemy cooldown that would otherwise refuse', () => {
    const enemy = primed(400);
    /* Locked out well into the future. */
    world.enemies.reactionReadyTick[enemy] = world.tick + 10_000;

    cast(world, 'aether_siphon', at);
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.scorch)).toBe(0);
  });

  it('leaves an enemy with nothing to detonate alone', () => {
    const enemy = enemyAt(world, 400);
    applyStatus(world, enemy, STATUS_INDEX.scorch, 3);
    const before = world.stats.reactionsTriggered;

    cast(world, 'aether_siphon', at);
    /* One status is not a pair. */
    expect(world.stats.reactionsTriggered).toBe(before);
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.scorch)).toBe(3);
  });

  /**
   * Both are locked out of reacting on their own, so the only thing that can
   * detonate either is the Siphon's bypass — which makes this a test of the
   * radius rather than of the ordinary reaction system firing anyway.
   *
   * The far one is found by distance rather than assumed: stage 1-1's path
   * doubles back on itself, so a point far along it can be close in pixels,
   * which is the whole reason the blocking window exists elsewhere.
   */
  it('does not reach past its radius', () => {
    const near = primed(400);

    let farDistance = -1;
    for (let d = 400; d < (world.rules.paths[0]?.totalLength ?? 0); d += 32) {
      const point = pointAt(world, d);
      if (Math.hypot(point.x - at.x, point.y - at.y) > TILE_SIZE * 8) {
        farDistance = d;
        break;
      }
    }
    expect(farDistance).toBeGreaterThan(0);
    const far = primed(farDistance);

    for (const enemy of [near, far]) {
      world.enemies.reactionReadyTick[enemy] = world.tick + 10_000;
    }

    cast(world, 'aether_siphon', at);
    expect(world.enemies.stacksOf(near, STATUS_INDEX.scorch)).toBe(0);
    expect(world.enemies.stacksOf(far, STATUS_INDEX.scorch)).toBeGreaterThan(0);
  });
});

describe('forceReaction', () => {
  it('reports whether there was anything to detonate', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);
    expect(forceReaction(world, enemy, true)).toBe(false);

    applyStatus(world, enemy, STATUS_INDEX.scorch, 2);
    applyStatus(world, enemy, STATUS_INDEX.chill, 1);
    expect(forceReaction(world, enemy, true)).toBe(true);
  });

  it('still respects the cooldown when not told to ignore it', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);
    applyStatus(world, enemy, STATUS_INDEX.scorch, 2);
    applyStatus(world, enemy, STATUS_INDEX.chill, 1);
    world.enemies.reactionReadyTick[enemy] = world.tick + 500;

    expect(forceReaction(world, enemy, false)).toBe(false);
    expect(forceReaction(world, enemy, true)).toBe(true);
  });
});

describe('modify_stat softens defences', () => {
  /* Kaelen's ward-stripping ability, and the shape every defence-softening
     effect uses — the same generic multiplier a Superconduct sets, so the
     damage formula never learns which effect did it. */
  it('applies the generic defence multiplier the damage formula already reads', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 400);
    world.enemies.armour[enemy] = 100;

    const before = effectiveDefence(world, enemy, true, 0, 0, 0);
    world.enemies.defenceMultiplier[enemy] = 0.4;
    world.enemies.defenceMultiplierUntil[enemy] = world.tick + 300;

    expect(effectiveDefence(world, enemy, true, 0, 0, 0)).toBeCloseTo(before * 0.4, 3);
  });
});

describe('powers are deterministic', () => {
  function run(seed: number): string {
    const world = freshWorld(seed);
    for (let i = 0; i < 10; i++) {
      const slot = enemyAt(world, 300 + i * 30);
      applyStatus(world, slot, STATUS_INDEX.scorch, 3);
      applyStatus(world, slot, STATUS_INDEX.chill, 2);
    }
    cast(world, 'aether_siphon', pointAt(world, 400));
    advance(world, 240);
    return hashWorld(world);
  }

  it('produces an identical world from an identical cast', () => {
    expect(run(21)).toBe(run(21));
  });
});
