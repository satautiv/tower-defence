import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '@core/loop';

const TICK = 10; // round numbers keep these tests about behaviour, not float noise

const loop = (overrides = {}) =>
  new FixedStepLoop({ tickMs: TICK, maxCatchupSteps: 5, maxFrameDeltaMs: 250, ...overrides });

/** Runs `frames` frames of exactly one tick each and totals the steps produced. */
function run(l: FixedStepLoop, frames: number, speed: number, frameMs = TICK): number {
  let now = 0;
  l.reset(now);
  let total = 0;
  for (let i = 0; i < frames; i++) {
    now += frameMs;
    total += l.advance(now, speed).steps;
  }
  return total;
}

describe('FixedStepLoop', () => {
  it('rejects a non-positive tick length', () => {
    expect(() => new FixedStepLoop({ tickMs: 0 })).toThrow(RangeError);
  });

  it('produces no steps before a full tick has elapsed', () => {
    const l = loop();
    l.reset(0);
    expect(l.advance(TICK - 1).steps).toBe(0);
  });

  it('produces exactly one step per elapsed tick', () => {
    const l = loop();
    l.reset(0);
    expect(l.advance(TICK).steps).toBe(1);
    expect(l.advance(TICK * 3).steps).toBe(2);
  });

  it('treats the first advance as an anchor, not as elapsed time', () => {
    const l = new FixedStepLoop({ tickMs: TICK });
    expect(l.advance(1_000_000).steps).toBe(0);
    expect(l.advance(1_000_000 + TICK).steps).toBe(1);
  });

  it('reports the leftover fraction of a tick for interpolation', () => {
    const l = loop();
    l.reset(0);
    expect(l.advance(TICK * 1.5).alpha).toBeCloseTo(0.5, 10);
    expect(l.alpha).toBeCloseTo(0.5, 10);
  });

  it('ignores time going backwards', () => {
    const l = loop();
    l.reset(100);
    expect(l.advance(50).steps).toBe(0);
  });

  it('drops pending time on reset', () => {
    const l = loop();
    l.reset(0);
    l.advance(TICK * 0.9);
    l.reset(TICK * 0.9);
    expect(l.advance(TICK * 0.9 + 1).steps).toBe(0);
  });
});

describe('speed multiplies ticks rather than stretching them', () => {
  it('runs `speed` ticks for each elapsed tick', () => {
    const l = loop();
    l.reset(0);
    expect(l.advance(TICK, 3).steps).toBe(3);
  });

  /**
   * The property the whole fast-forward design rests on. Because every tick is
   * the same length and speed only changes how many run, 3x over a given span
   * of wall-clock time performs exactly three times the ticks of 1x — so the
   * simulation reaches an identical state, just sooner. Scaling delta time
   * instead would make fast-forward a measurably different game.
   */
  it('performs exactly 3x the ticks of 1x over the same wall-clock span', () => {
    const frames = 100;
    expect(run(loop(), frames, 3)).toBe(3 * run(loop(), frames, 1));
  });

  it('holds that ratio for every supported speed', () => {
    const frames = 60;
    const atOne = run(loop(), frames, 1);
    for (const speed of [1, 2, 3]) {
      expect(run(loop(), frames, speed)).toBe(atOne * speed);
    }
  });

  it('scales the catch-up budget with speed, so fast-forward is not throttled', () => {
    const l = loop();
    l.reset(0);
    /* Four ticks of pending time, well inside the budget at any speed. */
    expect(l.advance(TICK * 4, 3).steps).toBe(12);
  });
});

describe('catch-up is bounded', () => {
  it('clamps an enormous frame delta instead of freezing to catch up', () => {
    const l = loop();
    l.reset(0);
    const step = l.advance(60_000);
    expect(step.clamped).toBe(true);
    expect(step.steps).toBeLessThanOrEqual(5);
  });

  it('discards the backlog rather than compounding it across frames', () => {
    const l = loop();
    l.reset(0);
    l.advance(60_000);
    /* If the backlog had been carried, the next ordinary frame would still be
       catching up instead of producing a single tick. */
    expect(l.advance(60_000 + TICK).steps).toBe(1);
  });

  it('caps steps at the configured catch-up limit', () => {
    const l = new FixedStepLoop({ tickMs: TICK, maxCatchupSteps: 2, maxFrameDeltaMs: 250 });
    l.reset(0);
    expect(l.advance(TICK * 100).steps).toBe(2);
  });
});
