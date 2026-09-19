import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '@core/constants';
import { TRIG_TABLE_SIZE, cosT, sinT } from '@core/trig';
import { Rng } from '@core/rng';
import { BakedPath, chooseBranch, laneOffsetFor } from '@sim/index';
import type { PathSample } from '@sim/index';

const out: PathSample = { x: 0, y: 0, dirX: 0, dirY: 0 };

/** An L: ten tiles right, then ten tiles down. */
const elbow = new BakedPath({
  id: 0,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  branches: [],
});

describe('baking', () => {
  it('converts authored tiles into world pixels', () => {
    expect(elbow.totalLength).toBeCloseTo(20 * TILE_SIZE, 4);
  });

  it('accumulates distance monotonically', () => {
    for (let i = 1; i < elbow.pointCount; i++) {
      expect(elbow.cumulative[i]!).toBeGreaterThan(elbow.cumulative[i - 1]!);
    }
  });

  it('handles a diagonal, where distance is not the sum of the axes', () => {
    const diagonal = new BakedPath({
      id: 0,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      branches: [],
    });
    expect(diagonal.totalLength).toBeCloseTo(5 * TILE_SIZE, 4);
  });
});

describe('sample', () => {
  it('starts at the first point', () => {
    elbow.sample(0, out);
    expect(out.x).toBeCloseTo(0, 4);
    expect(out.y).toBeCloseTo(0, 4);
  });

  it('ends at the last point', () => {
    elbow.sample(elbow.totalLength, out);
    expect(out.x).toBeCloseTo(10 * TILE_SIZE, 4);
    expect(out.y).toBeCloseTo(10 * TILE_SIZE, 4);
  });

  it('lands exactly on the corner at the segment boundary', () => {
    elbow.sample(10 * TILE_SIZE, out);
    expect(out.x).toBeCloseTo(10 * TILE_SIZE, 4);
    expect(out.y).toBeCloseTo(0, 4);
  });

  it('interpolates within the first segment', () => {
    elbow.sample(5 * TILE_SIZE, out);
    expect(out.x).toBeCloseTo(5 * TILE_SIZE, 4);
    expect(out.y).toBeCloseTo(0, 4);
  });

  it('interpolates within the second segment', () => {
    elbow.sample(15 * TILE_SIZE, out);
    expect(out.x).toBeCloseTo(10 * TILE_SIZE, 4);
    expect(out.y).toBeCloseTo(5 * TILE_SIZE, 4);
  });

  /* Extrapolating would send a leaked enemy drifting off the map forever. */
  it('clamps beyond either end rather than extrapolating', () => {
    elbow.sample(-500, out);
    expect(out.x).toBeCloseTo(0, 4);

    elbow.sample(elbow.totalLength * 10, out);
    expect(out.x).toBeCloseTo(10 * TILE_SIZE, 4);
    expect(out.y).toBeCloseTo(10 * TILE_SIZE, 4);
  });

  it('reports the direction of travel, which turns at the corner', () => {
    elbow.sample(5 * TILE_SIZE, out);
    expect(out.dirX).toBeCloseTo(1, 4);
    expect(out.dirY).toBeCloseTo(0, 4);

    elbow.sample(15 * TILE_SIZE, out);
    expect(out.dirX).toBeCloseTo(0, 4);
    expect(out.dirY).toBeCloseTo(1, 4);
  });

  it('returns a unit direction on every segment of a crooked path', () => {
    const crooked = new BakedPath({
      id: 0,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
        { x: 9, y: 12 },
        { x: 9, y: 0 },
      ],
      branches: [],
    });

    for (let d = 0; d <= crooked.totalLength; d += crooked.totalLength / 37) {
      crooked.sample(d, out);
      expect(Math.hypot(out.dirX, out.dirY)).toBeCloseTo(1, 4);
    }
  });

  /* A path is sampled once per enemy per tick; allocating here would allocate
     three hundred times a tick. */
  it('writes into the caller buffer and returns it', () => {
    expect(elbow.sample(100, out)).toBe(out);
  });

  it('survives a degenerate path whose points coincide', () => {
    const degenerate = new BakedPath({
      id: 0,
      points: [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      branches: [],
    });

    degenerate.sample(0, out);
    expect(Number.isNaN(out.x)).toBe(false);
    expect(Number.isNaN(out.dirX)).toBe(false);
  });
});

describe('burrow segments', () => {
  const burrower = new BakedPath({
    id: 0,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
    branches: [],
    burrowSegment: { fromTiles: 5, toTiles: 10 },
  });

  it('reports the authored range as underground', () => {
    expect(burrower.isBurrowed(4 * TILE_SIZE)).toBe(false);
    expect(burrower.isBurrowed(7 * TILE_SIZE)).toBe(true);
    expect(burrower.isBurrowed(11 * TILE_SIZE)).toBe(false);
  });

  it('includes both ends of the range', () => {
    expect(burrower.isBurrowed(5 * TILE_SIZE)).toBe(true);
    expect(burrower.isBurrowed(10 * TILE_SIZE)).toBe(true);
  });

  it('reports nothing burrowed on a path without a segment', () => {
    expect(elbow.isBurrowed(0)).toBe(false);
    expect(elbow.isBurrowed(elbow.totalLength / 2)).toBe(false);
  });
});

describe('branch selection', () => {
  const forked = new BakedPath({
    id: 0,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    branches: [
      { atDistanceTiles: 5, targetPathId: 1, weight: 1 },
      { atDistanceTiles: 5, targetPathId: 2, weight: 1 },
    ],
  });

  it('stays on the path when there is nothing to branch to', () => {
    expect(chooseBranch(elbow, new Rng(1))).toBe(elbow.id);
  });

  it('is reproducible from a seed', () => {
    const first = Array.from({ length: 200 }, () => 0);
    const a = new Rng(99);
    const b = new Rng(99);
    for (let i = 0; i < first.length; i++) first[i] = chooseBranch(forked, a);
    for (let i = 0; i < first.length; i++) expect(chooseBranch(forked, b)).toBe(first[i]);
  });

  it('reaches every branch and the original path', () => {
    const rng = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(chooseBranch(forked, rng));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('respects weights', () => {
    const weighted = new BakedPath({
      id: 0,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      branches: [{ atDistanceTiles: 5, targetPathId: 1, weight: 9 }],
    });

    const rng = new Rng(3);
    let toBranch = 0;
    for (let i = 0; i < 5000; i++) if (chooseBranch(weighted, rng) === 1) toBranch++;
    /* Weight 9 against the path's own implicit weight of 1. */
    expect(toBranch / 5000).toBeGreaterThan(0.85);
    expect(toBranch / 5000).toBeLessThan(0.95);
  });
});

describe('lane offsets', () => {
  /* Derived from the id, never the RNG: a visual detail must not consume the
     random stream and shift every later roll. */
  it('is stable for an id', () => {
    expect(laneOffsetFor(42, 40)).toBe(laneOffsetFor(42, 40));
  });

  it('spreads different ids apart', () => {
    const offsets = new Set<number>();
    for (let id = 1; id <= 50; id++) offsets.add(laneOffsetFor(id, 40));
    expect(offsets.size).toBeGreaterThan(45);
  });

  it('stays within half the lane either side', () => {
    for (let id = 1; id <= 2000; id++) {
      expect(Math.abs(laneOffsetFor(id, 40))).toBeLessThanOrEqual(20);
    }
  });

  it('uses both sides of the centre line', () => {
    let left = 0;
    let right = 0;
    for (let id = 1; id <= 1000; id++) {
      if (laneOffsetFor(id, 40) < 0) {
        left++;
      } else {
        right++;
      }
    }
    expect(left).toBeGreaterThan(300);
    expect(right).toBeGreaterThan(300);
  });
});

describe('table-driven trigonometry', () => {
  /* Math.sin may differ in its last bits between engines, and anything feeding
     a position feeds targeting, which decides what dies. */
  it('matches Math.sin within the table resolution', () => {
    for (let i = 0; i < 500; i++) {
      const angle = (i / 500) * Math.PI * 4 - Math.PI * 2;
      expect(sinT(angle)).toBeCloseTo(Math.sin(angle), 5);
      expect(cosT(angle)).toBeCloseTo(Math.cos(angle), 5);
    }
  });

  it('handles the cardinal angles', () => {
    expect(sinT(0)).toBeCloseTo(0, 6);
    expect(sinT(Math.PI / 2)).toBeCloseTo(1, 5);
    expect(sinT(Math.PI)).toBeCloseTo(0, 5);
    expect(cosT(0)).toBeCloseTo(1, 5);
  });

  it('folds large and negative angles instead of walking off the table', () => {
    expect(sinT(1000 * Math.PI + 0.3)).toBeCloseTo(Math.sin(1000 * Math.PI + 0.3), 4);
    expect(sinT(-5.5)).toBeCloseTo(Math.sin(-5.5), 5);
    expect(Number.isNaN(sinT(1e9))).toBe(false);
  });

  it('is bit-identical for the same input', () => {
    expect(sinT(1.2345)).toBe(sinT(1.2345));
    expect(TRIG_TABLE_SIZE).toBeGreaterThan(1000);
  });
});
