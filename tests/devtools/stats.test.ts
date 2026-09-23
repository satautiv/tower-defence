import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  DAMAGE_INDEX,
  MAX_EVENTS_PER_TICK,
  callWave,
  createWorldForStage,
  enemyIndex,
  spawnEnemy,
  startWave,
  targetingSystem,
  tick,
} from '@sim/index';
import type { World } from '@sim/index';
import { freshPeaks, readDevStats, sampleCommands, samplePeaks } from '@devtools/stats';

/**
 * What the overlay counts (#41).
 *
 * Every number here exists to answer one question: is anything about to hit a
 * ceiling? The pools never grow — `alloc` returns -1 when full and the entity
 * simply does not spawn — and the spatial hash and the event buffer both drop
 * past capacity. Those failures are invisible from inside the game and look
 * like balance problems from outside it ("the wave got easier at three hundred
 * enemies"), which is why the capacity is reported beside the count.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const fresh = (): World => createWorldForStage(registry, stage, 9);

describe('pool counts', () => {
  it('names every pool the world holds', () => {
    const stats = readDevStats(fresh(), freshPeaks());
    expect(stats.pools.map((pool) => pool.name)).toEqual([
      'enemies',
      'towers',
      'projectiles',
      'soldiers',
      'ground fx',
    ]);
  });

  it('counts what is alive, against what the pool can hold', () => {
    const world = fresh();
    for (let i = 0; i < 4; i++) spawnEnemy(world, enemyIndex(world, 'riftling'), 0);

    const enemies = readDevStats(world, freshPeaks()).pools[0];
    expect(enemies?.live).toBe(4);
    expect(enemies?.capacity).toBeGreaterThan(4);
    expect(enemies?.full).toBe(false);
  });

  /**
   * The watermark, not the count.
   *
   * Iteration is always `0..watermark` with an alive check, so the cost of a
   * system is the high-water mark rather than what is alive now: a wave that
   * peaked at three hundred still costs three hundred slots to walk once it is
   * down to two.
   */
  it('reports the high-water mark, which is what iteration costs', () => {
    const world = fresh();
    const slots = [0, 1, 2].map(() => spawnEnemy(world, enemyIndex(world, 'riftling'), 0));
    for (const slot of slots) world.enemies.free(slot);

    const enemies = readDevStats(world, freshPeaks()).pools[0];
    expect(enemies?.live).toBe(0);
    expect(enemies?.watermark).toBe(3);
  });
});

describe('spatial hash occupancy', () => {
  it('reports both indexes, because a tower only ever scans one', () => {
    const stats = readDevStats(fresh(), freshPeaks());
    expect(stats.hashes.map((hash) => hash.name)).toEqual(['ground', 'air']);
  });

  /* Rebuilt at step 7 of the pipeline, so nothing is in it until the targeting
     system has run — which is the same reason a test that places enemies by
     hand has to call `targetingSystem` before anything can find them. */
  it('is empty until the indexes are rebuilt', () => {
    const world = fresh();
    for (let i = 0; i < 5; i++) {
      const slot = spawnEnemy(world, enemyIndex(world, 'riftling'), 0);
      world.enemies.x[slot] = 200 + i * 40;
      world.enemies.y[slot] = 200;
    }
    expect(readDevStats(world, freshPeaks()).hashes[0]?.size).toBe(0);

    targetingSystem(world);
    const ground = readDevStats(world, freshPeaks()).hashes[0];
    expect(ground?.size).toBe(5);
    expect(ground?.occupied).toBeGreaterThan(0);
    expect(ground?.largestCell).toBeGreaterThan(0);
    expect(ground?.cells).toBeGreaterThan(ground?.occupied ?? 0);
  });
});

describe('buffer volume', () => {
  it('reports capacity beside the count, because the ceiling is the point', () => {
    const events = readDevStats(fresh(), freshPeaks()).buffers[0];
    expect(events?.name).toBe('events');
    expect(events?.capacity).toBe(MAX_EVENTS_PER_TICK);
    expect(events?.dropped).toBe(0);
  });

  /**
   * The peak is the only reading that survives the frame.
   *
   * The event buffer is cleared once every consumer has drained it, so a panel
   * polling the world at 10Hz reads an empty one every time — which would
   * report a game where nothing ever happens. Sampling inside the frame is not
   * an optimisation here; it is the only way the number exists.
   */
  it('remembers the busiest frame, which polling could never see', () => {
    const world = fresh();
    const peaks = freshPeaks();

    startWave(world, 0);
    let busiest = 0;
    for (let i = 0; i < 200; i++) {
      tick(world);
      busiest = Math.max(busiest, world.events.count);
      samplePeaks(world, peaks);
      world.events.clear();
    }

    expect(busiest).toBeGreaterThan(0);
    const events = readDevStats(world, peaks).buffers[0];
    expect(events?.count).toBe(0);
    expect(events?.peak).toBe(busiest);
  });

  /**
   * The three buffers empty at three different moments, and getting that wrong
   * is silent.
   *
   * The first draft sampled all three after the tick and reported a game that
   * had never issued a command and never dealt any damage — both readings were
   * zero for the whole run, and nothing about a zero says it was taken at the
   * wrong time. Commands are drained at step 0 of the tick, so they are
   * sampled in the pre-tick hook; the damage queue is filled *and* drained
   * inside one tick, so there is no moment outside one where it holds
   * anything, and it keeps its own high-water mark instead.
   */
  it('catches the commands before the tick drains them', () => {
    const world = fresh();
    const peaks = freshPeaks();

    callWave(world.commands);
    /* Where a panel polling the world would look — and find nothing. */
    tick(world);
    samplePeaks(world, peaks);
    expect(peaks.commands).toBe(0);

    callWave(world.commands);
    sampleCommands(world, peaks);
    tick(world);
    expect(peaks.commands).toBe(1);
  });

  it('reads the damage queue off its own high-water mark', () => {
    const world = fresh();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    for (let i = 0; i < 7; i++) world.damage.push(slot, 1, DAMAGE_INDEX.true, -1);

    /* Nothing outside the tick can see this, so the queue has to say. */
    tick(world);
    const damage = readDevStats(world, freshPeaks()).buffers[2];
    expect(damage?.count).toBe(0);
    expect(damage?.peak).toBeGreaterThanOrEqual(7);
  });
});
