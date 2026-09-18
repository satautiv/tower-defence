import { distanceSqXY } from './vec.js';

/**
 * Uniform spatial hash over a bounded world.
 *
 * Every tick, sixty-odd towers each ask "what is within my range?". Scanning
 * all three hundred enemies per tower is 18,000 distance checks; bucketing by
 * cell first turns that into a few dozen per query.
 *
 * Cells are stored as intrusive linked lists inside typed arrays — `cellHead`
 * holds the first slot in each cell, `nextSlot` chains the rest — so inserting
 * is O(1), clearing is a single fill, and nothing allocates after construction.
 *
 * Cell size should be near the median query radius. Too small and a query
 * sweeps many cells; too large and each cell holds entities the query then has
 * to reject individually.
 *
 * Invariant for the `!` assertions below: `cellHead`, `nextSlot` and the
 * coordinate arrays are all allocated in the constructor at fixed size, and
 * every index used to read them is either derived from `cellIndex` (clamped
 * into range) or from a slot counter bounded by `capacity`.
 */
export class SpatialHash {
  /** Cell edge length in world units. Exposed for the dev overlay. */
  readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly capacity: number;

  private readonly cellHead: Int32Array;
  private readonly nextSlot: Int32Array;
  private readonly ids: Int32Array;
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;

  private count = 0;
  private overflowed = false;
  private truncated = false;

  constructor(cellSize: number, worldWidth: number, worldHeight: number, capacity: number) {
    if (cellSize <= 0) throw new RangeError('SpatialHash: cellSize must be positive');
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cols = Math.max(1, Math.ceil(worldWidth / cellSize));
    this.rows = Math.max(1, Math.ceil(worldHeight / cellSize));
    this.capacity = capacity;

    this.cellHead = new Int32Array(this.cols * this.rows).fill(-1);
    this.nextSlot = new Int32Array(capacity);
    this.ids = new Int32Array(capacity);
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
  }

  /**
   * Coordinates outside the world are clamped into the edge cells rather than
   * rejected. An enemy that has drifted just past a boundary is still a real
   * entity that towers must be able to find.
   */
  private columnOf(x: number): number {
    const c = Math.floor(x * this.invCellSize);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private rowOf(y: number): number {
    const r = Math.floor(y * this.invCellSize);
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  clear(): void {
    this.cellHead.fill(-1);
    this.count = 0;
    this.overflowed = false;
  }

  /** Adds an entity. Silently ignored once capacity is reached; see `didOverflow`. */
  insert(id: number, x: number, y: number): void {
    if (this.count >= this.capacity) {
      this.overflowed = true;
      return;
    }
    const slot = this.count++;
    const cell = this.rowOf(y) * this.cols + this.columnOf(x);

    this.ids[slot] = id;
    this.xs[slot] = x;
    this.ys[slot] = y;
    this.nextSlot[slot] = this.cellHead[cell] as number;
    this.cellHead[cell] = slot;
  }

  /**
   * Writes the ids of every entity within `radius` of (x, y) into `out`, and
   * returns how many were written.
   *
   * The caller supplies the buffer so that querying allocates nothing. If the
   * buffer fills, the query stops early and `didTruncate` reports it — a
   * silently short result would read as "nothing else is in range", which is
   * the kind of bug that looks like a balance problem.
   */
  query(x: number, y: number, radius: number, out: Int32Array): number {
    this.truncated = false;
    if (out.length === 0) return 0;

    const radiusSq = radius * radius;
    const minCol = this.columnOf(x - radius);
    const maxCol = this.columnOf(x + radius);
    const minRow = this.rowOf(y - radius);
    const maxRow = this.rowOf(y + radius);

    let written = 0;
    for (let row = minRow; row <= maxRow; row++) {
      const rowBase = row * this.cols;
      for (let col = minCol; col <= maxCol; col++) {
        let slot = this.cellHead[rowBase + col] as number;
        while (slot !== -1) {
          if (distanceSqXY(x, y, this.xs[slot] as number, this.ys[slot] as number) <= radiusSq) {
            if (written >= out.length) {
              this.truncated = true;
              return written;
            }
            out[written++] = this.ids[slot] as number;
          }
          slot = this.nextSlot[slot] as number;
        }
      }
    }
    return written;
  }

  /** True if the last `query` ran out of room in the caller's buffer. */
  get didTruncate(): boolean {
    return this.truncated;
  }

  /** True if an `insert` since the last `clear` exceeded capacity. */
  get didOverflow(): boolean {
    return this.overflowed;
  }

  get size(): number {
    return this.count;
  }

  get cellCount(): number {
    return this.cols * this.rows;
  }

  /** Occupancy spread, for the dev overlay. Recomputed on demand, not per tick. */
  stats(): { cells: number; occupied: number; largestCell: number } {
    const perCell = new Int32Array(this.cellHead.length);
    for (let cell = 0; cell < this.cellHead.length; cell++) {
      let slot = this.cellHead[cell] as number;
      let n = 0;
      while (slot !== -1) {
        n++;
        slot = this.nextSlot[slot] as number;
      }
      perCell[cell] = n;
    }
    let occupied = 0;
    let largest = 0;
    for (let i = 0; i < perCell.length; i++) {
      const n = perCell[i] as number;
      if (n > 0) occupied++;
      if (n > largest) largest = n;
    }
    return { cells: this.cellHead.length, occupied, largestCell: largest };
  }
}
