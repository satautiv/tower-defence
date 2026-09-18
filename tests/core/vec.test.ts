import { describe, expect, it } from 'vitest';
import * as v from '@core/vec';

describe('vector operations write into the caller buffer', () => {
  it('returns the same object it was given', () => {
    const out = v.vec2();
    expect(v.add(out, v.vec2(1, 2), v.vec2(3, 4))).toBe(out);
    expect(out).toEqual({ x: 4, y: 6 });
  });

  it('supports aliasing the output with an input', () => {
    const a = v.vec2(1, 2);
    v.add(a, a, v.vec2(10, 20));
    expect(a).toEqual({ x: 11, y: 22 });
  });

  it('keeps perpendicular correct when output aliases input', () => {
    const a = v.vec2(1, 0);
    v.perpendicular(a, a);
    /* Compared numerically, not structurally: negating a zero component yields
       -0, which toEqual distinguishes from 0 but arithmetic does not. */
    expect(a.x).toBeCloseTo(0, 10);
    expect(a.y).toBeCloseTo(1, 10);
  });
});

describe('arithmetic', () => {
  it('subtracts and scales', () => {
    expect(v.sub(v.vec2(), v.vec2(5, 5), v.vec2(2, 1))).toEqual({ x: 3, y: 4 });
    expect(v.scale(v.vec2(), v.vec2(2, 3), 2)).toEqual({ x: 4, y: 6 });
  });

  it('addScaled steps along a direction', () => {
    expect(v.addScaled(v.vec2(), v.vec2(0, 0), v.vec2(1, 0), 2.5)).toEqual({ x: 2.5, y: 0 });
  });

  it('computes dot, length and distance', () => {
    expect(v.dot(v.vec2(1, 2), v.vec2(3, 4))).toBe(11);
    expect(v.length(v.vec2(3, 4))).toBe(5);
    expect(v.lengthSq(v.vec2(3, 4))).toBe(25);
    expect(v.distance(v.vec2(0, 0), v.vec2(3, 4))).toBe(5);
    expect(v.distanceSq(v.vec2(0, 0), v.vec2(3, 4))).toBe(25);
    expect(v.distanceSqXY(0, 0, 3, 4)).toBe(25);
  });

  it('agrees between squared and plain distance', () => {
    const a = v.vec2(1.5, -2.25);
    const b = v.vec2(-3.75, 6);
    expect(Math.sqrt(v.distanceSq(a, b))).toBeCloseTo(v.distance(a, b), 10);
  });
});

describe('normalize', () => {
  it('produces a unit vector', () => {
    const out = v.normalize(v.vec2(), v.vec2(3, 4));
    expect(v.length(out)).toBeCloseTo(1, 10);
  });

  it('leaves a zero vector at zero instead of producing NaN', () => {
    const out = v.normalize(v.vec2(), v.vec2(0, 0));
    expect(out).toEqual({ x: 0, y: 0 });
    expect(Number.isNaN(out.x)).toBe(false);
  });
});

describe('interpolation and comparison', () => {
  it('lerps vectors and scalars', () => {
    expect(v.lerpVec(v.vec2(), v.vec2(0, 0), v.vec2(10, 20), 0.5)).toEqual({ x: 5, y: 10 });
    expect(v.lerp(0, 10, 0.25)).toBe(2.5);
  });

  it('clamps', () => {
    expect(v.clamp(5, 0, 10)).toBe(5);
    expect(v.clamp(-1, 0, 10)).toBe(0);
    expect(v.clamp(11, 0, 10)).toBe(10);
  });

  it('inverse lerps, clamped, without dividing by zero', () => {
    expect(v.inverseLerp(0, 10, 2.5)).toBe(0.25);
    expect(v.inverseLerp(0, 10, -5)).toBe(0);
    expect(v.inverseLerp(0, 10, 50)).toBe(1);
    expect(v.inverseLerp(4, 4, 4)).toBe(0);
  });

  it('compares within an epsilon', () => {
    expect(v.equals(v.vec2(1, 1), v.vec2(1 + 1e-9, 1))).toBe(true);
    expect(v.equals(v.vec2(1, 1), v.vec2(1.1, 1))).toBe(false);
  });

  it('reports angle', () => {
    expect(v.angleOf(v.vec2(1, 0))).toBeCloseTo(0, 10);
    expect(v.angleOf(v.vec2(0, 1))).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('scratch ring', () => {
  it('hands out distinct vectors up to its capacity', () => {
    const taken = new Set<v.Vec2>();
    for (let i = 0; i < v.scratchCapacity(); i++) taken.add(v.takeScratch());
    expect(taken.size).toBe(v.scratchCapacity());
  });

  it('recycles after a full cycle, which is why borrowed vectors must be short-lived', () => {
    const first = v.takeScratch();
    for (let i = 0; i < v.scratchCapacity() - 1; i++) v.takeScratch();
    expect(v.takeScratch()).toBe(first);
  });

  it('zeroes a vector before handing it back out', () => {
    const borrowed = v.takeScratch();
    v.set(borrowed, 99, 99);
    for (let i = 0; i < v.scratchCapacity() - 1; i++) v.takeScratch();
    expect(v.takeScratch()).toEqual({ x: 0, y: 0 });
  });
});
