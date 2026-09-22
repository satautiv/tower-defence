import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  TIER_SLOTS,
  TargetMode,
  advance,
  applyTowerStats,
  canTarget,
  createWorldForStage,
  enemyIndex,
  pickTarget,
  placeTower,
  spawnEnemy,
  targetingSystem,
  tick,
  towerIndex,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

/** Drops an enemy at an exact position, bypassing the path. */
function enemyAt(world: World, id: string, x: number, y: number, hp?: number): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = y;
  if (hp !== undefined) world.enemies.hp[slot] = hp;
  return slot;
}

describe('the tower table resolves authored stats', () => {
  it('converts rate and range into ticks and pixels', () => {
    const world = freshWorld();
    const idx = towerIndex(world, 'arbalest_post');
    const tier = registry.towers.get('arbalest_post')!.tiers[0];
    const i = idx * TIER_SLOTS;

    expect(world.rules.towers.fireIntervalTicks[i]).toBeCloseTo(TICK_HZ / tier.fireRate, 4);
    expect(world.rules.towers.range[i]).toBeCloseTo(tier.rangeTiles * TILE_SIZE, 4);
  });

  it('gives a specialised tower its branch stats', () => {
    const world = freshWorld();
    const slot = placeTower(world, towerIndex(world, 'arbalest_post'), 0, 0);

    world.towers.tier[slot] = 3;
    world.towers.specialisation[slot] = 0;
    applyTowerStats(world, slot);

    const nest = registry.towers.get('arbalest_post')!.specialisations[0].tiers[0];
    expect(world.towers.range[slot]).toBeCloseTo(nest.rangeTiles * TILE_SIZE, 4);
  });
});

describe('what a tower is allowed to shoot', () => {
  let world: World;
  let tower: number;
  beforeEach(() => {
    world = freshWorld();
    tower = placeTower(world, towerIndex(world, 'arbalest_post'), 500, 500);
  });

  it('accepts an enemy inside its range', () => {
    const enemy = enemyAt(world, 'husk', 550, 500);
    targetingSystem(world);
    expect(canTarget(world, tower, enemy)).toBe(true);
  });

  it('rejects one beyond its range', () => {
    const enemy = enemyAt(world, 'husk', 500 + 50 * TILE_SIZE, 500);
    targetingSystem(world);
    expect(canTarget(world, tower, enemy)).toBe(false);
  });

  it('ignores a burrowed enemy, which is underground', () => {
    const enemy = enemyAt(world, 'husk', 520, 500);
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) | EnemyFlag.Burrowed;
    targetingSystem(world);
    expect(canTarget(world, tower, enemy)).toBe(false);
  });

  it('ignores an enemy that has already leaked', () => {
    const enemy = enemyAt(world, 'husk', 520, 500);
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) | EnemyFlag.Leaked;
    targetingSystem(world);
    expect(canTarget(world, tower, enemy)).toBe(false);
  });

  /* The acceptance criterion: a mortar must never shoot at the sky. */
  it('never lets a ground-only tower target a flyer', () => {
    const groundOnly = placeTower(world, towerIndex(world, 'arbalest_post'), 500, 500);
    const stats = world.rules.towers;
    /* Force the ground-only classification the mortar carries. */
    stats.targets[towerIndex(world, 'arbalest_post') * TIER_SLOTS] = 0;
    applyTowerStats(world, groundOnly);

    const flyer = enemyAt(world, 'rift_bat', 520, 500);
    const walker = enemyAt(world, 'husk', 530, 500);
    targetingSystem(world);

    expect(canTarget(world, groundOnly, flyer)).toBe(false);
    expect(canTarget(world, groundOnly, walker)).toBe(true);
    expect(pickTarget(world, groundOnly)).not.toBe(flyer);

    stats.targets[towerIndex(world, 'arbalest_post') * TIER_SLOTS] = 2;
  });

  it('respects a minimum range, so a mortar has a dead zone', () => {
    world.towers.minRange[tower] = 200;
    const tooClose = enemyAt(world, 'husk', 510, 500);
    const farEnough = enemyAt(world, 'husk', 500 + 260, 500);
    targetingSystem(world);

    expect(canTarget(world, tower, tooClose)).toBe(false);
    expect(canTarget(world, tower, farEnough)).toBe(true);
  });
});

describe('targeting modes', () => {
  let world: World;
  let tower: number;
  beforeEach(() => {
    world = freshWorld();
    tower = placeTower(world, towerIndex(world, 'arbalest_post'), 500, 500);
  });

  const withThree = (): { near: number; far: number; weak: number } => {
    const near = enemyAt(world, 'husk', 520, 500, 90);
    const far = enemyAt(world, 'husk', 560, 500, 300);
    const weak = enemyAt(world, 'husk', 540, 500, 10);
    world.enemies.pathDist[near] = 10;
    world.enemies.pathDist[far] = 900;
    world.enemies.pathDist[weak] = 400;
    targetingSystem(world);
    return { near, far, weak };
  };

  it('First picks the enemy closest to the core, which is about to cost a life', () => {
    const { far } = withThree();
    world.towers.targetMode[tower] = TargetMode.First;
    expect(pickTarget(world, tower)).toBe(far);
  });

  it('Last picks the one furthest from the core', () => {
    const { near } = withThree();
    world.towers.targetMode[tower] = TargetMode.Last;
    expect(pickTarget(world, tower)).toBe(near);
  });

  it('Strongest picks the most health', () => {
    const { far } = withThree();
    world.towers.targetMode[tower] = TargetMode.Strongest;
    expect(pickTarget(world, tower)).toBe(far);
  });

  it('Weakest picks the least health', () => {
    const { weak } = withThree();
    world.towers.targetMode[tower] = TargetMode.Weakest;
    expect(pickTarget(world, tower)).toBe(weak);
  });

  it('Closest picks by distance', () => {
    const { near } = withThree();
    world.towers.targetMode[tower] = TargetMode.Closest;
    expect(pickTarget(world, tower)).toBe(near);
  });

  it('returns -1 when nothing is in reach', () => {
    targetingSystem(world);
    expect(pickTarget(world, tower)).toBe(-1);
  });
});

describe('towers keep a target rather than re-picking every tick', () => {
  /**
   * These run a whole tick, and movement recomputes position from `pathDist`
   * before targeting sees it — so an enemy has to be placed by distance along
   * the path, not by writing x and y. That is the real integration, and it is
   * what a hand-placed enemy would quietly break.
   */
  const onPath = (world: World, distance: number): { x: number; y: number } => {
    const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
    world.rules.paths[0]!.sample(distance, sample);
    return { x: sample.x, y: sample.y };
  };

  const enemyAtDistance = (world: World, id: string, distance: number): number => {
    const slot = spawnEnemy(world, enemyIndex(world, id), 0);
    world.enemies.pathDist[slot] = distance;
    /* Held, so it stays put while the test watches the tower. */
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Blocked;
    return slot;
  };

  it('holds a valid target across ticks', () => {
    const world = freshWorld();
    const spot = onPath(world, 500);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    const enemy = enemyAtDistance(world, 'husk', 500);

    tick(world);
    expect(world.towers.target[tower]).toBe(enemy);

    tick(world);
    expect(world.towers.target[tower]).toBe(enemy);
  });

  it('re-picks once the target dies', () => {
    const world = freshWorld();
    const spot = onPath(world, 500);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    const first = enemyAtDistance(world, 'husk', 520);
    const second = enemyAtDistance(world, 'husk', 480);

    tick(world);
    expect(world.towers.target[tower]).toBe(first);

    world.enemies.free(first);
    tick(world);
    expect(world.towers.target[tower]).toBe(second);
  });

  it('re-picks once the target leaves range', () => {
    const world = freshWorld();
    const spot = onPath(world, 500);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    const enemy = enemyAtDistance(world, 'husk', 500);

    tick(world);
    expect(world.towers.target[tower]).toBe(enemy);

    world.enemies.pathDist[enemy] = 500 + 60 * TILE_SIZE;
    tick(world);
    expect(world.towers.target[tower]).toBe(-1);
  });

  it('holds fire while disabled by a sapper', () => {
    const world = freshWorld();
    const spot = onPath(world, 500);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), spot.x, spot.y);
    enemyAtDistance(world, 'husk', 500);
    world.towers.disabledUntil[tower] = world.tick + 100;

    tick(world);
    expect(world.towers.target[tower]).toBe(-1);
  });
});

describe('the spatial indexes separate ground from air', () => {
  it('indexes a flyer in the air grid and a walker on the ground', () => {
    const world = freshWorld();
    const flyer = enemyAt(world, 'rift_bat', 400, 400);
    const walker = enemyAt(world, 'husk', 400, 400);
    targetingSystem(world);

    const out = new Int32Array(64);
    const air = Array.from(out.subarray(0, world.airIndex.query(400, 400, 50, out)));
    const ground = Array.from(out.subarray(0, world.groundIndex.query(400, 400, 50, out)));

    expect(air).toContain(flyer);
    expect(ground).not.toContain(flyer);
    expect(air).not.toContain(walker);
  });

  it('is rebuilt each tick, so a moved enemy is found at its new position', () => {
    const world = freshWorld();
    const enemy = enemyAt(world, 'husk', 100, 100);
    advance(world, 1);

    world.enemies.x[enemy] = 900;
    world.enemies.y[enemy] = 900;
    targetingSystem(world);

    const out = new Int32Array(64);
    expect(world.groundIndex.query(100, 100, 40, out)).toBe(0);
    expect(world.groundIndex.query(900, 900, 40, out)).toBe(1);
  });
});
