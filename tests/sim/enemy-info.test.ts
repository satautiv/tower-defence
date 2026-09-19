import { describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  STATUS_COUNT,
  STATUS_INDEX,
  createWorldForStage,
  enemyIndex,
  enemyInfo,
  enemyNear,
  spawnEnemy,
} from '@sim/index';

/**
 * Reading an enemy (#28: while paused, the player can read enemy stats). What
 * the panel shows has to be what combat uses, and it must never describe a
 * different enemy that has taken over a recycled slot.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (): World => createWorldForStage(registry, stage, 1);

function spawn(world: World, id: string): { slot: number; entityId: number } {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  return { slot, entityId: world.enemies.ids[slot] as number };
}

function afflict(world: World, slot: number, status: string, stacks: number, seconds = 2): void {
  const at = slot * STATUS_COUNT + (STATUS_INDEX as Record<string, number>)[status]!;
  world.enemies.statusStacks[at] = stacks;
  world.enemies.statusExpiry[at] = world.tick + seconds * TICK_HZ;
}

describe('what the panel reads', () => {
  it('reports an unhurt enemy as authored', () => {
    const world = freshWorld();
    const { slot, entityId } = spawn(world, 'riftling');

    expect(enemyInfo(world, slot, entityId)).toMatchObject({
      enemyId: 'riftling',
      hp: 45,
      maxHp: 45,
      armour: 0,
      ward: 0,
      /* Float32 storage: 1.6 reads back a hair over. */
      speed: expect.closeTo(1.6, 5),
      baseSpeed: expect.closeTo(1.6, 5),
      statuses: [],
      threats: [],
      bounty: 4,
      livesCost: 1,
    });
  });

  it('carries the threat tags the wave preview uses', () => {
    const world = freshWorld();
    const bat = spawn(world, 'rift_bat');
    const revenant = spawn(world, 'ironclad_revenant');

    expect(enemyInfo(world, bat.slot, bat.entityId)?.threats).toEqual(['air']);
    expect(enemyInfo(world, revenant.slot, revenant.entityId)?.threats).toEqual(['armoured']);
  });

  /* The number a hit would actually meet, not the one in the content file. */
  it('shows armour as Corrode has left it, beside what it started as', () => {
    const world = freshWorld();
    const { slot, entityId } = spawn(world, 'ironclad_revenant');
    afflict(world, slot, 'corrode', 2);

    const info = enemyInfo(world, slot, entityId);
    const perStack = world.rules.statuses.defenceReductionPerStack[STATUS_INDEX.corrode] as number;
    expect(info?.baseArmour).toBe(40);
    expect(info?.armour).toBe(40 - 2 * perStack);
  });

  it('shows speed as slows have left it, and zero while frozen', () => {
    const world = freshWorld();
    const { slot, entityId } = spawn(world, 'husk');

    afflict(world, slot, 'chill', 2);
    const chilled = enemyInfo(world, slot, entityId);
    expect(chilled?.baseSpeed).toBe(1);
    expect(chilled?.speed).toBeCloseTo(1 - 2 * 0.12, 5);

    afflict(world, slot, 'freeze', 1);
    expect(enemyInfo(world, slot, entityId)?.speed).toBe(0);
  });

  it('lists each status with its stacks and the time it has left', () => {
    const world = freshWorld();
    const { slot, entityId } = spawn(world, 'husk');
    afflict(world, slot, 'scorch', 3, 1.5);

    expect(enemyInfo(world, slot, entityId)?.statuses).toEqual([
      { id: 'scorch', stacks: 3, secondsLeft: 1.5 },
    ]);
  });
});

describe('never describing the wrong enemy', () => {
  it('answers nothing once the enemy has died, even before its slot is freed', () => {
    const world = freshWorld();
    const { slot, entityId } = spawn(world, 'husk');
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Dying;
    expect(enemyInfo(world, slot, entityId)).toBeNull();
  });

  it('answers nothing once it has reached the core', () => {
    const world = freshWorld();
    const { slot, entityId } = spawn(world, 'husk');
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;
    expect(enemyInfo(world, slot, entityId)).toBeNull();
  });

  /* The case the entity id exists for. */
  it('answers nothing when its slot now holds a different enemy', () => {
    const world = freshWorld();
    const first = spawn(world, 'husk');
    world.enemies.free(first.slot);
    const second = spawn(world, 'riftling');

    expect(second.slot).toBe(first.slot);
    expect(enemyInfo(world, first.slot, first.entityId)).toBeNull();
    expect(enemyInfo(world, second.slot, second.entityId)?.enemyId).toBe('riftling');
  });
});

describe('finding the enemy under a tap', () => {
  function placed(world: World, id: string, x: number, y: number): number {
    const { slot } = spawn(world, id);
    world.enemies.x[slot] = x;
    world.enemies.y[slot] = y;
    return slot;
  }

  it('picks the nearest enemy within reach', () => {
    const world = freshWorld();
    placed(world, 'husk', 100, 100);
    const near = placed(world, 'riftling', 120, 100);

    expect(enemyNear(world, 125, 100, TILE_SIZE / 2)).toBe(near);
  });

  it('finds nothing beyond reach', () => {
    const world = freshWorld();
    placed(world, 'husk', 100, 100);
    expect(enemyNear(world, 200, 100, TILE_SIZE / 2)).toBe(-1);
  });

  it('passes over an enemy that is already dying', () => {
    const world = freshWorld();
    const dying = placed(world, 'husk', 100, 100);
    world.enemies.flags[dying] = (world.enemies.flags[dying] as number) | EnemyFlag.Dying;
    expect(enemyNear(world, 100, 100, TILE_SIZE / 2)).toBe(-1);
  });

  it('passes over one underground, which is not drawn', () => {
    const world = freshWorld();
    const burrowed = placed(world, 'husk', 100, 100);
    world.enemies.flags[burrowed] = (world.enemies.flags[burrowed] as number) | EnemyFlag.Burrowed;
    expect(enemyNear(world, 100, 100, TILE_SIZE / 2)).toBe(-1);
  });
});
