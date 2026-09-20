import { TILE_SIZE } from '@core/constants';
import type { Rng } from '@core/rng';
import type { PathSchema } from '@content/schema/stage';
import type { z } from 'zod';

/**
 * Pre-baked movement paths.
 *
 * Enemies follow authored polylines, not a pathfinder. A stage's routes never
 * change, so the shape is turned into a cumulative arc-length table once at
 * load and every later query is a binary search — O(log n) per enemy per tick,
 * perfectly reproducible, and trivially serialisable into a snapshot.
 *
 * Running A* here would buy nothing: the designer already decided the route,
 * and a solver would spend frame time rediscovering it while introducing a
 * source of divergence between runs.
 *
 * Everything is in world pixels. Content authors in tiles; the conversion
 * happens once, here, so no system downstream has to remember which unit it is
 * holding.
 */

export interface PathSample {
  x: number;
  y: number;
  /** Unit direction of travel, for facing and directional armour. */
  dirX: number;
  dirY: number;
}

export interface PathBranch {
  /** Distance along this path where the choice is made. */
  atDistance: number;
  targetPathId: number;
  weight: number;
}

type PathContent = z.infer<typeof PathSchema>;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

export class BakedPath {
  readonly id: number;
  /** Interleaved x,y in world pixels. */
  readonly points: Float32Array;
  /** Distance from the start to each point. Monotonically increasing. */
  readonly cumulative: Float32Array;
  readonly totalLength: number;
  readonly branches: readonly PathBranch[];
  /** Range along the path where burrowing enemies are untargetable, or null. */
  readonly burrowFrom: number;
  readonly burrowTo: number;

  constructor(content: PathContent) {
    this.id = content.id;

    const count = content.points.length;
    this.points = new Float32Array(count * 2);
    this.cumulative = new Float32Array(count);

    let total = 0;
    for (let i = 0; i < count; i++) {
      const point = content.points[i] as { x: number; y: number };
      const x = point.x * TILE_SIZE;
      const y = point.y * TILE_SIZE;
      this.points[i * 2] = x;
      this.points[i * 2 + 1] = y;

      if (i > 0) {
        const dx = x - (this.points[(i - 1) * 2] as number);
        const dy = y - (this.points[(i - 1) * 2 + 1] as number);
        total += Math.hypot(dx, dy);
      }
      this.cumulative[i] = total;
    }
    this.totalLength = total;

    this.branches = content.branches.map((branch) => ({
      atDistance: branch.atDistanceTiles * TILE_SIZE,
      targetPathId: branch.targetPathId,
      weight: branch.weight,
    }));

    this.burrowFrom = content.burrowSegment ? content.burrowSegment.fromTiles * TILE_SIZE : -1;
    this.burrowTo = content.burrowSegment ? content.burrowSegment.toTiles * TILE_SIZE : -1;
  }

  get pointCount(): number {
    return this.cumulative.length;
  }

  /**
   * Position and heading at a distance along the path.
   *
   * Clamped at both ends rather than extrapolating: an enemy that has reached
   * the core sits on the core, and one spawned at a negative offset starts at
   * the spawn point. Writes into `out` so sampling allocates nothing.
   */
  /**
   * Path distance of the point on this route closest to (x, y), in pixels.
   *
   * What gives a soldier a position *along the path* rather than merely a
   * position on the map, which is the whole basis of the blocking window: a
   * soldier standing beside a bend must not block an enemy on the other leg of
   * it, even though the two are a few pixels apart (docs/TECH_DESIGN.md §7.7).
   *
   * Walks every segment. Called when a rally point moves, never in a tick.
   */
  nearestDistance(x: number, y: number): number {
    let best = 0;
    let bestSq = Number.POSITIVE_INFINITY;

    for (let i = 0; i + 1 < this.cumulative.length; i++) {
      const ax = this.points[i * 2] as number;
      const ay = this.points[i * 2 + 1] as number;
      const bx = this.points[i * 2 + 2] as number;
      const by = this.points[i * 2 + 3] as number;

      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      /* A zero-length segment contributes its own endpoint and nothing else. */
      const t = lengthSq === 0 ? 0 : clamp01(((x - ax) * dx + (y - ay) * dy) / lengthSq);

      const px = ax + dx * t;
      const py = ay + dy * t;
      const distanceSq = (x - px) * (x - px) + (y - py) * (y - py);

      if (distanceSq < bestSq) {
        bestSq = distanceSq;
        best = (this.cumulative[i] as number) + Math.sqrt(lengthSq) * t;
      }
    }
    return best;
  }

  sample(distance: number, out: PathSample): PathSample {
    const last = this.pointCount - 1;

    if (distance <= 0) return this.sampleSegment(0, 0, out);
    if (distance >= this.totalLength) return this.sampleSegment(last - 1, 1, out);

    /* Binary search for the segment containing this distance. */
    let low = 0;
    let high = last;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if ((this.cumulative[mid] as number) <= distance) low = mid;
      else high = mid;
    }

    const from = this.cumulative[low] as number;
    const to = this.cumulative[low + 1] as number;
    const span = to - from;
    return this.sampleSegment(low, span === 0 ? 0 : (distance - from) / span, out);
  }

  private sampleSegment(index: number, t: number, out: PathSample): PathSample {
    const ax = this.points[index * 2] as number;
    const ay = this.points[index * 2 + 1] as number;
    const bx = this.points[(index + 1) * 2] as number;
    const by = this.points[(index + 1) * 2 + 1] as number;

    out.x = ax + (bx - ax) * t;
    out.y = ay + (by - ay) * t;

    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      out.dirX = 1;
      out.dirY = 0;
    } else {
      out.dirX = dx / length;
      out.dirY = dy / length;
    }
    return out;
  }

  isBurrowed(distance: number): boolean {
    return this.burrowFrom >= 0 && distance >= this.burrowFrom && distance <= this.burrowTo;
  }
}

/**
 * Chooses a branch at spawn, weighted.
 *
 * Decided once when the enemy appears rather than when it reaches the fork, so
 * the whole route is fixed up front: a wave preview can be accurate, and a
 * replay does not depend on exactly which tick an enemy crossed a junction.
 */
export function chooseBranch(path: BakedPath, rng: Rng): number {
  if (path.branches.length === 0) return path.id;

  let total = 0;
  for (const branch of path.branches) total += branch.weight;
  /* The current path competes with its branches, weighted as one share. */
  total += 1;

  let roll = rng.next() * total;
  for (const branch of path.branches) {
    roll -= branch.weight;
    if (roll < 0) return branch.targetPathId;
  }
  return path.id;
}

/**
 * A stable sideways offset so a pack of six does not render as a single sprite.
 *
 * Derived from the entity id by hashing, never from the RNG. A visual detail
 * must not consume the random stream — doing so would shift every later roll
 * and make the spread of enemies change what a tower hits.
 */
export function laneOffsetFor(entityId: number, laneWidth: number): number {
  let h = Math.imul(entityId, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  /* Map to [-1, 1), then to half the lane either side of the centre line. */
  const unit = ((h >>> 0) / 0x100000000) * 2 - 1;
  return unit * laneWidth * 0.5;
}
