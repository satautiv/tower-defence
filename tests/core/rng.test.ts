import { describe, expect, it } from 'vitest';
import { Rng, seedFrom } from '@core/rng';

describe('Rng determinism', () => {
  it('produces an identical 10,000-value sequence from the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 10_000; i++) {
      expect(b.next()).toBe(a.next());
    }
  });

  it('diverges for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let identical = 0;
    for (let i = 0; i < 1000; i++) if (a.next() === b.next()) identical++;
    expect(identical).toBeLessThan(5);
  });

  it('resumes an identical sequence from a restored state', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 50; i++) rng.next();

    const saved = rng.getState();
    const expected = Array.from({ length: 100 }, () => rng.next());

    rng.setState(saved);
    const replayed = Array.from({ length: 100 }, () => rng.next());
    expect(replayed).toEqual(expected);
  });

  it('clones without the copies affecting each other', () => {
    const original = new Rng(7);
    original.next();
    const copy = original.clone();

    const fromOriginal = Array.from({ length: 20 }, () => original.next());
    const fromCopy = Array.from({ length: 20 }, () => copy.next());
    expect(fromCopy).toEqual(fromOriginal);
  });
});

describe('Rng distribution', () => {
  it('is uniform across ten buckets over 200,000 samples', () => {
    const rng = new Rng(2026);
    const buckets = new Array<number>(10).fill(0);
    const samples = 200_000;

    for (let i = 0; i < samples; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]!++;
    }

    const expected = samples / 10;
    for (const count of buckets) {
      /* Tolerance is ~5 standard deviations for this sample size, so a healthy
         generator effectively never trips it while a biased one always will. */
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.03);
    }
  });

  it('keeps int() inside its half-open range', () => {
    const rng = new Rng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('treats an empty or inverted int() span as the minimum', () => {
    const rng = new Rng(5);
    expect(rng.int(4, 4)).toBe(4);
    expect(rng.int(9, 2)).toBe(9);
  });

  it('keeps range() inside its bounds', () => {
    const rng = new Rng(11);
    for (let i = 0; i < 5000; i++) {
      const v = rng.range(-2.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4.5);
    }
  });
});

describe('Rng selection', () => {
  it('throws rather than returning undefined for an empty list', () => {
    const rng = new Rng(1);
    expect(() => rng.pick([])).toThrow(RangeError);
    expect(() => rng.pickWeighted([], [])).toThrow(RangeError);
  });

  it('rejects mismatched items and weights', () => {
    const rng = new Rng(1);
    expect(() => rng.pickWeighted(['a', 'b'], [1])).toThrow(RangeError);
  });

  it('respects weights', () => {
    const rng = new Rng(42);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) counts[rng.pickWeighted(['a', 'b'] as const, [3, 1])]++;
    const ratio = counts.a / (counts.a + counts.b);
    expect(ratio).toBeGreaterThan(0.72);
    expect(ratio).toBeLessThan(0.78);
  });

  it('never selects a zero-weighted item', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 2000; i++) {
      expect(rng.pickWeighted(['skip', 'take'] as const, [0, 1])).toBe('take');
    }
  });

  it('falls back to a uniform pick when every weight is zero', () => {
    const rng = new Rng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pickWeighted(['a', 'b'] as const, [0, 0]));
    expect(seen.size).toBe(2);
  });

  it('shuffles into a permutation, deterministically', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = new Rng(8).shuffle([...source]);
    const second = new Rng(8).shuffle([...source]);
    expect(first).toEqual(second);
    expect([...first].sort((a, b) => a - b)).toEqual(source);
  });
});

describe('seedFrom', () => {
  it('is stable for the same string', () => {
    expect(seedFrom('stage-1-1')).toBe(seedFrom('stage-1-1'));
  });

  it('separates similar strings', () => {
    expect(seedFrom('stage-1-1')).not.toBe(seedFrom('stage-1-2'));
  });

  it('handles the empty string', () => {
    expect(Number.isInteger(seedFrom(''))).toBe(true);
  });
});
