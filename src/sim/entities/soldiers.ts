import { MAX_SOLDIERS } from '../capacity.js';
import { EntityPool } from './pool.js';

/**
 * Soldiers and the hero share this pool.
 *
 * The hero is a soldier with better stats, its own abilities and a flag: it
 * blocks the same way, engages the same way and dies the same way. Giving it a
 * separate pool would mean writing the blocking rules twice and having them
 * drift — and blocking is the subtlest system in the genre.
 */
export class SoldierPool extends EntityPool {
  readonly x = new Float32Array(this.capacity);
  readonly y = new Float32Array(this.capacity);
  readonly hp = new Float32Array(this.capacity);
  readonly maxHp = new Float32Array(this.capacity);
  readonly armour = new Float32Array(this.capacity);

  readonly damage = new Float32Array(this.capacity);
  /**
   * What this one's blows are made of.
   *
   * Per soldier rather than assumed kinetic: a Ranger Lodge fights with Toxic
   * and the hero with whatever its content says, and a shared assumption would
   * quietly give both of them steel.
   */
  readonly damageType = new Uint8Array(this.capacity);
  readonly attackInterval = new Float32Array(this.capacity);
  readonly cooldown = new Float32Array(this.capacity);
  readonly attackRange = new Float32Array(this.capacity);

  /** Where it walks back to when not engaged. */
  readonly rallyX = new Float32Array(this.capacity);
  readonly rallyY = new Float32Array(this.capacity);
  /** Position along the path, used to decide what it can legitimately block. */
  readonly pathId = new Uint8Array(this.capacity);
  readonly pathDist = new Float32Array(this.capacity);

  /** Barracks that owns it, or -1 for the hero. */
  readonly sourceTower = new Int32Array(this.capacity);
  /**
   * Which of the owner's garrison slots this is, 0 to count-1.
   *
   * Respawn is per slot, so a barracks that has lost two soldiers brings them
   * back on two independent timers rather than one shared one.
   */
  readonly garrisonSlot = new Uint8Array(this.capacity);
  /** Enemy slot it is holding, or -1. */
  readonly engagedWith = new Int32Array(this.capacity);
  /** Ticks until it returns after dying. */
  readonly respawnIn = new Float32Array(this.capacity);

  constructor(capacity = MAX_SOLDIERS) {
    super(capacity);
  }

  protected resetSlot(slot: number): void {
    this.x[slot] = 0;
    this.y[slot] = 0;
    this.hp[slot] = 0;
    this.maxHp[slot] = 0;
    this.armour[slot] = 0;
    this.damage[slot] = 0;
    this.damageType[slot] = 0;
    this.attackInterval[slot] = 0;
    this.cooldown[slot] = 0;
    this.attackRange[slot] = 0;
    this.rallyX[slot] = 0;
    this.rallyY[slot] = 0;
    this.pathId[slot] = 0;
    this.pathDist[slot] = 0;
    this.sourceTower[slot] = -1;
    this.garrisonSlot[slot] = 0;
    this.engagedWith[slot] = -1;
    this.respawnIn[slot] = 0;
  }
}
