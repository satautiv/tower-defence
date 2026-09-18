import { describe, expect, it } from 'vitest';
import { EventBuffer } from '@core/events';

const KIND_SPAWNED = 1;
const KIND_DIED = 2;

describe('EventBuffer', () => {
  it('rejects a non-positive capacity', () => {
    expect(() => new EventBuffer(0)).toThrow(RangeError);
  });

  it('records what was written and reads it back in order', () => {
    const buf = new EventBuffer(8);
    buf.push(KIND_SPAWNED, 10, 20);
    buf.push(KIND_DIED, 11, 21, 31);

    expect(buf.count).toBe(2);
    expect(buf.at(0).kind).toBe(KIND_SPAWNED);
    expect(buf.at(0).a).toBe(10);
    expect(buf.at(1).kind).toBe(KIND_DIED);
    expect(buf.at(1).c).toBe(31);
  });

  it('hands back a record to fill rather than taking one to copy', () => {
    const buf = new EventBuffer(4);
    const record = buf.acquire(KIND_DIED);
    expect(record).not.toBeNull();
    record!.a = 7;
    record!.e = 9;
    expect(buf.at(0).a).toBe(7);
    expect(buf.at(0).e).toBe(9);
  });

  it('clears stale payload when a record is reused', () => {
    const buf = new EventBuffer(1);
    buf.push(KIND_SPAWNED, 1, 2, 3, 4, 5);
    buf.clear();
    const reused = buf.acquire(KIND_DIED);
    expect(reused).toEqual({ kind: KIND_DIED, a: 0, b: 0, c: 0, d: 0, e: 0 });
  });

  it('drops the newest event when full, keeping everything already recorded', () => {
    const buf = new EventBuffer(2);
    expect(buf.push(KIND_SPAWNED, 1)).toBe(true);
    expect(buf.push(KIND_SPAWNED, 2)).toBe(true);
    expect(buf.push(KIND_SPAWNED, 3)).toBe(false);

    expect(buf.count).toBe(2);
    expect(buf.at(0).a).toBe(1);
    expect(buf.at(1).a).toBe(2);
    expect(buf.dropped).toBe(1);
  });

  it('returns null from acquire when full', () => {
    const buf = new EventBuffer(1);
    buf.acquire(KIND_SPAWNED);
    expect(buf.acquire(KIND_SPAWNED)).toBeNull();
  });

  it('throws on an out-of-range read instead of returning a stale record', () => {
    const buf = new EventBuffer(4);
    buf.push(KIND_SPAWNED);
    expect(() => buf.at(1)).toThrow(RangeError);
    expect(() => buf.at(-1)).toThrow(RangeError);
  });

  it('keeps the drop count across clear, and loses it on reset', () => {
    const buf = new EventBuffer(1);
    buf.push(KIND_SPAWNED);
    buf.push(KIND_SPAWNED);
    expect(buf.dropped).toBe(1);

    buf.clear();
    expect(buf.dropped).toBe(1);

    buf.reset();
    expect(buf.dropped).toBe(0);
    expect(buf.count).toBe(0);
  });

  it('does not grow its record store across many drain cycles', () => {
    const buf = new EventBuffer(16);
    for (let frame = 0; frame < 5000; frame++) {
      for (let i = 0; i < 16; i++) buf.push(KIND_SPAWNED, i);
      buf.clear();
    }
    expect(buf.capacity).toBe(16);
    expect(buf.dropped).toBe(0);
  });
});
