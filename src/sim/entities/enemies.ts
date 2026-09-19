import { MAX_ENEMIES } from '../capacity.js';
import { STATUS_COUNT } from '../status.js';
import { EntityPool } from './pool.js';

/**
 * Per-instance data too rare or too object-shaped to justify a typed array.
 *
 * Kept deliberately empty for now. The temptation is to reach for it whenever a
 * field is only used by one enemy type, but a parallel typed array is almost
 * always the better answer — this exists for genuinely object-shaped state,
 * such as a carrier's list of dropped children.
 */
export interface EnemyMeta {
  readonly kind: string;
}

export class EnemyPool extends EntityPool {
  readonly x = new Float32Array(this.capacity);
  readonly y = new Float32Array(this.capacity);
  readonly hp = new Float32Array(this.capacity);
  readonly maxHp = new Float32Array(this.capacity);
  readonly overshield = new Float32Array(this.capacity);
  readonly speed = new Float32Array(this.capacity);
  readonly armour = new Float32Array(this.capacity);
  readonly ward = new Float32Array(this.capacity);

  readonly pathId = new Uint8Array(this.capacity);
  /** Distance travelled along the path, in tiles. The authoritative position. */
  readonly pathDist = new Float32Array(this.capacity);
  /**
   * Perpendicular offset so a pack of six does not render as one sprite.
   * Derived from the entity id, never from the RNG — a visual detail must not
   * consume the random stream and shift every later roll.
   */
  readonly laneOffset = new Float32Array(this.capacity);

  /** Index into the stage's enemy definition table. */
  readonly typeIdx = new Uint16Array(this.capacity);
  readonly spawnPoint = new Uint8Array(this.capacity);
  /** Wave this enemy belongs to, so a wave knows when it has been cleared. */
  readonly waveIndex = new Int16Array(this.capacity);

  /** Slot of the soldier holding this enemy, or -1. */
  readonly blockedBy = new Int32Array(this.capacity);
  /** Tick before which no reaction may trigger, enforcing the per-enemy lockout. */
  readonly reactionReadyTick = new Int32Array(this.capacity);
  /** Facing along the path, for directional armour. Radians. */
  readonly facing = new Float32Array(this.capacity);

  /** Flat `slot * STATUS_COUNT + status`. */
  readonly statusStacks = new Uint8Array(this.capacity * STATUS_COUNT);
  readonly statusExpiry = new Int32Array(this.capacity * STATUS_COUNT);
  /** Set when a status changed this tick, so reactions scan only what moved. */
  readonly statusDirty = new Uint8Array(this.capacity);

  readonly meta: (EnemyMeta | null)[] = new Array<EnemyMeta | null>(this.capacity).fill(null);

  constructor(capacity = MAX_ENEMIES) {
    super(capacity);
  }

  protected resetSlot(slot: number): void {
    this.x[slot] = 0;
    this.y[slot] = 0;
    this.hp[slot] = 0;
    this.maxHp[slot] = 0;
    this.overshield[slot] = 0;
    this.speed[slot] = 0;
    this.armour[slot] = 0;
    this.ward[slot] = 0;
    this.pathId[slot] = 0;
    this.pathDist[slot] = 0;
    this.laneOffset[slot] = 0;
    this.typeIdx[slot] = 0;
    this.spawnPoint[slot] = 0;
    this.waveIndex[slot] = -1;
    this.blockedBy[slot] = -1;
    this.reactionReadyTick[slot] = 0;
    this.facing[slot] = 0;
    this.statusDirty[slot] = 0;
    this.meta[slot] = null;

    const base = slot * STATUS_COUNT;
    for (let i = 0; i < STATUS_COUNT; i++) {
      this.statusStacks[base + i] = 0;
      this.statusExpiry[base + i] = 0;
    }
  }

  /* The typed arrays, including the status blocks, are handled by the base
     class. `meta` is a plain object array, so it is cleared here. */
  override clear(): void {
    super.clear();
    this.meta.fill(null);
  }

  stacksOf(slot: number, status: number): number {
    return this.statusStacks[slot * STATUS_COUNT + status] as number;
  }
}
