import { DAMAGE_TYPES } from '@content/schema/common';
import type { DamageType } from '@content/schema/common';
import { MAX_DAMAGE_PER_TICK, MAX_ENEMIES } from './capacity.js';

/**
 * The single damage queue.
 *
 * Every source — projectiles, beams, damage over time, reactions, soldiers, the
 * hero, ground effects — pushes here, and step 11 resolves the lot in one
 * place. Nothing dies mid-pipeline.
 *
 * That is worth the indirection because it removes a whole family of bugs at
 * once: a tower cannot shoot a corpse, chain lightning cannot jump to something
 * that died earlier in the same tick, and the outcome no longer depends on
 * which system happened to run first. It is also the only way splitters,
 * contagion and bounty stay deterministic.
 */

/** Numeric damage types, derived from content so the two cannot drift. */
export const DAMAGE_INDEX: Readonly<Record<DamageType, number>> = Object.freeze(
  Object.fromEntries(DAMAGE_TYPES.map((id, i) => [id, i])) as Record<DamageType, number>,
);
export const DAMAGE_BY_INDEX: readonly DamageType[] = DAMAGE_TYPES;
export const DAMAGE_TYPE_COUNT = DAMAGE_TYPES.length;

export const enum DamageFlag {
  None = 0,
  /** Scaled by reactionPower, and reported separately for VFX and the codex. */
  IsReaction = 1 << 0,
  /** Applies the source's armour pierce before the reduction formula. */
  ArmourPierce = 1 << 1,
  /** Ignores armour and ward entirely. Used sparingly, tier-5 only. */
  True = 1 << 2,
  /** Skips the on-hit status, e.g. splash falloff on secondary targets. */
  NoStatus = 1 << 3,
  /** Eligible for the Shatter bonus against a frozen target. */
  CanShatter = 1 << 4,
  /**
   * Can be dodged. Only projectiles set this: beams, auras and damage over time
   * never miss, which is what makes them the answer to evasion.
   */
  Evadable = 1 << 5,
}

const NO_STATUS = 255;

export class DamageQueue {
  readonly target = new Int32Array(MAX_DAMAGE_PER_TICK);
  readonly amount = new Float32Array(MAX_DAMAGE_PER_TICK);
  readonly type = new Uint8Array(MAX_DAMAGE_PER_TICK);
  readonly source = new Int32Array(MAX_DAMAGE_PER_TICK);
  readonly flags = new Uint16Array(MAX_DAMAGE_PER_TICK);
  readonly statusId = new Uint8Array(MAX_DAMAGE_PER_TICK);
  readonly statusStacks = new Uint8Array(MAX_DAMAGE_PER_TICK);

  private used = 0;
  private lost = 0;
  private peak = 0;

  get count(): number {
    return this.used;
  }

  /** Entries refused because the queue was full. Non-zero means under-sized. */
  get dropped(): number {
    return this.lost;
  }

  /**
   * The busiest tick since the stage began.
   *
   * Tracked here rather than sampled from outside because it cannot be sampled
   * from outside: the queue is filled and drained entirely within one tick, so
   * anything looking at it between ticks sees an empty one. One comparison on
   * a path that was already incrementing a counter, and the number is the only
   * way to know how close a busy wave came to the ceiling before it started
   * dropping hits.
   */
  get highWater(): number {
    return this.peak;
  }

  push(
    target: number,
    amount: number,
    type: number,
    source: number,
    flags: number = DamageFlag.None,
    statusId: number = NO_STATUS,
    statusStacks = 0,
  ): boolean {
    if (this.used >= MAX_DAMAGE_PER_TICK) {
      this.lost++;
      return false;
    }
    const i = this.used++;
    if (this.used > this.peak) this.peak = this.used;
    this.target[i] = target;
    this.amount[i] = amount;
    this.type[i] = type;
    this.source[i] = source;
    this.flags[i] = flags;
    this.statusId[i] = statusId;
    this.statusStacks[i] = statusStacks;
    return true;
  }

  clear(): void {
    this.used = 0;
  }

  reset(): void {
    this.used = 0;
    this.lost = 0;
    this.peak = 0;
  }
}

/**
 * Enemies that reached zero health this tick, resolved after the queue drains.
 *
 * Deferred for the same reason the damage is: a death that took effect
 * immediately would change what later entries in the queue are pointing at.
 * Deduplicated by the Dying flag, so an enemy hit five times in one tick dies
 * once and pays out one bounty.
 */
export class DeathList {
  readonly slots = new Int32Array(MAX_ENEMIES);
  /** Damage type of the killing blow, for the death animation. */
  readonly killedBy = new Uint8Array(MAX_ENEMIES);
  /** Tower that landed it, so an economy tower can be paid its bonus. */
  readonly killedBySource = new Int32Array(MAX_ENEMIES);
  private used = 0;

  get count(): number {
    return this.used;
  }

  push(slot: number, damageType: number, source = -1): void {
    if (this.used >= this.slots.length) return;
    this.slots[this.used] = slot;
    this.killedBy[this.used] = damageType;
    this.killedBySource[this.used] = source;
    this.used++;
  }

  clear(): void {
    this.used = 0;
  }
}
