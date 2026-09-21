import { describe, expect, it } from 'vitest';
import { Cinematic } from '@app/cinematic';

/**
 * Hitstop and slow-motion (#33, docs/GAME_DESIGN.md §17.2).
 *
 * The property that matters is not how it feels but what it must not do: the
 * simulation runs the same ticks in the same order whatever this says, because
 * it only ever changes how much wall-clock time the loop is handed.
 */

describe('a boss death holds the board and then runs it slowly', () => {
  const made = (): Cinematic =>
    new Cinematic({ hitstopMs: 400, slowMotionMs: 1000, slowMotionScale: 0.25 });

  it('runs at full speed with nothing happening', () => {
    expect(made().scaleAt(1000)).toBe(1);
  });

  it('stops time dead for the hitstop', () => {
    const cinematic = made();
    cinematic.trigger(1000);
    expect(cinematic.scaleAt(1000)).toBe(0);
    expect(cinematic.scaleAt(1399)).toBe(0);
  });

  it('runs slowly after it, and then not at all', () => {
    const cinematic = made();
    cinematic.trigger(1000);
    expect(cinematic.scaleAt(1400)).toBe(0.25);
    expect(cinematic.scaleAt(2399)).toBe(0.25);
    expect(cinematic.scaleAt(2400)).toBe(1);
    expect(cinematic.active).toBe(false);
  });

  /* Two bosses dying in one frame is one moment. Queueing them would hand the
     player most of a second of hitstop, which §17.2 is explicit about: it
     becomes mush. */
  it('restarts rather than queueing when triggered again', () => {
    const cinematic = made();
    cinematic.trigger(1000);
    cinematic.trigger(1200);
    expect(cinematic.scaleAt(1500)).toBe(0);
    expect(cinematic.scaleAt(1600)).toBe(0.25);
  });

  /* A backgrounded tab hands back a clock that can look like it went
     backwards. Holding the world still until it caught up would be a freeze
     the player cannot end. */
  it('gives up on a clock that goes backwards', () => {
    const cinematic = made();
    cinematic.trigger(1000);
    expect(cinematic.scaleAt(900)).toBe(1);
    expect(cinematic.active).toBe(false);
  });

  it('is over after a reset', () => {
    const cinematic = made();
    cinematic.trigger(1000);
    cinematic.reset();
    expect(cinematic.active).toBe(false);
    expect(cinematic.scaleAt(1100)).toBe(1);
  });
});
