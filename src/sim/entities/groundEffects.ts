import { MAX_GROUND_EFFECTS } from '../capacity.js';
import { EntityPool } from './pool.js';

/**
 * Lingering areas: burning pools, Arc Net fields, Stasis Field, lava, and the
 * one-shot map interactables. One pool because they differ only in payload.
 */
export class GroundEffectPool extends EntityPool {
  readonly x = new Float32Array(this.capacity);
  readonly y = new Float32Array(this.capacity);
  readonly radius = new Float32Array(this.capacity);

  /** Ticks remaining. */
  readonly duration = new Float32Array(this.capacity);
  /** Ticks between applications, and the countdown to the next one. */
  readonly tickInterval = new Float32Array(this.capacity);
  readonly nextTickIn = new Float32Array(this.capacity);

  readonly damagePerTick = new Float32Array(this.capacity);
  readonly damageType = new Uint8Array(this.capacity);
  readonly statusId = new Uint8Array(this.capacity);
  readonly statusStacks = new Uint8Array(this.capacity);
  /** Fractional movement multiplier applied while inside, 1 for none. */
  readonly slowMultiplier = new Float32Array(this.capacity);

  readonly sourceTower = new Int32Array(this.capacity);

  constructor(capacity = MAX_GROUND_EFFECTS) {
    super(capacity);
  }

  protected resetSlot(slot: number): void {
    this.x[slot] = 0;
    this.y[slot] = 0;
    this.radius[slot] = 0;
    this.duration[slot] = 0;
    this.tickInterval[slot] = 0;
    this.nextTickIn[slot] = 0;
    this.damagePerTick[slot] = 0;
    this.damageType[slot] = 0;
    this.statusId[slot] = 255;
    this.statusStacks[slot] = 0;
    this.slowMultiplier[slot] = 1;
    this.sourceTower[slot] = -1;
  }
}
