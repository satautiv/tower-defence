/**
 * 2D vector maths with a mutating API.
 *
 * Every operation writes into a caller-supplied `out` and returns it. This is
 * deliberately less pleasant than returning fresh vectors: the simulation runs
 * these thousands of times per tick, and allocating a short-lived object per
 * operation is what turns a smooth frame into a GC pause on a mid-range phone.
 *
 * Prefer the squared-distance variants in comparisons. A square root in a
 * targeting loop is pure waste when only the ordering matters.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function sub(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scale(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** out = a + b * s. The step every projectile takes each tick. */
export function addScaled(out: Vec2, a: Vec2, b: Vec2, s: number): Vec2 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  return out;
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Squared distance between raw coordinates, for typed-array callers. */
export function distanceSqXY(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Normalises in place. A zero vector is left at zero rather than producing NaN. */
export function normalize(out: Vec2, a: Vec2): Vec2 {
  const lenSq = lengthSq(a);
  if (lenSq === 0) return set(out, 0, 0);
  const inv = 1 / Math.sqrt(lenSq);
  out.x = a.x * inv;
  out.y = a.y * inv;
  return out;
}

export function lerpVec(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

/**
 * Perpendicular, rotated 90 degrees counter-clockwise. Used for lane offsets.
 *
 * Negating a zero component produces -0. That compares equal to 0 under `==`
 * and `===` and behaves identically in arithmetic, but `Object.is` and
 * `toEqual` distinguish the two, so compare components numerically in tests.
 */
export function perpendicular(out: Vec2, a: Vec2): Vec2 {
  const x = a.x;
  out.x = -a.y;
  out.y = x;
  return out;
}

export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

export function equals(a: Vec2, b: Vec2, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

/* ---- scalar helpers, kept here because they travel with vector code ---- */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Fraction of the way from `a` to `b`, clamped to [0, 1]. */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : clamp((value - a) / (b - a), 0, 1);
}

/**
 * A small ring of reusable vectors for within-function temporaries.
 *
 * Deliberately tiny and deliberately cycling: a borrowed vector is valid only
 * until `take()` has been called SCRATCH_SIZE more times. Never store one, never
 * return one, never hold one across a call that might also use scratch. If a
 * value needs to outlive the expression that made it, it belongs in a field.
 */
const SCRATCH_SIZE = 16;
const scratchRing: Vec2[] = Array.from({ length: SCRATCH_SIZE }, () => vec2());
let scratchIndex = 0;

export function takeScratch(): Vec2 {
  const v = scratchRing[scratchIndex] as Vec2;
  scratchIndex = (scratchIndex + 1) % SCRATCH_SIZE;
  v.x = 0;
  v.y = 0;
  return v;
}

/** Test seam: makes scratch reuse observable without exporting the ring. */
export function scratchCapacity(): number {
  return SCRATCH_SIZE;
}
