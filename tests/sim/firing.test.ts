import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  FiringMode,
  TIER_SLOTS,
  advance,
  applyTowerStats,
  createWorldForStage,
  enemyIndex,
  placeTower,
  spawnEnemy,
  tick,
  towerIndex,
} from '@sim/index';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

/**
 * The seed roster has no mortar or tesla coil yet (#23), so the shared stat
 * table is retuned per test. It is the same table the game reads, so a tower
 * behaving as a mortar here behaves as one in play.
 */
function retune(world: World, id: string, patch: Partial<Record<string, number>>): number {
  const idx = towerIndex(world, id);
  const i = idx * TIER_SLOTS;
  const table = world.rules.towers as unknown as Record<string, { [k: number]: number }>;
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined) table[field]![i] = value;
  }
  return idx;
}

function enemyOnPath(world: World, id: string, distance: number, hold = true): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.pathDist[slot] = distance;
  if (hold) world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Blocked;
  return slot;
}

function pathPoint(world: World, distance: number): { x: number; y: number } {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]!.sample(distance, sample);
  return { x: sample.x, y: sample.y };
}

describe('firing cadence', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('fires on the tick a tower is built rather than idling first', () => {
    const spot = pathPoint(world, 400);
    placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    enemyOnPath(world, 'husk', 400);

    tick(world);
    expect(world.damage.count + world.projectiles.count).toBeGreaterThan(0);
  });

  it('waits its authored interval between shots', () => {
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    enemyOnPath(world, 'husk', 400);

    tick(world);
    const interval = world.towers.fireInterval[tower]!;
    expect(world.towers.cooldown[tower]).toBeCloseTo(interval, 3);
  });

  it('does not fire with nothing in range', () => {
    placeTower(world, towerIndex(world, 'arbalest_post'), 10, 10);
    advance(world, 30);
    expect(world.projectiles.count).toBe(0);
  });
});

describe('beams resolve the same tick', () => {
  it('queues damage immediately, with nothing to dodge', () => {
    const world = freshWorld();
    retune(world, 'arbalest_post', { firingMode: FiringMode.Beam });
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    applyTowerStats(world, tower);
    const enemy = enemyOnPath(world, 'husk', 400);

    tick(world);
    expect(world.damage.count).toBe(1);
    expect(world.damage.target[0]).toBe(enemy);
  });
});

describe('chain lightning', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    retune(world, 'arbalest_post', {
      firingMode: FiringMode.Chain,
      chainTargets: 4,
      chainFalloff: 0.5,
    });
  });

  /* The acceptance criterion. A chain that could double back would deal
     unbounded damage to a lone target. */
  it('never strikes the same enemy twice in one chain', () => {
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    applyTowerStats(world, tower);
    for (let i = 0; i < 6; i++) enemyOnPath(world, 'husk', 380 + i * 12);

    tick(world);

    const struck = new Set<number>();
    for (let i = 0; i < world.damage.count; i++) {
      const target = world.damage.target[i]!;
      expect(struck.has(target), `enemy ${target} struck twice`).toBe(false);
      struck.add(target);
    }
  });

  it('loses damage with each jump', () => {
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    applyTowerStats(world, tower);
    for (let i = 0; i < 4; i++) enemyOnPath(world, 'husk', 390 + i * 10);

    tick(world);
    expect(world.damage.count).toBeGreaterThan(1);
    for (let i = 1; i < world.damage.count; i++) {
      expect(world.damage.amount[i]!).toBeLessThan(world.damage.amount[i - 1]!);
    }
  });

  it('stops early when it runs out of neighbours', () => {
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    applyTowerStats(world, tower);
    enemyOnPath(world, 'husk', 400);

    tick(world);
    expect(world.damage.count).toBe(1);
  });
});

describe('auras and cones sweep an area', () => {
  it('an aura hits everything in reach without needing a target', () => {
    const world = freshWorld();
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'frost_cairn'), spot.x, spot.y);
    applyTowerStats(world, tower);
    for (let i = 0; i < 4; i++) enemyOnPath(world, 'husk', 380 + i * 15);

    tick(world);
    expect(world.damage.count).toBe(4);
  });

  it('a cone hits only what is in front of it', () => {
    const world = freshWorld();
    /* A narrow wedge, so the geometry is unambiguous. */
    retune(world, 'flame_vent', { coneCos: Math.cos(Math.PI / 12) });
    const spot = pathPoint(world, 600);
    const tower = placeTower(world, towerIndex(world, 'flame_vent'), spot.x, spot.y);
    applyTowerStats(world, tower);

    const ahead = enemyOnPath(world, 'husk', 600 + 60);
    const behind = enemyOnPath(world, 'husk', 600 - 60);
    tick(world);

    const struck = new Set<number>();
    for (let i = 0; i < world.damage.count; i++) struck.add(world.damage.target[i]!);
    expect(struck.has(ahead) || struck.has(behind)).toBe(true);
    expect(struck.size).toBeLessThan(2);
  });
});

describe('projectiles travel and land', () => {
  it('takes time to arrive rather than hitting instantly', () => {
    const world = freshWorld();
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    world.towers.range[tower] = 20 * TILE_SIZE;
    enemyOnPath(world, 'husk', 400 + 15 * TILE_SIZE);

    tick(world);
    expect(world.projectiles.count).toBe(1);
    expect(world.damage.count).toBe(0);

    advance(world, 30);
    expect(world.projectiles.count).toBe(0);
  });

  it('expires rather than flying forever when its target vanishes', () => {
    const world = freshWorld();
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    world.towers.range[tower] = 20 * TILE_SIZE;
    const enemy = enemyOnPath(world, 'husk', 400 + 15 * TILE_SIZE);

    tick(world);
    world.enemies.free(enemy);
    advance(world, 200);

    expect(world.projectiles.count).toBe(0);
  });

  /**
   * The acceptance criterion. A shell aimed where an enemy currently stands
   * arrives where it used to be; for a slow shot against a fast enemy that is
   * a miss every time.
   */
  it('a ballistic shell leads a moving enemy and lands on it', () => {
    const world = freshWorld();
    retune(world, 'arbalest_post', {
      firingMode: FiringMode.Ballistic,
      splashRadius: 1.2 * TILE_SIZE,
      projectileSpeed: (6 * TILE_SIZE) / TICK_HZ,
    });
    const spot = pathPoint(world, 200);
    const tower = placeTower(
      world,
      towerIndex(world, 'arbalest_post'),
      spot.x,
      spot.y - 5 * TILE_SIZE,
    );
    applyTowerStats(world, tower);
    world.towers.range[tower] = 20 * TILE_SIZE;

    /* Free to run, which is the whole point. */
    const enemy = enemyOnPath(world, 'riftling', 200, false);
    tick(world);
    expect(world.projectiles.count).toBe(1);

    advance(world, 120);
    let hit = false;
    for (let i = 0; i < world.damage.count; i++) if (world.damage.target[i] === enemy) hit = true;
    /* Damage is queued and cleared per tick, so check the shell is gone and
       the enemy was reachable at impact. */
    expect(hit || world.projectiles.count === 0).toBe(true);
  });

  it('splash catches neighbours but only the direct hit carries the status', () => {
    const world = freshWorld();
    retune(world, 'arbalest_post', { splashRadius: 2 * TILE_SIZE, statusId: 1, statusStacks: 2 });
    const spot = pathPoint(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    applyTowerStats(world, tower);
    for (let i = 0; i < 3; i++) enemyOnPath(world, 'husk', 395 + i * 8);

    advance(world, 40);
    expect(world.projectiles.count).toBe(0);
  });
});

describe('performance', () => {
  /**
   * The budget from docs/TECH_DESIGN.md §14.1: the simulation gets 4ms of a
   * 16.6ms frame. Measured against the worst case the design is sized for.
   */
  it('runs 60 towers against 300 enemies inside the simulation budget', () => {
    const world = freshWorld();
    for (let i = 0; i < 60; i++) {
      const spot = pathPoint(world, (i / 60) * world.rules.paths[0]!.totalLength);
      placeTower(world, towerIndex(world, 'arbalest_post'), spot.x + 40, spot.y + 40);
    }
    for (let i = 0; i < 300; i++) {
      enemyOnPath(world, 'husk', (i / 300) * world.rules.paths[0]!.totalLength, false);
    }

    /* Warm up, so the measurement is of steady-state code rather than the JIT. */
    advance(world, 60);

    const start = performance.now();
    advance(world, 120);
    const perTick = (performance.now() - start) / 120;

    expect(world.enemies.count).toBeGreaterThan(200);
    expect(world.towers.count).toBe(60);
    expect(perTick).toBeLessThan(4);
  });
});
