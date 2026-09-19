import { MAX_PROJECTILES } from '../capacity.js';
import { EntityPool } from './pool.js';

export class ProjectilePool extends EntityPool {
  readonly x = new Float32Array(this.capacity);
  readonly y = new Float32Array(this.capacity);
  readonly vx = new Float32Array(this.capacity);
  readonly vy = new Float32Array(this.capacity);

  readonly damage = new Float32Array(this.capacity);
  readonly damageType = new Uint8Array(this.capacity);
  readonly splashRadius = new Float32Array(this.capacity);
  readonly armourPierce = new Float32Array(this.capacity);

  /** Status applied on hit, and how many stacks. 255 means none. */
  readonly statusId = new Uint8Array(this.capacity);
  readonly statusStacks = new Uint8Array(this.capacity);

  /** Who fired it, so a kill can be attributed and ley bonuses applied. */
  readonly sourceTower = new Int32Array(this.capacity);
  /** Homing target slot, or -1 for a ballistic shot aimed at a point. */
  readonly target = new Int32Array(this.capacity);
  /** Ground position a ballistic shell is falling towards. */
  readonly targetX = new Float32Array(this.capacity);
  readonly targetY = new Float32Array(this.capacity);

  /** Ticks before it expires unhit, so a stray shot cannot live forever. */
  readonly ttl = new Float32Array(this.capacity);

  constructor(capacity = MAX_PROJECTILES) {
    super(capacity);
  }

  protected resetSlot(slot: number): void {
    this.x[slot] = 0;
    this.y[slot] = 0;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.damage[slot] = 0;
    this.damageType[slot] = 0;
    this.splashRadius[slot] = 0;
    this.armourPierce[slot] = 0;
    this.statusId[slot] = 255;
    this.statusStacks[slot] = 0;
    this.sourceTower[slot] = -1;
    this.target[slot] = -1;
    this.targetX[slot] = 0;
    this.targetY[slot] = 0;
    this.ttl[slot] = 0;
  }
}
