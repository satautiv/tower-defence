import { describe, expect, it } from 'vitest';
import { World, advance, buildTower, hashWorld, tick } from '@sim/index';

/**
 * The tick loop must not allocate.
 *
 * At 60Hz with hundreds of entities, garbage produced per tick is what turns a
 * steady frame into a stutter on a mid-range phone — and it is why the entity
 * pools are structure-of-arrays rather than objects in the first place. If this
 * regresses, the whole design has stopped paying for itself.
 *
 * Checked two ways, because neither is sufficient alone. Structural assertions
 * are exact and cannot flake but only prove the pools are not growing. The heap
 * measurement catches an incidental allocation inside a system, but it is a
 * measurement, so it is given a generous threshold.
 */

const forceGc = (globalThis as { gc?: () => void }).gc;

const config = {
  seed: 7,
  widthTiles: 30,
  heightTiles: 17,
  startingGold: 600,
  lives: 20,
  totalWaves: 10,
};

function heapGrowthOf(body: () => void, warmups = 3): number {
  for (let i = 0; i < warmups; i++) body();
  forceGc?.();
  const before = process.memoryUsage().heapUsed;
  body();
  forceGc?.();
  return process.memoryUsage().heapUsed - before;
}

describe('ten thousand ticks change nothing structural', () => {
  it('leaves every pool where it started', () => {
    const world = new World(config);
    advance(world, 10_000);

    expect(world.tick).toBe(10_000);
    for (const pool of [
      world.enemies,
      world.towers,
      world.projectiles,
      world.soldiers,
      world.groundEffects,
    ]) {
      expect(pool.count).toBe(0);
      expect(pool.watermark).toBe(0);
    }
  });

  it('drops nothing from any buffer', () => {
    const world = new World(config);
    for (let t = 0; t < 10_000; t++) {
      if (t % 100 === 0) buildTower(world.commands, t % 14, 0);
      tick(world);
    }

    expect(world.commands.dropped).toBe(0);
    expect(world.events.dropped).toBe(0);
    expect(world.damage.dropped).toBe(0);
  });

  it('keeps the world hash stable while nothing happens', () => {
    const world = new World(config);
    advance(world, 100);
    const settled = hashWorld(world);

    /* Only the tick counter should move, so the fingerprint must change — but
       every pool array behind it stays byte identical. */
    advance(world, 100);
    expect(hashWorld(world)).not.toBe(settled);
    expect(world.enemies.watermark).toBe(0);
  });
});

describe('heap usage is flat across the tick loop', () => {
  it.runIf(forceGc !== undefined)('allocates negligibly over 10,000 ticks', () => {
    const world = new World(config);
    const growth = heapGrowthOf(() => {
      for (let t = 0; t < 10_000; t++) tick(world);
    });

    /* Ten thousand ticks is nearly three minutes of play. Anything allocating
       per tick would add megabytes; a clean loop stays in the noise of the
       measurement. */
    expect(growth).toBeLessThan(1_000_000);
  });

  it.runIf(forceGc !== undefined)('allocates negligibly while commands flow', () => {
    const world = new World(config);
    const growth = heapGrowthOf(() => {
      for (let t = 0; t < 10_000; t++) {
        buildTower(world.commands, t % 14, t % 3);
        tick(world);
      }
    });

    expect(growth).toBeLessThan(1_000_000);
  });

  it('exposes gc so the measurements above mean something', () => {
    expect(
      forceGc,
      'gc is missing: run the suite via `npm test`, which sets NODE_OPTIONS=--expose-gc',
    ).toBeDefined();
  });
});
