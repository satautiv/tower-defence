import { describe, expect, it } from 'vitest';
import { EventBuffer } from '@core/events';
import { FixedStepLoop } from '@core/loop';
import { Pool, SlotAllocator } from '@core/pool';
import { Rng } from '@core/rng';
import { SpatialHash } from '@core/spatial';

/**
 * The simulation runs 60 times a second with hundreds of live entities. Garbage
 * produced per tick is what turns a steady frame into a stutter on a mid-range
 * phone, so the core primitives must reach a steady state where they allocate
 * nothing at all.
 *
 * Two kinds of check here, because neither is sufficient alone:
 *
 *  - Structural assertions are exact and can never flake: a pool that stopped
 *    growing did stop growing. They prove the design is right but cannot catch
 *    an incidental allocation inside a method.
 *  - The heap measurement catches those, but is a measurement, so it is given a
 *    generous threshold and only runs where a forced GC is available.
 */

const forceGc = (globalThis as { gc?: () => void }).gc;

/** Heap growth in bytes across `body`, with collections either side. */
function heapGrowthOf(body: () => void, warmupRuns = 3): number {
  for (let i = 0; i < warmupRuns; i++) body();
  forceGc?.();
  const before = process.memoryUsage().heapUsed;
  body();
  forceGc?.();
  return process.memoryUsage().heapUsed - before;
}

/* One frame's worth of the work the simulation actually does: rebuild the
   spatial index, run range queries against it, emit events, cycle pooled
   objects and advance the clock. */
function simulatedFrame(ctx: {
  hash: SpatialHash;
  events: EventBuffer;
  pool: Pool<{ x: number; y: number }>;
  out: Int32Array;
  rng: Rng;
  loop: FixedStepLoop;
  now: { value: number };
}): void {
  const { hash, events, pool, out, rng, loop, now } = ctx;

  hash.clear();
  for (let i = 0; i < 300; i++) hash.insert(i, rng.range(0, 1920), rng.range(0, 1080));

  for (let tower = 0; tower < 60; tower++) {
    const found = hash.query(rng.range(0, 1920), rng.range(0, 1080), 400, out);
    for (let i = 0; i < found; i++) events.push(1, out[i] as number, tower);
  }

  for (let i = 0; i < 100; i++) {
    const obj = pool.acquire();
    obj.x = i;
    pool.release(obj);
  }

  now.value += 16;
  loop.advance(now.value);
  events.clear();
}

function makeContext() {
  return {
    hash: new SpatialHash(128, 1920, 1080, 512),
    events: new EventBuffer(4096),
    pool: new Pool(
      () => ({ x: 0, y: 0 }),
      (o) => {
        o.x = 0;
        o.y = 0;
      },
      64,
    ),
    out: new Int32Array(512),
    rng: new Rng(4242),
    loop: new FixedStepLoop(),
    now: { value: 0 },
  };
}

describe('steady state does not grow', () => {
  it('leaves the object pool at a fixed capacity', () => {
    const pool = new Pool<{ v: number }>(
      () => ({ v: 0 }),
      (o) => {
        o.v = 0;
      },
    );
    const live = Array.from({ length: 50 }, () => pool.acquire());
    for (const o of live) pool.release(o);
    const settled = pool.capacity;

    for (let i = 0; i < 100_000; i++) pool.release(pool.acquire());
    expect(pool.capacity).toBe(settled);
  });

  it('leaves the slot allocator watermark where it settled', () => {
    const slots = new SlotAllocator(128);
    const held = Array.from({ length: 64 }, () => slots.alloc());
    for (const s of held) slots.free(s);
    const settled = slots.watermark;

    for (let i = 0; i < 100_000; i++) slots.free(slots.alloc());
    expect(slots.watermark).toBe(settled);
    expect(slots.inUse).toBe(0);
  });

  it('leaves the event buffer at a fixed capacity and drops nothing', () => {
    const events = new EventBuffer(512);
    for (let frame = 0; frame < 20_000; frame++) {
      for (let i = 0; i < 400; i++) events.push(1, i);
      events.clear();
    }
    expect(events.capacity).toBe(512);
    expect(events.dropped).toBe(0);
  });

  it('keeps the spatial hash bounded across rebuild cycles', () => {
    const hash = new SpatialHash(128, 1920, 1080, 512);
    const out = new Int32Array(512);
    const rng = new Rng(7);

    for (let frame = 0; frame < 2000; frame++) {
      hash.clear();
      for (let i = 0; i < 300; i++) hash.insert(i, rng.range(0, 1920), rng.range(0, 1080));
      hash.query(960, 540, 300, out);
    }
    expect(hash.size).toBe(300);
    expect(hash.didOverflow).toBe(false);
  });
});

describe('heap usage is stable under a simulated frame loop', () => {
  it.runIf(forceGc !== undefined)('allocates negligibly across 600 frames', () => {
    const ctx = makeContext();
    const growth = heapGrowthOf(() => {
      for (let frame = 0; frame < 600; frame++) simulatedFrame(ctx);
    });

    /* 600 frames is ten seconds of play. Anything genuinely allocating
       per-entity per-frame would add megabytes here; a steady-state
       implementation stays in the noise of the measurement itself. */
    expect(growth).toBeLessThan(2_000_000);
  });

  it('exposes gc so the measurement above is meaningful', () => {
    expect(
      forceGc,
      'gc is missing: run the suite via `npm test`, which sets NODE_OPTIONS=--expose-gc',
    ).toBeDefined();
  });
});
