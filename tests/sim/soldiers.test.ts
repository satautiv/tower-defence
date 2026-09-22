import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  SoldierFlag,
  advance,
  buildTower,
  createWorldForStage,
  enemyIndex,
  hashWorld,
  moveRally,
  placeTower,
  applyTowerStats,
  soldierSystem,
  spawnEnemy,
  tick,
  towerIndex,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Soldiers and blocking (#24, docs/TECH_DESIGN.md §7.7).
 *
 * The most subtle system in the genre and the one players notice most when it
 * is wrong. What is tested here is almost entirely the edges: an enemy must
 * never slip past a live soldier, and must never be held forever by a dead or
 * departed one. The happy path in the middle is the easy part.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const garrison = registry.towers.get('wardens_barracks')?.tiers[0].garrison;
if (garrison === undefined) throw new Error('the barracks has no garrison');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

/** A barracks standing beside the path, at a known distance along it. */
function barracksAt(world: World, pathDistance: number): number {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);

  const slot = placeTower(world, towerIndex(world, 'wardens_barracks'), sample.x, sample.y);
  applyTowerStats(world, slot);
  return slot;
}

/**
 * An enemy standing at a given distance along the path.
 *
 * Its x and y are placed too, not only its path distance: those are normally
 * set by the movement system, and a test that calls `soldierSystem` on its own
 * would otherwise be asking a soldier to block something still sitting at the
 * spawn point.
 */
function enemyAt(world: World, pathDistance: number, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);

  world.enemies.pathDist[slot] = pathDistance;
  world.enemies.x[slot] = sample.x;
  world.enemies.y[slot] = sample.y;
  return slot;
}

const liveSoldiers = (world: World): number[] => {
  const out: number[] = [];
  for (let slot = 0; slot < world.soldiers.watermark; slot++) {
    if (world.soldiers.isAlive(slot)) out.push(slot);
  }
  return out;
};

const engagedCount = (world: World): number =>
  liveSoldiers(world).filter(
    (slot) => ((world.soldiers.flags[slot] as number) & SoldierFlag.Engaged) !== 0,
  ).length;

describe('a barracks keeps its garrison', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('raises the authored number of soldiers', () => {
    barracksAt(world, 400);
    soldierSystem(world);
    expect(liveSoldiers(world)).toHaveLength(garrison.count);
  });

  it('raises them only once, not every tick', () => {
    barracksAt(world, 400);
    advance(world, 120);
    expect(liveSoldiers(world)).toHaveLength(garrison.count);
  });

  it('gives them the authored stats', () => {
    barracksAt(world, 400);
    soldierSystem(world);
    const slot = liveSoldiers(world)[0] as number;

    expect(world.soldiers.maxHp[slot]).toBe(garrison.hp);
    expect(world.soldiers.hp[slot]).toBe(garrison.hp);
    expect(world.soldiers.armour[slot]).toBe(garrison.armour);
    expect(world.soldiers.damage[slot]).toBe(garrison.damage);
  });

  /* A barracks nobody has dragged a flag for defends its own doorstep, rather
     than gathering at the map origin. */
  it('gathers at the tower until a rally point is set', () => {
    const tower = barracksAt(world, 400);
    soldierSystem(world);
    const slot = liveSoldiers(world)[0] as number;

    expect(world.soldiers.rallyX[slot]).toBeCloseTo(world.towers.x[tower] as number, 3);
    expect(world.soldiers.rallyY[slot]).toBeCloseTo(world.towers.y[tower] as number, 3);
  });

  it('gives a tower that keeps no soldiers none', () => {
    const slot = placeTower(world, towerIndex(world, 'arbalest_post'), 500, 500);
    applyTowerStats(world, slot);
    soldierSystem(world);
    expect(liveSoldiers(world)).toHaveLength(0);
  });
});

describe('the blocking window', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    barracksAt(world, 400);
    soldierSystem(world);
  });

  it('holds an enemy that walks into it', () => {
    const enemy = enemyAt(world, 400);
    soldierSystem(world);

    expect(world.enemies.blockedBy[enemy]).toBeGreaterThanOrEqual(0);
    expect((world.enemies.flags[enemy] as number) & EnemyFlag.Blocked).not.toBe(0);
  });

  /**
   * The bug this whole system is shaped around. Stage 1-1's route doubles back
   * on itself, so two points a tile apart in pixels can be a hundred tiles
   * apart along the path. A soldier must block what it is standing in front
   * of, not what it happens to be near.
   */
  it('ignores an enemy that is close in pixels but far along the path', () => {
    const soldier = liveSoldiers(world)[0] as number;
    const enemy = enemyAt(world, 400);

    /* Standing on top of the soldier, but far away in the only sense that
       matters. */
    world.enemies.x[enemy] = world.soldiers.x[soldier] as number;
    world.enemies.y[enemy] = world.soldiers.y[soldier] as number;
    world.enemies.pathDist[enemy] = 400 + TILE_SIZE * 20;

    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  it('ignores an enemy on another path entirely', () => {
    const enemy = enemyAt(world, 400);
    world.enemies.pathId[enemy] = 9;

    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  /* A flyer is not on the road; there is nothing to stand in front of. */
  it('lets a flyer pass straight through', () => {
    const enemy = enemyAt(world, 400, 'rift_bat');
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) | EnemyFlag.Flying;

    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  it('lets a burrowed enemy pass underneath', () => {
    const enemy = enemyAt(world, 400);
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) | EnemyFlag.Burrowed;

    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  it('never has two soldiers hold the same enemy', () => {
    const enemy = enemyAt(world, 400);
    advance(world, 30);

    const holders = liveSoldiers(world).filter(
      (slot) => (world.soldiers.engagedWith[slot] as number) === enemy,
    );
    expect(holders.length).toBeLessThanOrEqual(1);
  });
});

describe('a blocked enemy stops', () => {
  let world: World;
  let enemy: number;
  beforeEach(() => {
    world = freshWorld();
    barracksAt(world, 400);
    soldierSystem(world);
    enemy = enemyAt(world, 400);
    soldierSystem(world);
  });

  it('stops advancing along the path', () => {
    expect(world.enemies.blockedBy[enemy]).toBeGreaterThanOrEqual(0);
    const before = world.enemies.pathDist[enemy] as number;

    advance(world, 30);
    expect(world.enemies.pathDist[enemy]).toBe(before);
  });

  /* No enemy slips past a live soldier — the acceptance criterion. */
  it('does not slip past while it is held', () => {
    expect(world.enemies.blockedBy[enemy]).toBeGreaterThanOrEqual(0);
    const before = world.enemies.pathDist[enemy] as number;
    for (let i = 0; i < 60; i++) {
      tick(world);
      if ((world.enemies.blockedBy[enemy] as number) < 0) break;
      expect(world.enemies.pathDist[enemy]).toBe(before);
    }
  });

  it('takes damage from the soldier holding it', () => {
    const before = world.enemies.hp[enemy] as number;
    advance(world, 120);
    expect(world.enemies.hp[enemy]).toBeLessThan(before);
  });

  it('hits back on its own timer', () => {
    const soldier = world.enemies.blockedBy[enemy] as number;
    const before = world.soldiers.hp[soldier] as number;
    advance(world, 120);
    expect(world.soldiers.hp[soldier]).toBeLessThan(before);
  });
});

describe('a block always ends', () => {
  let world: World;
  let enemy: number;
  beforeEach(() => {
    world = freshWorld();
    barracksAt(world, 400);
    soldierSystem(world);
    enemy = enemyAt(world, 400);
    soldierSystem(world);
  });

  /**
   * The release valve. Without it two soldiers and a rally flag hold a boss
   * forever, which is not a strategy the design wants to exist.
   */
  it('lapses once the enemy has been held for its authored window', () => {
    const typeIdx = world.enemies.typeIdx[enemy] as number;
    const window = world.rules.enemies.maxBlockTicks[typeIdx] as number;
    expect(window).toBeGreaterThan(0);

    world.enemies.hp[enemy] = 1_000_000;
    advance(world, Math.ceil(window) + 2);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  it('starts moving again once it does', () => {
    const typeIdx = world.enemies.typeIdx[enemy] as number;
    const window = world.rules.enemies.maxBlockTicks[typeIdx] as number;
    world.enemies.hp[enemy] = 1_000_000;

    advance(world, Math.ceil(window) + 2);
    const released = world.enemies.pathDist[enemy] as number;
    advance(world, 30);
    expect(world.enemies.pathDist[enemy]).toBeGreaterThan(released);
  });

  /* Bosses shrug a block off sooner than anything else (§7.7). */
  it('gives a tougher enemy a shorter window than an ordinary one', () => {
    const husk = world.rules.enemies.indexOf.get('husk') as number;
    const revenant = world.rules.enemies.indexOf.get('ironclad_revenant') as number;
    expect(world.rules.enemies.maxBlockTicks[revenant]).toBeLessThan(
      world.rules.enemies.maxBlockTicks[husk] as number,
    );
  });

  it('releases when the soldier dies', () => {
    const soldier = world.enemies.blockedBy[enemy] as number;
    world.soldiers.hp[soldier] = 0.0001;

    advance(world, 120);
    expect(world.enemies.blockedBy[enemy]).not.toBe(soldier);
  });

  it('releases when the enemy dies', () => {
    const soldier = world.enemies.blockedBy[enemy] as number;
    world.enemies.hp[enemy] = 0.0001;

    advance(world, 30);
    expect((world.soldiers.flags[soldier] as number) & SoldierFlag.Engaged).toBe(0);
  });

  /* Moving the rally mid-fight releases cleanly and re-engages correctly. */
  it('releases when the rally flag is dragged away', () => {
    expect(engagedCount(world)).toBeGreaterThan(0);

    const tower = world.soldiers.sourceTower[world.enemies.blockedBy[enemy] as number] as number;
    moveRally(world, tower, 2000, 2000);

    expect(world.enemies.blockedBy[enemy]).toBe(-1);
    expect(engagedCount(world)).toBe(0);
  });
});

describe('the rally flag', () => {
  let world: World;
  let tower: number;
  beforeEach(() => {
    world = freshWorld();
    tower = barracksAt(world, 400);
    soldierSystem(world);
  });

  it('is clamped to the authored range', () => {
    moveRally(world, tower, 100_000, 100_000);

    const dx = (world.towers.rallyX[tower] as number) - (world.towers.x[tower] as number);
    const dy = (world.towers.rallyY[tower] as number) - (world.towers.y[tower] as number);
    expect(Math.hypot(dx, dy)).toBeCloseTo(garrison.rallyRangeTiles * TILE_SIZE, 2);
  });

  it('is taken as given when it is already in range', () => {
    const x = (world.towers.x[tower] as number) + TILE_SIZE;
    const y = world.towers.y[tower] as number;
    moveRally(world, tower, x, y);
    expect(world.towers.rallyX[tower]).toBeCloseTo(x, 3);
  });

  it('is refused for a tower that keeps no soldiers', () => {
    const arbalest = placeTower(world, towerIndex(world, 'arbalest_post'), 500, 500);
    applyTowerStats(world, arbalest);
    expect(moveRally(world, arbalest, 600, 600)).toBe(false);
  });

  it('walks the garrison to where it was dragged', () => {
    const x = (world.towers.x[tower] as number) + TILE_SIZE * 2;
    const y = world.towers.y[tower] as number;
    moveRally(world, tower, x, y);

    advance(world, 240);
    for (const slot of liveSoldiers(world)) {
      if (((world.soldiers.flags[slot] as number) & SoldierFlag.Engaged) !== 0) continue;
      expect(
        Math.hypot((world.soldiers.x[slot] as number) - x, (world.soldiers.y[slot] as number) - y),
      ).toBeLessThan(TILE_SIZE);
    }
  });

  it('re-engages after the move, rather than staying idle', () => {
    const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
    world.rules.paths[0]?.sample(700, sample);
    moveRally(world, tower, sample.x, sample.y);

    /* Let them walk there first. An enemy spawned before they arrive would
       stroll through the window while it was still empty, and the test would
       be measuring the race rather than the re-engagement. */
    advance(world, 420);

    /* Where the garrison actually ended up, which is not necessarily where the
       flag was aimed: the rally range clamps it. */
    const soldier = liveSoldiers(world)[0] as number;
    enemyAt(world, world.soldiers.pathDist[soldier] as number);

    advance(world, 5);
    expect(engagedCount(world)).toBeGreaterThan(0);
  });
});

describe('a fallen soldier comes back', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    barracksAt(world, 400);
    soldierSystem(world);
  });

  it('counts down and returns at full health', () => {
    const slot = liveSoldiers(world)[0] as number;
    world.soldiers.hp[slot] = 0.0001;
    enemyAt(world, 400);

    advance(world, Math.ceil(garrison.respawnSeconds * TICK_HZ) + 120);
    expect(liveSoldiers(world).length).toBe(garrison.count);
  });

  /* Per slot, not one shared timer: a barracks that has lost two brings them
     back independently. */
  it('keeps a separate timer per garrison slot', () => {
    const slots = liveSoldiers(world);
    world.soldiers.respawnIn[slots[0] as number] = 30;
    world.soldiers.flags[slots[0] as number] = SoldierFlag.Alive | SoldierFlag.Respawning;
    world.soldiers.respawnIn[slots[1] as number] = 200;
    world.soldiers.flags[slots[1] as number] = SoldierFlag.Alive | SoldierFlag.Respawning;

    advance(world, 40);
    expect((world.soldiers.flags[slots[0] as number] as number) & SoldierFlag.Respawning).toBe(0);
    expect((world.soldiers.flags[slots[1] as number] as number) & SoldierFlag.Respawning).not.toBe(
      0,
    );
  });

  it('does not come back if the barracks is gone', () => {
    const slot = liveSoldiers(world)[0] as number;
    world.soldiers.respawnIn[slot] = 2;
    world.soldiers.flags[slot] = SoldierFlag.Alive | SoldierFlag.Respawning;
    world.towers.free(world.soldiers.sourceTower[slot] as number);

    advance(world, 10);
    expect(world.soldiers.isAlive(slot)).toBe(false);
  });
});

/**
 * The test the unit tests above could not have caught.
 *
 * Every one of them places the barracks *on* the path, because that is the
 * convenient way to write them — and on that board blocking worked perfectly
 * while a real stage produced **zero blocks**. Plots sit two or three tiles
 * off the road, a soldier's reach is measured in pixels, and a garrison
 * standing at its own tower watches every enemy walk by just out of arm's
 * length.
 *
 * So this one builds on an authored plot, through the command queue, and
 * simply plays.
 */
describe('a barracks on a real plot actually blocks', () => {
  it('holds enemies when built on an authored plot and left alone', () => {
    const world = freshWorld();
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    buildTower(world.commands, plot.id, towerIndex(world, 'wardens_barracks'));

    let blockedTicks = 0;
    for (let t = 0; t < TICK_HZ * 120; t++) {
      tick(world);
      for (let slot = 0; slot < world.enemies.watermark; slot++) {
        if (!world.enemies.isAlive(slot)) continue;
        if (((world.enemies.flags[slot] as number) & EnemyFlag.Blocked) !== 0) blockedTicks++;
      }
      world.events.clear();
    }

    expect(blockedTicks, 'a barracks on a plot never blocked anything').toBeGreaterThan(0);
  });

  /* Its garrison takes the road rather than standing on the tower, which is
     what makes the above true. */
  it('garrisons the road it overlooks, not its own doorstep', () => {
    const world = freshWorld();
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    const tower = placeTower(world, towerIndex(world, 'wardens_barracks'), plot.x, plot.y);
    applyTowerStats(world, tower);
    soldierSystem(world);

    const slot = liveSoldiers(world)[0] as number;
    const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
    world.rules.paths[0]?.sample(world.soldiers.pathDist[slot] as number, sample);

    const toRoad = Math.hypot(
      (world.soldiers.rallyX[slot] as number) - sample.x,
      (world.soldiers.rallyY[slot] as number) - sample.y,
    );
    const toTower = Math.hypot(
      (world.soldiers.rallyX[slot] as number) - (world.towers.x[tower] as number),
      (world.soldiers.rallyY[slot] as number) - (world.towers.y[tower] as number),
    );
    expect(toRoad).toBeLessThan(toTower);
  });
});

describe('blocking is deterministic', () => {
  /**
   * Same seed, same fight. Blocking resolves in slot order and every timer is
   * a tick count, so there is nothing in it that could differ between runs —
   * which is exactly the sort of claim worth checking rather than asserting.
   */
  function fight(seed: number): string {
    const world = freshWorld(seed);
    barracksAt(world, 400);
    for (let i = 0; i < 6; i++) enemyAt(world, 380 + i * 12);
    advance(world, 600);
    return hashWorld(world);
  }

  it('produces an identical world from an identical run', () => {
    expect(fight(5)).toBe(fight(5));
  });

  it('runs the same at 3x as at 1x', () => {
    const slow = freshWorld(3);
    const fast = freshWorld(3);
    for (const world of [slow, fast]) {
      barracksAt(world, 400);
      for (let i = 0; i < 4; i++) enemyAt(world, 380 + i * 12);
    }

    for (let i = 0; i < 300; i++) advance(slow, 1);
    for (let i = 0; i < 100; i++) advance(fast, 3);

    expect(fast.tick).toBe(slow.tick);
    expect(hashWorld(fast)).toBe(hashWorld(slow));
  });
});
