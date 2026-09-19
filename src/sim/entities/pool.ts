import { SlotAllocator } from '@core/pool';

/**
 * Shared slot bookkeeping for the structure-of-arrays entity pools.
 *
 * Every pool stores its fields as parallel typed arrays indexed by a slot
 * number, and every pool needs the same three things: hand out a free slot,
 * recycle it on death, and let systems iterate the live ones. That logic is
 * identical across enemies, towers, projectiles, soldiers and ground effects,
 * so it lives here once.
 *
 * Iteration is always `0 .. watermark` with an alive check, never a list of
 * live slots. Slot order is stable and independent of allocation history, which
 * is what keeps a replay reproducible — a `Set` of live entities would iterate
 * in insertion order and make the outcome depend on the order things spawned.
 *
 * Indexing invariant for the `as number` assertions across these pools: every
 * array is allocated at `capacity` in the constructor and never resized, and
 * every index either comes from `SlotAllocator` (which never returns one out of
 * range) or from a loop bounded by `watermark`.
 */
export abstract class EntityPool {
  /** Stable identity, unique for the lifetime of the world. */
  readonly ids: Int32Array;
  readonly flags: Uint16Array;
  readonly capacity: number;

  private readonly slots: SlotAllocator;
  private nextId = 1;
  private live = 0;

  /** Bit that marks a slot occupied. Identical across the flag enums. */
  protected static readonly ALIVE = 1;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.slots = new SlotAllocator(capacity);
    this.ids = new Int32Array(capacity);
    this.flags = new Uint16Array(capacity);
  }

  /**
   * Claims a slot, or returns -1 when the pool is full.
   *
   * Full means dropped, never grown: reallocating a typed array mid-wave is the
   * GC pause this whole design exists to avoid. Callers treat -1 as "this
   * entity does not spawn" and the dev overlay surfaces it.
   */
  alloc(): number {
    const slot = this.slots.alloc();
    if (slot < 0) return -1;

    this.resetSlot(slot);
    this.ids[slot] = this.nextId++;
    this.flags[slot] = EntityPool.ALIVE;
    this.live++;
    return slot;
  }

  free(slot: number): void {
    if (!this.isAlive(slot)) return;
    this.flags[slot] = 0;
    this.ids[slot] = 0;
    this.slots.free(slot);
    this.live--;
  }

  isAlive(slot: number): boolean {
    if (slot < 0 || slot >= this.capacity) return false;
    return ((this.flags[slot] as number) & EntityPool.ALIVE) !== 0;
  }

  /** Live entities. */
  get count(): number {
    return this.live;
  }

  /** Upper bound for iteration: one past the highest slot ever used. */
  get watermark(): number {
    return this.slots.watermark;
  }

  /**
   * Empties the pool completely, leaving it indistinguishable from a new one.
   *
   * Zeroes every typed array, not just the slot table. Dead slots keeping their
   * previous occupant's values is harmless during play — `resetSlot` cleans a
   * slot before handing it out — but it means a restarted stage is not byte
   * identical to a fresh one, which breaks both the determinism fingerprint and
   * the guarantee that restarting is the same as starting.
   *
   * Found by tests/determinism/world.test.ts on its first run.
   *
   * Arrays are discovered by reflection rather than listed, since a list is
   * something a new field gets left off. Safe here because clearing happens
   * between stages, never inside the tick loop.
   */
  clear(): void {
    for (const key of Object.keys(this)) {
      const value = (this as unknown as Record<string, unknown>)[key];
      if (ArrayBuffer.isView(value) && 'fill' in value) {
        (value as unknown as { fill: (v: number) => void }).fill(0);
      }
    }
    this.slots.clear();
    this.live = 0;
    this.nextId = 1;
  }

  /**
   * Zeroes a slot's fields before it is handed out.
   *
   * Done on alloc rather than on free so a recycled slot cannot inherit stale
   * values from its previous occupant — a bug that shows up as an enemy
   * spawning with the last one's remaining health.
   */
  protected abstract resetSlot(slot: number): void;
}
