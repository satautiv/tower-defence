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

export const emitEnemyDied = (
  ev: SimEvents,
  id: number,
  x: number,
  y: number,
  damageType: number,
) => ev.push(SimEventKind.EnemyDied, id, x, y, damageType);

export const emitEnemyLeaked = (ev: SimEvents, id: number, livesCost: number) =>
  ev.push(SimEventKind.EnemyLeaked, id, livesCost);

export const emitDamageDealt = (
  ev: SimEvents,
  targetId: number,
  amount: number,
  damageType: number,
  fromReaction: number,
) => ev.push(SimEventKind.DamageDealt, targetId, amount, damageType, fromReaction);

export const emitReactionTriggered = (
  ev: SimEvents,
  reactionIdx: number,
  x: number,
  y: number,
  magnitude: number,
) => ev.push(SimEventKind.ReactionTriggered, reactionIdx, x, y, magnitude);

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
