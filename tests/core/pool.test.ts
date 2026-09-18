import { describe, expect, it } from 'vitest';
import { Pool, SlotAllocator } from '@core/pool';

interface Box {
  value: number;
}

const makePool = (prefill = 0) =>
  new Pool<Box>(
    () => ({ value: 0 }),
    (b) => {
      b.value = 0;
    },
    prefill,
  );

describe('Pool', () => {
  it('prefills without checking anything out', () => {
    const pool = makePool(4);
    expect(pool.capacity).toBe(4);
    expect(pool.available).toBe(4);
    expect(pool.inUse).toBe(0);
  });

  it('reuses released objects instead of constructing new ones', () => {
    const pool = makePool();
    const first = pool.acquire();
    pool.release(first);
    expect(pool.acquire()).toBe(first);
    expect(pool.capacity).toBe(1);
  });

  it('resets on release, so a freed object holds nothing', () => {
    const pool = makePool();
    const box = pool.acquire();
    box.value = 42;
    pool.release(box);
    expect(box.value).toBe(0);
  });

  it('stops growing once it reaches steady state', () => {
    const pool = makePool();
    const live: Box[] = [];
    for (let i = 0; i < 8; i++) live.push(pool.acquire());
    for (const b of live) pool.release(b);
    const settled = pool.capacity;

    for (let cycle = 0; cycle < 1000; cycle++) {
      const batch = [pool.acquire(), pool.acquire(), pool.acquire()];
      for (const b of batch) pool.release(b);
    }
    expect(pool.capacity).toBe(settled);
  });

  it('tracks how many objects are checked out', () => {
    const pool = makePool();
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.inUse).toBe(2);
    pool.release(a);
    expect(pool.inUse).toBe(1);
    pool.release(b);
    expect(pool.inUse).toBe(0);
  });
});

describe('SlotAllocator', () => {
  it('hands out consecutive slots from empty', () => {
    const slots = new SlotAllocator(4);
    expect([slots.alloc(), slots.alloc(), slots.alloc()]).toEqual([0, 1, 2]);
    expect(slots.inUse).toBe(3);
    expect(slots.watermark).toBe(3);
  });

  it('reuses a freed slot before extending the watermark', () => {
    const slots = new SlotAllocator(4);
    slots.alloc();
    const second = slots.alloc();
    slots.free(second);
    expect(slots.alloc()).toBe(second);
    expect(slots.watermark).toBe(2);
  });

  it('returns -1 when exhausted rather than handing out an invalid slot', () => {
    const slots = new SlotAllocator(2);
    expect(slots.alloc()).toBe(0);
    expect(slots.alloc()).toBe(1);
    expect(slots.alloc()).toBe(-1);
    expect(slots.inUse).toBe(2);
  });

  it('bumps the generation on free, so stale indices are detectable', () => {
    const slots = new SlotAllocator(2);
    const slot = slots.alloc();
    const before = slots.generationOf(slot);
    slots.free(slot);
    expect(slots.generationOf(slot)).toBe(before + 1);
  });

  it('ignores out-of-range frees instead of corrupting the free list', () => {
    const slots = new SlotAllocator(2);
    slots.alloc();
    slots.free(-1);
    slots.free(99);
    expect(slots.alloc()).toBe(1);
    expect(slots.alloc()).toBe(-1);
  });

  it('clears back to empty', () => {
    const slots = new SlotAllocator(3);
    slots.alloc();
    slots.alloc();
    slots.clear();
    expect(slots.inUse).toBe(0);
    expect(slots.alloc()).toBe(0);
  });
});
