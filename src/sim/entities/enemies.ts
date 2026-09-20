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
  /**
   * Tick at which this enemy shoulders past whoever is holding it.
   *
   * The release valve on blocking. Two soldiers and a rally flag would
   * otherwise hold a boss forever, which is not a strategy the design wants to
   * exist (docs/TECH_DESIGN.md §7.7). Set when the block starts, not
   * refreshed, so the window is the whole engagement rather than per swing.
   */
  readonly blockUntilTick = new Int32Array(this.capacity);
  /** Tick the enemy may next swing at whoever is holding it. */
  readonly meleeReadyTick = new Int32Array(this.capacity);
  /**
   * Path distance this enemy must pass before anything may block it again.
   *
   * Without it the release valve does not work at all: a soldier releases an
   * enemy whose window has lapsed and then re-engages it on the same tick,
   * resetting the timer, and the stall-lock the valve exists to prevent is
   * exactly what happens. An enemy that shoulders past keeps going.
   */
  readonly blockReadyDist = new Float32Array(this.capacity);
  /** Tick before which no reaction may trigger, enforcing the per-enemy lockout. */
  readonly reactionReadyTick = new Int32Array(this.capacity);
  /**
   * Temporary multiplier on armour and ward, and the tick it lapses.
   *
   * Generic rather than a Superconduct flag: the reaction that sets it is one
   * of several effects that will want to soften a target for a few seconds, and
   * the damage formula should not have to know which one did it.
   */
  readonly defenceMultiplier = new Float32Array(this.capacity);
  readonly defenceMultiplierUntil = new Int32Array(this.capacity);
  /** Facing along the path, for directional armour. Radians. */
  readonly facing = new Float32Array(this.capacity);

  /**
   * Reaction damage still to land, per tick, and the tick it stops.
   *
   * Combustion deals its 80 over three seconds rather than at once, and a
   * status cannot express that — statuses carry stacks, not an arbitrary
   * amount. Kept here rather than as a ground effect because it follows the
   * enemy that reacted, which a puddle on the floor would not.
   */
  readonly burnPerTick = new Float32Array(this.capacity);
  readonly burnUntilTick = new Int32Array(this.capacity);

  /** Flat `slot * STATUS_COUNT + status`. */
  readonly statusStacks = new Uint8Array(this.capacity * STATUS_COUNT);
  readonly statusExpiry = new Int32Array(this.capacity * STATUS_COUNT);
  /** Set when a status changed this tick, so reactions scan only what moved. */
  readonly statusDirty = new Uint8Array(this.capacity);

  /**
   * Movement multiplier from the ground the enemy is standing on, 1 for clear.
   *
   * Recomputed from scratch every tick by the ground-effect system rather than
   * accumulated, which is what keeps overlapping fields from multiplying out
   * of control: three pools that each halve speed leave an enemy at half, not
   * at an eighth. The strongest one wins and the rest are ignored.
   */
  readonly groundSlow = new Float32Array(this.capacity);
  /** Standing in something that blocks the road outright, e.g. a Rift Seal. */
  readonly groundBlocked = new Uint8Array(this.capacity);

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
    this.blockUntilTick[slot] = 0;
    this.meleeReadyTick[slot] = 0;
    this.blockReadyDist[slot] = 0;
    this.reactionReadyTick[slot] = 0;
    this.defenceMultiplier[slot] = 1;
    this.defenceMultiplierUntil[slot] = 0;
    this.facing[slot] = 0;
    this.burnPerTick[slot] = 0;
    this.burnUntilTick[slot] = 0;
    this.statusDirty[slot] = 0;
    this.groundSlow[slot] = 1;
    this.groundBlocked[slot] = 0;
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
