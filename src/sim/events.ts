import { EventBuffer } from '@core/events';
import { MAX_EVENTS_PER_TICK } from './capacity.js';

/**
 * What the simulation tells the outside world.
 *
 * The simulation never calls a renderer, an audio mixer or a React setter. It
 * writes records into a buffer that the view and audio layers drain each frame,
 * which is precisely why it runs headless under Node with nobody listening —
 * and therefore why the balance simulator can exist at all.
 *
 * Payloads are five untyped numbers in a preallocated record. The typed
 * emitters below are the only place that knows what each slot means, so a
 * consumer reading `e.c` for a damage type has one definition to check.
 */
export const enum SimEventKind {
  EnemySpawned = 1,
  EnemyDied,
  EnemyLeaked,
  DamageDealt,
  StatusApplied,
  ReactionTriggered,
  TowerBuilt,
  TowerUpgraded,
  TowerSold,
  TowerDisabled,
  ProjectileFired,
  ProjectileHit,
  SoldierSpawned,
  SoldierDied,
  PowerCast,
  GoldChanged,
  AetherChanged,
  LifeLost,
  WaveStarted,
  WaveCleared,
  StageWon,
  StageLost,
  CommandRejected,
  /** An enemy behaviour took effect, for its telegraph and its sound (#29). */
  BehaviourFired,
  /** A boss crossed a health threshold into its next phase (#33). */
  BossPhaseChanged,
}

export class SimEvents {
  private readonly buffer = new EventBuffer(MAX_EVENTS_PER_TICK);

  get count(): number {
    return this.buffer.count;
  }

  get dropped(): number {
    return this.buffer.dropped;
  }

  at(index: number) {
    return this.buffer.at(index);
  }

  /** Called at the end of each tick, once the view and audio have drained it. */
  clear(): void {
    this.buffer.clear();
  }

  reset(): void {
    this.buffer.reset();
  }

  push(kind: SimEventKind, a = 0, b = 0, c = 0, d = 0, e = 0): boolean {
    return this.buffer.push(kind, a, b, c, d, e);
  }
}

/* Typed emitters. Positions are documented once, here. */

export const emitEnemySpawned = (
  ev: SimEvents,
  id: number,
  typeIdx: number,
  x: number,
  y: number,
) => ev.push(SimEventKind.EnemySpawned, id, typeIdx, x, y);

/**
 * An enemy died. `boss` is 1 for a boss or elite, 0 otherwise (#33).
 *
 * Carried on the event rather than looked up by the consumer, because by the
 * time the audio and view layers drain this the slot has been freed and the
 * only honest answer would be a guess. It is also the cue for the defeat
 * sequence, which has to fire on the frame the kill lands.
 */
export const emitEnemyDied = (
  ev: SimEvents,
  id: number,
  x: number,
  y: number,
  damageType: number,
  boss = 0,
) => ev.push(SimEventKind.EnemyDied, id, x, y, damageType, boss);

export const emitEnemyLeaked = (ev: SimEvents, id: number, livesCost: number) =>
  ev.push(SimEventKind.EnemyLeaked, id, livesCost);

/**
 * What was true of one resolved hit.
 *
 * A flag set rather than the plain `fromReaction` boolean this used to carry,
 * because the damage log (#41) has to reconcile to an enemy's lost health and
 * a hit swallowed by an overshield never reached it. Without telling the two
 * apart the log over-counts by exactly the shield.
 */
export const enum DamageEventFlag {
  None = 0,
  FromReaction = 1 << 0,
  /** Absorbed by an overshield: real damage that cost no health. */
  Absorbed = 1 << 1,
}

/**
 * One resolved hit, after armour, ward and every multiplier.
 *
 * Carries the tower that dealt it — or -1 for a burn, a reaction or a soldier —
 * so the log can answer "what killed this" with names rather than a total.
 */
export const emitDamageDealt = (
  ev: SimEvents,
  targetId: number,
  amount: number,
  damageType: number,
  flags: number,
  source = -1,
) => ev.push(SimEventKind.DamageDealt, targetId, amount, damageType, flags, source);

/**
 * A status landed or was topped up. Carries the resulting stack count rather
 * than the number applied, because that is what an icon above the health bar
 * has to show — and the two differ whenever a hit lands against the cap.
 */
export const emitStatusApplied = (
  ev: SimEvents,
  targetId: number,
  statusIdx: number,
  stacks: number,
) => ev.push(SimEventKind.StatusApplied, targetId, statusIdx, stacks);

export const emitReactionTriggered = (
  ev: SimEvents,
  reactionIdx: number,
  x: number,
  y: number,
  magnitude: number,
) => ev.push(SimEventKind.ReactionTriggered, reactionIdx, x, y, magnitude);

/** A Sapper got through: this tower holds fire for `ticks` (#29). */
export const emitTowerDisabled = (ev: SimEvents, towerId: number, ticks: number) =>
  ev.push(SimEventKind.TowerDisabled, towerId, ticks);

/**
 * An enemy behaviour took effect (#29).
 *
 * Carries the `BehaviourFlag` rather than a per-behaviour event kind, because
 * the view's job is identical for all of them — draw the telegraph this enemy's
 * behaviour calls for at this position — and a dozen near-identical event kinds
 * would be a dozen places to forget one. `subjectId` is whoever the behaviour
 * happened *to* where that differs from the source, so a shield can be drawn on
 * the ally that received it.
 */
export const emitBehaviour = (
  ev: SimEvents,
  subjectId: number,
  behaviour: number,
  x: number,
  y: number,
) => ev.push(SimEventKind.BehaviourFired, subjectId, behaviour, x, y);

/**
 * A boss entered a new phase (#33).
 *
 * Carries the row it became rather than a phase number, because that is what
 * the view already indexes to find a sprite — and it is the same number the
 * simulation itself switched to, so there is no second notion of "which phase"
 * to drift out of step.
 */
export const emitBossPhase = (ev: SimEvents, id: number, typeIdx: number, x: number, y: number) =>
  ev.push(SimEventKind.BossPhaseChanged, id, typeIdx, x, y);

/** A Warden Power went off, for its VFX and its sound. */
export const emitPowerCast = (ev: SimEvents, powerIdx: number, x: number, y: number) =>
  ev.push(SimEventKind.PowerCast, powerIdx, x, y);

export const emitTowerBuilt = (ev: SimEvents, id: number, typeIdx: number, plotId: number) =>
  ev.push(SimEventKind.TowerBuilt, id, typeIdx, plotId);

export const emitProjectileFired = (ev: SimEvents, id: number, sourceTower: number) =>
  ev.push(SimEventKind.ProjectileFired, id, sourceTower);

export const emitLifeLost = (ev: SimEvents, remaining: number, cost: number) =>
  ev.push(SimEventKind.LifeLost, remaining, cost);

export const emitWaveStarted = (ev: SimEvents, waveIndex: number) =>
  ev.push(SimEventKind.WaveStarted, waveIndex);

export const emitWaveCleared = (ev: SimEvents, waveIndex: number, bonusGold: number) =>
  ev.push(SimEventKind.WaveCleared, waveIndex, bonusGold);

/**
 * A command the simulation refused — unaffordable, plot taken, tower already at
 * max tier. The UI needs to say why rather than appearing to ignore the click.
 */
export const emitCommandRejected = (ev: SimEvents, kind: number, reason: number) =>
  ev.push(SimEventKind.CommandRejected, kind, reason);
