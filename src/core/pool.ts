/**
 * Object pooling.
 *
 * The simulation runs at 60Hz with hundreds of live entities. Allocating and
 * discarding objects at that rate is what produces the GC pauses that show up
 * as stutter on a mid-range phone, so anything created per-tick is pooled and
 * reused instead.
 */

/**
 * A pool of reusable objects.
 *
 * `reset` is called when an object is returned, not when it is handed out, so
 * that a freed object never holds a reference that keeps something else alive.
 */
export class Pool<T> {
  private readonly free: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (item: T) => void;
  private created = 0;
  private live = 0;

  constructor(factory: () => T, reset: (item: T) => void, prefill = 0) {
    this.factory = factory;
    this.reset = reset;
    for (let i = 0; i < prefill; i++) {
      this.free.push(factory());
      this.created++;
    }
  }

  acquire(): T {
    const item = this.free.pop();
    this.live++;
    if (item !== undefined) return item;
    this.created++;
    return this.factory();
  }

  release(item: T): void {
    this.reset(item);
    this.free.push(item);
    this.live--;
  }

  /** Returns every object to the pool. Callers must drop their references first. */
  clear(): void {
    this.live = 0;
  }

  /** Objects ever constructed. Stops growing once the pool reaches steady state. */
  get capacity(): number {
    return this.created;
  }

  /** Objects currently checked out. */
  get inUse(): number {
    return this.live;
  }

  get available(): number {
    return this.free.length;
  }
}

/**
 * Allocates and recycles integer slot indices.
 *
 * The entity pools are structure-of-arrays: parallel typed arrays indexed by a
 * slot number, rather than an array of objects. Something has to hand out and
 * reclaim those indices, and it is the same logic for every entity type, so it
 * lives here instead of being rewritten per pool.
 *
 * Slots are reused, so an index alone does not identify an entity across time.
 * Callers that need a stable identity must pair the slot with a generation
 * counter; `generationOf` provides one.
 */
export class SlotAllocator {
  private readonly freeSlots: Int32Array;
  private readonly generations: Uint32Array;
  private freeCount = 0;
  private highWater = 0;
  private readonly max: number;

  constructor(capacity: number) {
    this.max = capacity;
    this.freeSlots = new Int32Array(capacity);
    this.generations = new Uint32Array(capacity);
  }

  /** Returns a free slot, or -1 when the pool is exhausted. */
  alloc(): number {
    if (this.freeCount > 0) {
      this.freeCount--;
      /* Index is below freeCount's previous value, so it is in range. */
      return this.freeSlots[this.freeCount] as number;
    }
    if (this.highWater < this.max) return this.highWater++;
    return -1;
  }

  /**
   * Returns a slot for reuse and bumps its generation, so any index still
   * holding the old generation can be recognised as stale.
   */
  free(slot: number): void {
    if (slot < 0 || slot >= this.max) return;
    this.generations[slot] = ((this.generations[slot] as number) + 1) >>> 0;
    this.freeSlots[this.freeCount] = slot;
    this.freeCount++;
  }

  generationOf(slot: number): number {
    return slot < 0 || slot >= this.max ? 0 : (this.generations[slot] as number);
  }

  /** Frees every slot without touching generations. */
  clear(): void {
    this.freeCount = 0;
    this.highWater = 0;
  }

  /** Slots currently allocated. */
  get inUse(): number {
    return this.highWater - this.freeCount;
  }

  /** Highest slot index ever handed out, plus one. Bounds an iteration. */
  get watermark(): number {
    return this.highWater;
  }

  get capacity(): number {
    return this.max;
  }
}
