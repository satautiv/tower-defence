import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  STATUS_INDEX,
  STATUS_COUNT,
  advance,
  createWorldForStage,
  enemyIndex,
  movementSystem,
  spawnEnemy,
  speedMultiplier,
} from '@sim/index';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

/**
 * Pins a status on, out of reach of expiry.
 *
 * These tests are about what a slow does to movement, not about how long it
 * lasts — that is tests/sim/status.test.ts. Without a deadline the status
 * system would age it away on the first tick and every distance below would be
 * measured on an enemy that is no longer chilled.
 *
 * The deadline is the largest int32, because `statusExpiry` is an Int32Array
 * and MAX_SAFE_INTEGER stores as -1 there — which reads as long expired.
 */
const FOREVER = 0x7fffffff;

const setStatus = (world: World, slot: number, status: number, stacks: number): void => {
  world.enemies.statusStacks[slot * STATUS_COUNT + status] = stacks;
  world.enemies.statusExpiry[slot * STATUS_COUNT + status] = stacks > 0 ? FOREVER : 0;
};

describe('spawning', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('copies the authored stat block onto the entity', () => {
    const type = enemyIndex(world, 'husk');
    const slot = spawnEnemy(world, type, 0);

    const husk = registry.enemies.get('husk');
    expect(world.enemies.hp[slot]).toBe(husk!.hp);
    expect(world.enemies.maxHp[slot]).toBe(husk!.hp);
    expect(world.enemies.armour[slot]).toBe(husk!.armour);
    /* Content authors tiles per second; the simulation works in pixels. */
    expect(world.enemies.speed[slot]).toBeCloseTo(husk!.speed * TILE_SIZE, 4);
  });

  it('places the enemy at the path start immediately, not at the origin', () => {
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    const path = world.rules.paths[0]!;

    expect(world.enemies.x[slot]).toBeCloseTo(path.points[0]!, 4);
    expect(world.enemies.y[slot]).toBeCloseTo(path.points[1]!, 4);
  });

  it('marks a flyer from its traits', () => {
    const bat = spawnEnemy(world, enemyIndex(world, 'rift_bat'), 0);
    const husk = spawnEnemy(world, enemyIndex(world, 'husk'), 0);

    expect(world.enemies.flags[bat]! & EnemyFlag.Flying).toBeTruthy();
    expect(world.enemies.flags[husk]! & EnemyFlag.Flying).toBeFalsy();
  });

  it('refuses an unknown type or spawn point rather than creating a broken entity', () => {
    expect(spawnEnemy(world, 999, 0)).toBe(-1);
    expect(spawnEnemy(world, 0, 99)).toBe(-1);
    expect(world.enemies.count).toBe(0);
  });

  it('announces the spawn', () => {
    spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    expect(world.events.count).toBe(1);
  });
});

describe('an enemy travels at its authored speed', () => {
  /**
   * The acceptance criterion: distance covered depends on the stat block and
   * the clock, never on how the path happens to bend. Position is derived from
   * `pathDist`, so a corner cannot cost or gain an enemy ground.
   */
  it.each(['riftling', 'husk', 'ironclad_revenant'])(
    'moves %s exactly its speed in one second',
    (id) => {
      const world = freshWorld();
      const slot = spawnEnemy(world, enemyIndex(world, id), 0);
      const expected = world.enemies.speed[slot]!;

      advance(world, TICK_HZ);
      expect(world.enemies.pathDist[slot]).toBeCloseTo(expected, 2);
    },
  );

  it('covers the same distance across a corner as along a straight', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    const perSecond = world.enemies.speed[slot]!;

    advance(world, TICK_HZ * 3);
    const afterThree = world.enemies.pathDist[slot]!;
    advance(world, TICK_HZ * 3);

    /* Stage 1-1's path turns twice within this span. */
    expect(world.enemies.pathDist[slot]! - afterThree).toBeCloseTo(perSecond * 3, 1);
  });

  it('keeps position consistent with distance along the path', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    advance(world, 120);

    const path = world.rules.pathById.get(world.enemies.pathId[slot]!)!;
    const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
    path.sample(world.enemies.pathDist[slot]!, sample);

    /* Offset sideways by its lane, so the distance from the centre line is
       bounded by half the lane width rather than zero. */
    const drift = Math.hypot(world.enemies.x[slot]! - sample.x, world.enemies.y[slot]! - sample.y);
    expect(drift).toBeLessThanOrEqual(world.rules.laneWidth / 2 + 0.001);
  });

  it('does not move a blocked enemy', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.flags[slot] = world.enemies.flags[slot]! | EnemyFlag.Blocked;

    advance(world, 60);
    expect(world.enemies.pathDist[slot]).toBe(0);
  });
});

describe('slows and freeze', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
  });

  it('moves at full speed with no statuses', () => {
    expect(speedMultiplier(world, slot)).toBe(1);
  });

  it('slows by the authored amount per chill stack', () => {
    const perStack = registry.statuses.get('chill')!.slowPerStack;
    setStatus(world, slot, STATUS_INDEX.chill, 3);
    expect(speedMultiplier(world, slot)).toBeCloseTo(1 - perStack * 3, 5);
  });

  it('actually covers less ground while chilled', () => {
    setStatus(world, slot, STATUS_INDEX.chill, 5);
    advance(world, TICK_HZ);
    const chilled = world.enemies.pathDist[slot]!;

    const clean = freshWorld();
    const other = spawnEnemy(clean, enemyIndex(clean, 'husk'), 0);
    advance(clean, TICK_HZ);

    expect(chilled).toBeLessThan(clean.enemies.pathDist[other]!);
  });

  it('stops an enemy outright while frozen', () => {
    setStatus(world, slot, STATUS_INDEX.freeze, 1);
    expect(speedMultiplier(world, slot)).toBe(0);

    advance(world, 60);
    expect(world.enemies.pathDist[slot]).toBe(0);
  });

  it('recovers full speed when the status clears', () => {
    setStatus(world, slot, STATUS_INDEX.freeze, 1);
    advance(world, 30);
    expect(world.enemies.pathDist[slot]).toBe(0);

    setStatus(world, slot, STATUS_INDEX.freeze, 0);
    advance(world, TICK_HZ);
    expect(world.enemies.pathDist[slot]).toBeCloseTo(world.enemies.speed[slot]!, 2);
  });

  /* A single Frost Cairn must not trivialise an encounter designed around
     movement (docs/GAME_DESIGN.md §10). */
  it('never stops a normal enemy completely through stacking slows', () => {
    for (let status = 0; status < STATUS_COUNT; status++) setStatus(world, slot, status, 255);
    setStatus(world, slot, STATUS_INDEX.freeze, 0);
    expect(speedMultiplier(world, slot)).toBeGreaterThan(0);
  });

  it('caps a boss at a quarter slow and ignores freeze entirely', () => {
    world.enemies.flags[slot] =
      world.enemies.flags[slot]! | EnemyFlag.Boss | EnemyFlag.FreezeImmune;
    setStatus(world, slot, STATUS_INDEX.chill, 5);
    expect(speedMultiplier(world, slot)).toBeCloseTo(0.75, 5);

    setStatus(world, slot, STATUS_INDEX.freeze, 1);
    expect(speedMultiplier(world, slot)).toBeGreaterThan(0);
  });
});

describe('flyers', () => {
  it('ignore the road and head straight for the core', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'rift_bat'), 0);
    const spawn = world.rules.spawnPoints[0]!;
    const core = world.rules.core;

    advance(world, TICK_HZ * 2);

    /* On the line from spawn to core, allowing for the drift. */
    const alongX = core.x - spawn.x;
    const alongY = core.y - spawn.y;
    const length = Math.hypot(alongX, alongY);
    const relX = world.enemies.x[slot]! - spawn.x;
    const relY = world.enemies.y[slot]! - spawn.y;
    const perpendicular = Math.abs((relX * -alongY + relY * alongX) / length);

    expect(perpendicular).toBeLessThan(15);
    expect(world.enemies.pathDist[slot]).toBeGreaterThan(0);
  });

  it('drifts rather than tracking the line exactly, so a flight looks alive', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'rift_bat'), 0);

    const offsets: number[] = [];
    for (let i = 0; i < 8; i++) {
      advance(world, 12);
      offsets.push(world.enemies.y[slot]!);
    }
    expect(new Set(offsets.map((o) => Math.round(o))).size).toBeGreaterThan(1);
  });

  it('reaches the core and is marked leaked', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'rift_bat'), 0);
    /* movementSystem alone, so the mark can be observed before the lifecycle
       system collects the body in the same tick. */
    world.enemies.pathDist[slot] = 1e9;
    movementSystem(world);

    expect(world.enemies.flags[slot]! & EnemyFlag.Leaked).toBeTruthy();
  });
});

describe('reaching the core', () => {
  /* Movement only marks. Charging lives and removing the body is the lifecycle
     system's job — two systems both deciding an entity is gone is how a bounty
     gets paid twice. */
  it('marks a walker leaked without removing it', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'riftling'), 0);
    world.enemies.pathDist[slot] = 1e9;
    movementSystem(world);

    expect(world.enemies.flags[slot]! & EnemyFlag.Leaked).toBeTruthy();
    expect(world.enemies.isAlive(slot)).toBe(true);
  });

  it('stops advancing once it has leaked', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'riftling'), 0);
    world.enemies.pathDist[slot] = 1e9;
    movementSystem(world);

    const settled = world.enemies.pathDist[slot]!;
    movementSystem(world);
    expect(world.enemies.pathDist[slot]).toBe(settled);
  });
});

describe('determinism', () => {
  it('produces identical movement from the same seed', () => {
    const run = (): number[] => {
      const world = freshWorld(2026);
      for (const id of ['husk', 'riftling', 'rift_bat']) {
        spawnEnemy(world, enemyIndex(world, id), 0);
      }
      advance(world, 600);
      return [...world.enemies.x.slice(0, 3), ...world.enemies.y.slice(0, 3)];
    };

    expect(run()).toEqual(run());
  });
});
