import { MAX_TOWERS } from '../capacity.js';
import { EntityPool } from './pool.js';

export class TowerPool extends EntityPool {
  readonly x = new Float32Array(this.capacity);
  readonly y = new Float32Array(this.capacity);

  /** Index into the tower definition table, and which rung of its path. */
  readonly typeIdx = new Uint16Array(this.capacity);
  /** 0-2 for the base path, 3-4 once specialised. */
  readonly tier = new Uint8Array(this.capacity);
  /** Which of the two branches was taken at tier 4, or -1. */
  readonly specialisation = new Int8Array(this.capacity);

  /**
   * The ley node this tower stands on, or -1.
   *
   * The plot's property, copied onto the tower at build time: the bonus has to
   * survive every upgrade and every specialisation, and re-deriving it from the
   * plot on each re-stat would mean the stat pipeline reaching back into the
   * ruleset's plot list for something that cannot change while the tower lives.
   */
  readonly leyNode = new Int8Array(this.capacity);

  /** Resolved stats, so systems never walk back to content during a tick. */
  readonly damage = new Float32Array(this.capacity);
  readonly range = new Float32Array(this.capacity);
  readonly minRange = new Float32Array(this.capacity);
  readonly fireInterval = new Float32Array(this.capacity);
  /** Stacks this tower's hits apply, after a Resonance node has had its say. */
  readonly statusStacks = new Uint8Array(this.capacity);
  /** Ticks remaining before the next shot. */
  readonly cooldown = new Float32Array(this.capacity);

  /** Slot of the current target, or -1. Re-picked only when it lapses. */
  readonly target = new Int32Array(this.capacity);
  /**
   * Where this tower's soldiers gather, in world pixels.
   *
   * Zero means untouched, and the garrison then forms at the tower itself — a
   * barracks the player has never dragged a flag for still defends its own
   * doorstep. Clamped to the tier's rally range whenever it is set.
   */
  readonly rallyX = new Float32Array(this.capacity);
  readonly rallyY = new Float32Array(this.capacity);

  /**
   * What this tower has actually done, for its info panel.
   *
   * Counted as it happens rather than derived: a tower's contribution is the
   * one number a player cannot work out by looking, and it is what turns "is
   * this worth upgrading" from a guess into a reading (pillar P2).
   */
  readonly kills = new Int32Array(this.capacity);
  readonly damageDealt = new Float32Array(this.capacity);
  /** First / Last / Strongest / Weakest / Closest, persisted per tower. */
  readonly targetMode = new Uint8Array(this.capacity);

  readonly plotId = new Uint16Array(this.capacity);
  /** Total gold sunk in, so selling can refund a fraction of it. */
  readonly invested = new Int32Array(this.capacity);
  /** Ticks remaining while a sapper holds it down. */
  readonly disabledUntil = new Int32Array(this.capacity);

  /**
   * Next tick a perk on its own clock may fire — Glacier Heart's Freeze, a
   * Bulwark Order's taunt (#32).
   *
   * One timer, because no branch carries two perks that need their own rate.
   */
  readonly perkReadyTick = new Int32Array(this.capacity);

  /**
   * What a Nullifier's aura is currently doing to this tower's rate of fire.
   *
   * 1 when nothing is suppressing it. Recomputed from nothing each tick by the
   * behaviour system, so killing the Nullifier restores the tower on the very
   * next tick rather than whenever some expiry happens to lapse (#29).
   */
  readonly auraFireRate = new Float32Array(this.capacity);

  constructor(capacity = MAX_TOWERS) {
    super(capacity);
  }

  protected resetSlot(slot: number): void {
    this.x[slot] = 0;
    this.y[slot] = 0;
    this.typeIdx[slot] = 0;
    this.tier[slot] = 0;
    this.specialisation[slot] = -1;
    this.leyNode[slot] = -1;
    this.damage[slot] = 0;
    this.range[slot] = 0;
    this.minRange[slot] = 0;
    this.fireInterval[slot] = 0;
    this.statusStacks[slot] = 0;
    this.cooldown[slot] = 0;
    this.target[slot] = -1;
    this.rallyX[slot] = 0;
    this.rallyY[slot] = 0;
    this.kills[slot] = 0;
    this.damageDealt[slot] = 0;
    this.targetMode[slot] = 0;
    this.plotId[slot] = 0;
    this.invested[slot] = 0;
    this.disabledUntil[slot] = 0;
    this.perkReadyTick[slot] = 0;
    this.auraFireRate[slot] = 1;
  }
}
