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

  get count(): number {
    return this.used;
  }

  /** Entries refused because the queue was full. Non-zero means under-sized. */
  get dropped(): number {
    return this.lost;
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
  private used = 0;

  get count(): number {
    return this.used;
  }

  push(slot: number, damageType: number): void {
    if (this.used >= this.slots.length) return;
    this.slots[this.used] = slot;
    this.killedBy[this.used] = damageType;
    this.used++;
  }

  clear(): void {
    this.used = 0;
  }
}
