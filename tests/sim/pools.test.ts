import { describe, expect, it } from 'vitest';
import { EnemyPool, MAX_ENEMIES, ProjectilePool, STATUS_COUNT, TowerPool } from '@sim/index';

describe('slot allocation', () => {
  it('hands out consecutive slots and counts them', () => {
    const pool = new EnemyPool();
    expect([pool.alloc(), pool.alloc(), pool.alloc()]).toEqual([0, 1, 2]);
    expect(pool.count).toBe(3);
    expect(pool.watermark).toBe(3);
  });

  it('recycles a freed slot before extending the watermark', () => {
    const pool = new EnemyPool();
    pool.alloc();
    const second = pool.alloc();
    pool.free(second);

    expect(pool.alloc()).toBe(second);
    expect(pool.watermark).toBe(2);
  });

  it('marks slots alive and dead', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    expect(pool.isAlive(slot)).toBe(true);
    pool.free(slot);
    expect(pool.isAlive(slot)).toBe(false);
  });

  it('treats out-of-range slots as dead rather than throwing', () => {
    const pool = new EnemyPool();
    expect(pool.isAlive(-1)).toBe(false);
    expect(pool.isAlive(MAX_ENEMIES + 10)).toBe(false);
  });

  it('ignores a double free instead of corrupting the count', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    pool.free(slot);
    pool.free(slot);

    expect(pool.count).toBe(0);
    expect(pool.alloc()).toBe(slot);
    expect(pool.count).toBe(1);
  });

  /* Full means dropped, never grown: reallocating a typed array mid-wave is the
     GC pause the whole design exists to avoid. */
  it('returns -1 when full rather than growing', () => {
    const pool = new ProjectilePool(4);
    for (let i = 0; i < 4; i++) expect(pool.alloc()).toBeGreaterThanOrEqual(0);

    expect(pool.alloc()).toBe(-1);
    expect(pool.count).toBe(4);
    expect(pool.capacity).toBe(4);
  });

  it('accepts new entities again once something frees a slot', () => {
    const pool = new ProjectilePool(2);
    const a = pool.alloc();
    pool.alloc();
    expect(pool.alloc()).toBe(-1);

    pool.free(a);
    expect(pool.alloc()).toBe(a);
  });
});

describe('entity identity', () => {
  /**
   * Slots are reused, so a slot number alone cannot identify an entity over
   * time. Ids are what a projectile, an event or a save refers to, and two live
   * entities sharing one would send damage to the wrong target.
   */
  it('never issues the same id to two live entities', () => {
    const pool = new EnemyPool();
    const seen = new Set<number>();

    for (let round = 0; round < 500; round++) {
      const slots = [pool.alloc(), pool.alloc(), pool.alloc()];
      for (const slot of slots) {
        const id = pool.ids[slot] as number;
        expect(seen.has(id), `id ${id} reissued`).toBe(false);
        seen.add(id);
      }
      for (const slot of slots) pool.free(slot);
    }

    expect(seen.size).toBe(1500);
  });

  it('gives a recycled slot a fresh id', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    const first = pool.ids[slot];
    pool.free(slot);

    expect(pool.alloc()).toBe(slot);
    expect(pool.ids[slot]).not.toBe(first);
  });

  it('zeroes the id of a freed slot', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    pool.free(slot);
    expect(pool.ids[slot]).toBe(0);
  });
});

describe('slots are clean when handed out', () => {
  /* A recycled slot inheriting the previous occupant's values shows up as an
     enemy spawning with the last one's remaining health. */
  it('resets every field a previous occupant wrote', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();

    pool.hp[slot] = 250;
    pool.pathDist[slot] = 12.5;
    pool.armour[slot] = 40;
    pool.blockedBy[slot] = 7;
    pool.statusStacks[slot * STATUS_COUNT + 1] = 5;
    pool.statusExpiry[slot * STATUS_COUNT + 1] = 999;
    pool.free(slot);

    expect(pool.alloc()).toBe(slot);
    expect(pool.hp[slot]).toBe(0);
    expect(pool.pathDist[slot]).toBe(0);
    expect(pool.armour[slot]).toBe(0);
    expect(pool.statusStacks[slot * STATUS_COUNT + 1]).toBe(0);
    expect(pool.statusExpiry[slot * STATUS_COUNT + 1]).toBe(0);
  });

  it('resets references to other entities to -1, not 0, which is a valid slot', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    expect(pool.blockedBy[slot]).toBe(-1);

    const towers = new TowerPool();
    const tower = towers.alloc();
    expect(towers.target[tower]).toBe(-1);
    expect(towers.specialisation[tower]).toBe(-1);
  });

  it('gives ground effects a neutral slow multiplier rather than zero', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    expect(pool.laneOffset[slot]).toBe(0);
    expect(pool.speed[slot]).toBe(0);
  });
});

describe('status storage', () => {
  it('gives each entity its own contiguous block', () => {
    const pool = new EnemyPool();
    const a = pool.alloc();
    const b = pool.alloc();

    pool.statusStacks[a * STATUS_COUNT + 0] = 3;
    pool.statusStacks[b * STATUS_COUNT + 0] = 5;

    expect(pool.stacksOf(a, 0)).toBe(3);
    expect(pool.stacksOf(b, 0)).toBe(5);
  });

  it('sizes the block from the content status list, so the two cannot drift', () => {
    const pool = new EnemyPool();
    expect(pool.statusStacks.length).toBe(pool.capacity * STATUS_COUNT);
    expect(pool.statusExpiry.length).toBe(pool.capacity * STATUS_COUNT);
  });
});

describe('clear', () => {
  it('empties the pool and restarts identification', () => {
    const pool = new EnemyPool();
    pool.alloc();
    pool.alloc();
    pool.clear();

    expect(pool.count).toBe(0);
    expect(pool.watermark).toBe(0);
    expect(pool.alloc()).toBe(0);
    expect(pool.ids[0]).toBe(1);
  });

  it('wipes status blocks, not just the slot table', () => {
    const pool = new EnemyPool();
    const slot = pool.alloc();
    pool.statusStacks[slot * STATUS_COUNT + 2] = 4;
    pool.clear();
    expect(pool.statusStacks[slot * STATUS_COUNT + 2]).toBe(0);
  });
});
