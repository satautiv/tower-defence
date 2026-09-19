import { EventBuffer } from '@core/events';
import { MAX_COMMANDS_PER_TICK } from './capacity.js';

/**
 * Player intent, queued and applied at a tick boundary.
 *
 * Nothing outside the simulation mutates the world. The UI, the hero controls
 * and the balance simulator's scripted AI all express themselves as commands,
 * which is what lets the simulator drive a stage through exactly the interface
 * a human uses — and what makes a replay a seed plus an ordered command list.
 *
 * Applied in step 0 of the tick, never mid-pipeline. A build landing halfway
 * through targeting would let a tower fire on the tick it was placed in one run
 * and not in another, depending on when the click arrived.
 *
 * Backed by the same preallocated record buffer as SimEvents: identical shape,
 * and one implementation to keep allocation-free rather than two.
 */
export const enum CommandKind {
  BuildTower = 1,
  UpgradeTower,
  Specialise,
  SellTower,
  SetTargetMode,
  CastPower,
  SetRally,
  MoveHero,
  CastHeroAbility,
  CallWave,
  SetSpeed,
  UseInteractable,
}

export class CommandQueue {
  private readonly buffer = new EventBuffer(MAX_COMMANDS_PER_TICK);

  get count(): number {
    return this.buffer.count;
  }

  /**
   * Commands refused because the queue was full.
   *
   * Unlike a dropped event, a dropped command loses a player action, so any
   * non-zero value here is a bug rather than a tolerable overflow. The queue is
   * sized far above human input rates so it should stay at zero.
   */
  get dropped(): number {
    return this.buffer.dropped;
  }

  at(index: number) {
    return this.buffer.at(index);
  }

  clear(): void {
    this.buffer.clear();
  }

  reset(): void {
    this.buffer.reset();
  }

  /** Returns false when the queue is full, so callers can surface a rejection. */
  push(kind: CommandKind, a = 0, b = 0, c = 0, d = 0, e = 0): boolean {
    return this.buffer.push(kind, a, b, c, d, e);
  }
}

/* Typed wrappers. The payload slots are positional and untyped in the buffer,
   so every command has exactly one place that knows what its numbers mean. */

export const buildTower = (q: CommandQueue, plotId: number, towerTypeIdx: number): boolean =>
  q.push(CommandKind.BuildTower, plotId, towerTypeIdx);

export const upgradeTower = (q: CommandQueue, towerSlot: number): boolean =>
  q.push(CommandKind.UpgradeTower, towerSlot);

export const specialiseTower = (q: CommandQueue, towerSlot: number, branch: 0 | 1): boolean =>
  q.push(CommandKind.Specialise, towerSlot, branch);

export const sellTower = (q: CommandQueue, towerSlot: number): boolean =>
  q.push(CommandKind.SellTower, towerSlot);

export const setTargetMode = (q: CommandQueue, towerSlot: number, mode: number): boolean =>
  q.push(CommandKind.SetTargetMode, towerSlot, mode);

export const castPower = (q: CommandQueue, powerIdx: number, x: number, y: number): boolean =>
  q.push(CommandKind.CastPower, powerIdx, x, y);

export const setRally = (q: CommandQueue, towerSlot: number, x: number, y: number): boolean =>
  q.push(CommandKind.SetRally, towerSlot, x, y);

export const moveHero = (q: CommandQueue, x: number, y: number): boolean =>
  q.push(CommandKind.MoveHero, x, y);

export const castHeroAbility = (q: CommandQueue, abilityIdx: number, x = 0, y = 0): boolean =>
  q.push(CommandKind.CastHeroAbility, abilityIdx, x, y);

export const callWave = (q: CommandQueue): boolean => q.push(CommandKind.CallWave);

export const setSpeed = (q: CommandQueue, speed: number): boolean =>
  q.push(CommandKind.SetSpeed, speed);

export const useInteractable = (q: CommandQueue, interactableIdx: number): boolean =>
  q.push(CommandKind.UseInteractable, interactableIdx);
