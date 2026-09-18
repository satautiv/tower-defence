import { describe, expect, it } from 'vitest';
import { Rng } from '@core/rng';
import { SpatialHash } from '@core/spatial';
import { distanceSqXY } from '@core/vec';

interface Point {
  id: number;
  x: number;
  y: number;
}

/** The obvious O(n) answer, used as the oracle the hash must agree with. */
function bruteForce(points: readonly Point[], x: number, y: number, radius: number): number[] {
  const r2 = radius * radius;
  return points.filter((p) => distanceSqXY(x, y, p.x, p.y) <= r2).map((p) => p.id);
}

const sorted = (a: readonly number[]) => [...a].sort((m, n) => m - n);

describe('SpatialHash', () => {
  it('rejects a non-positive cell size', () => {
    expect(() => new SpatialHash(0, 100, 100, 10)).toThrow(RangeError);
  });

  it('agrees with brute force across 200 randomised layouts', () => {
    const rng = new Rng(20260918);
    const WORLD = 1920;
    const CAPACITY = 400;

    for (let trial = 0; trial < 200; trial++) {
      const hash = new SpatialHash(128, WORLD, WORLD, CAPACITY);
      const points: Point[] = [];
      const n = rng.int(0, 300);

      for (let i = 0; i < n; i++) {
        const p = { id: i, x: rng.range(0, WORLD), y: rng.range(0, WORLD) };
        points.push(p);
        hash.insert(p.id, p.x, p.y);
      }

      const out = new Int32Array(CAPACITY);
      for (let q = 0; q < 5; q++) {
        const qx = rng.range(0, WORLD);
        const qy = rng.range(0, WORLD);
        const radius = rng.range(1, 400);

        const found = sorted(Array.from(out.subarray(0, hash.query(qx, qy, radius, out))));
        expect(found).toEqual(sorted(bruteForce(points, qx, qy, radius)));
        expect(hash.didTruncate).toBe(false);
      }
    }
  });

  it('finds entities whose cell differs from the query cell', () => {
    const hash = new SpatialHash(64, 640, 640, 16);
    hash.insert(1, 63, 63);
    hash.insert(2, 65, 65);

    const out = new Int32Array(16);
    expect(sorted(Array.from(out.subarray(0, hash.query(64, 64, 4, out))))).toEqual([1, 2]);
  });

  it('excludes entities just outside the radius', () => {
    const hash = new SpatialHash(64, 640, 640, 16);
    hash.insert(1, 100, 0);
    const out = new Int32Array(16);
    expect(hash.query(0, 0, 99.9, out)).toBe(0);
    expect(hash.query(0, 0, 100, out)).toBe(1);
  });

  it('still finds entities that have drifted outside the world bounds', () => {
    const hash = new SpatialHash(64, 640, 640, 16);
    hash.insert(7, -50, -50);
    hash.insert(8, 900, 900);

    const out = new Int32Array(16);
    expect(hash.query(-50, -50, 10, out)).toBe(1);
    expect(out[0]).toBe(7);
    expect(hash.query(900, 900, 10, out)).toBe(1);
    expect(out[0]).toBe(8);
  });

  it('reports truncation rather than silently returning a short result', () => {
    const hash = new SpatialHash(64, 640, 640, 32);
    for (let i = 0; i < 20; i++) hash.insert(i, 100, 100);

    const small = new Int32Array(5);
    expect(hash.query(100, 100, 50, small)).toBe(5);
    expect(hash.didTruncate).toBe(true);

    const big = new Int32Array(32);
    expect(hash.query(100, 100, 50, big)).toBe(20);
    expect(hash.didTruncate).toBe(false);
  });

  it('reports overflow when more entities are inserted than it can hold', () => {
    const hash = new SpatialHash(64, 640, 640, 2);
    hash.insert(1, 10, 10);
    hash.insert(2, 20, 20);
    expect(hash.didOverflow).toBe(false);
    hash.insert(3, 30, 30);
    expect(hash.didOverflow).toBe(true);
    expect(hash.size).toBe(2);
  });

  it('handles an empty world and a zero-length output buffer', () => {
    const hash = new SpatialHash(64, 640, 640, 8);
    expect(hash.query(10, 10, 100, new Int32Array(8))).toBe(0);

    hash.insert(1, 10, 10);
    expect(hash.query(10, 10, 100, new Int32Array(0))).toBe(0);
  });

  it('empties on clear and can be refilled', () => {
    const hash = new SpatialHash(64, 640, 640, 8);
    hash.insert(1, 10, 10);
    hash.clear();

    const out = new Int32Array(8);
    expect(hash.size).toBe(0);
    expect(hash.query(10, 10, 100, out)).toBe(0);

    hash.insert(2, 10, 10);
    expect(hash.query(10, 10, 100, out)).toBe(1);
    expect(out[0]).toBe(2);
  });

  it('reports occupancy for the dev overlay', () => {
    const hash = new SpatialHash(64, 640, 640, 16);
    hash.insert(1, 10, 10);
    hash.insert(2, 12, 12);
    hash.insert(3, 400, 400);

    const stats = hash.stats();
    expect(stats.cells).toBe(100);
    expect(stats.occupied).toBe(2);
    expect(stats.largestCell).toBe(2);
  });
});
