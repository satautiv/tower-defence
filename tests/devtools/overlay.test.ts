import { describe, expect, it, vi } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { createWorldForStage } from '@sim/index';
import type { World } from '@sim/index';
import { StageDevtools, TIME_SCALES } from '@devtools/overlay';

/**
 * The dev overlay's brain (#41).
 *
 * > Zero measurable overhead when hidden.
 *
 * Measuring that by timing something would be a flaky test that proves nothing
 * on a loaded runner, so it is asserted structurally instead, and the
 * structural claim is stronger than the timed one: **hidden, the overlay reads
 * no clock and touches no world**. A world behind a throwing Proxy is the
 * whole proof — any property the overlay reads while hidden throws, and the
 * test fails by name.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const fresh = (): World => createWorldForStage(registry, stage, 3);

/** A world that answers nothing. Reading any field of it is the failure. */
function forbidden(): World {
  return new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`the hidden overlay read world.${String(key)}`);
      },
    },
  ) as World;
}

/** Hands out a scripted clock, and counts how often it was asked. */
function scriptedClock(times: number[]): { calls: () => number; restore: () => void } {
  let index = 0;
  let calls = 0;
  const original = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => {
    calls++;
    const value = times[Math.min(index, times.length - 1)] as number;
    index++;
    return value;
  });
  return {
    calls: () => calls,
    restore: () => {
      vi.mocked(performance.now).mockRestore();
      void original;
    },
  };
}

describe('hidden, it costs nothing', () => {
  it('reads no field of the world', () => {
    const dev = new StageDevtools();
    const trap = forbidden();

    expect(() => dev.beginFrame(1_000, trap)).not.toThrow();
    expect(() => dev.beforeTick(trap)).not.toThrow();
    expect(() => dev.endSim(trap)).not.toThrow();
    expect(() => dev.endFrame(trap)).not.toThrow();
  });

  it('reads no clock', () => {
    const clock = scriptedClock([0]);
    try {
      const dev = new StageDevtools();
      const trap = forbidden();
      for (let frame = 0; frame < 10; frame++) {
        dev.beginFrame(frame * 16, trap);
        dev.endSim(trap);
        dev.endFrame(trap);
      }
      expect(clock.calls()).toBe(0);
    } finally {
      clock.restore();
    }
  });

  /* The clock it hands back is the one it was given, to the bit. An overlay
     that existed could otherwise move the game's own timing. */
  it('hands the session back the timestamp it was given', () => {
    const dev = new StageDevtools();
    const trap = forbidden();
    expect(dev.beginFrame(1_234.5, trap)).toBe(1_234.5);
    expect(dev.beginFrame(1_250.5, trap)).toBe(1_250.5);
  });

  it('has no damage log to read', () => {
    const dev = new StageDevtools();
    dev.watch(7);
    expect(dev.damageLog().entries).toEqual([]);
  });
});

describe('visible, it measures the split', () => {
  it('separates the simulation from the drawing', () => {
    /* Two frames, because the first has no previous frame to measure a frame
       time against and is dropped. Each runs 4ms of simulation and 8ms of
       drawing, 16ms apart. */
    const clock = scriptedClock([4, 12, 20, 28]);
    try {
      const dev = new StageDevtools();
      dev.toggleVisible();
      const world = fresh();

      for (const at of [0, 16]) {
        dev.beginFrame(at, world);
        dev.endSim(world);
        dev.endFrame(world);
      }

      const stats = dev.frameStats();
      expect(stats.simMs).toBeCloseTo(4, 5);
      expect(stats.renderMs).toBeCloseTo(8, 5);
      expect(stats.samples).toBe(1);
    } finally {
      clock.restore();
    }
  });

  /**
   * The finding that put this field here, found by opening the overlay in a
   * browser rather than by a test.
   *
   * `simMs + renderMs` is how much *work* a frame did, and on a healthy
   * machine that is a small fraction of the 16.6ms the frame was given — so a
   * rate derived from it reads in the thousands and means nothing. The first
   * draft did exactly that and reported 4,317 fps over a board doing almost
   * nothing. The rate has to come from the wall clock between frames.
   */
  it('reports the rate the screen refreshes at, not the rate it does work at', () => {
    /* 1ms of work in a frame that took 16ms: 60fps, not 1000. */
    const clock = scriptedClock([0.5, 1, 16.5, 17]);
    try {
      const dev = new StageDevtools();
      dev.toggleVisible();
      const world = fresh();

      for (const at of [0, 16]) {
        dev.beginFrame(at, world);
        dev.endSim(world);
        dev.endFrame(world);
      }

      const stats = dev.frameStats();
      expect(stats.simMs + stats.renderMs).toBeCloseTo(1, 5);
      expect(stats.frameMs).toBeCloseTo(16, 5);
      expect(stats.fps).toBeCloseTo(62.5, 5);
    } finally {
      clock.restore();
    }
  });

  /* Speed multiplies the number of ticks per frame, so "how much sim did this
     frame do" is a count and not a duration. */
  it('counts the ticks the frame ran', () => {
    const clock = scriptedClock([2, 6, 18, 22]);
    try {
      const dev = new StageDevtools();
      dev.toggleVisible();
      const world = fresh();

      for (const [at, ticks] of [
        [0, 1],
        [16, 3],
      ] as const) {
        dev.beginFrame(at, world);
        world.tick += ticks;
        dev.endSim(world);
        dev.endFrame(world);
      }

      expect(dev.frameStats().ticks).toBe(3);
    } finally {
      clock.restore();
    }
  });

  it('samples the event buffer, which the frame clears', () => {
    const clock = scriptedClock([1, 2]);
    try {
      const dev = new StageDevtools();
      dev.toggleVisible();
      const world = fresh();
      world.events.push(1, 2, 3, 4, 5, 6);

      dev.beginFrame(0, world);
      dev.endSim(world);
      /* The consumers have drained it by the time anything polls. */
      world.events.clear();

      const buffers = dev.worldStats(world).buffers;
      const events = buffers.find((buffer) => buffer.name === 'events');
      expect(events?.count).toBe(0);
      expect(events?.peak).toBe(1);
    } finally {
      clock.restore();
    }
  });
});

describe('the time scale', () => {
  it('offers the range the issue asks for', () => {
    expect(TIME_SCALES[0]).toBe(0.1);
    expect(TIME_SCALES[TIME_SCALES.length - 1]).toBe(10);
  });

  it('advances the clock at the chosen rate', () => {
    const dev = new StageDevtools();
    const world = fresh();

    dev.beginFrame(1_000, world);
    dev.setTimeScale(0.5);
    const first = dev.beginFrame(1_100, world);
    const second = dev.beginFrame(1_200, world);

    expect(first).toBeCloseTo(1_050, 5);
    expect(second).toBeCloseTo(1_100, 5);
  });

  /**
   * The trap this shape exists to avoid.
   *
   * A clock re-derived from real time would snap forward on leaving slow
   * motion and burst every tick it had not run into one frame. Accumulating
   * means leaving 0.1x is simply a change of rate.
   */
  it('never jumps when the rate changes', () => {
    const dev = new StageDevtools();
    const world = fresh();

    let previous = dev.beginFrame(0, world);
    dev.setTimeScale(0.1);
    for (let frame = 1; frame <= 60; frame++) {
      const now = dev.beginFrame(frame * 16, world);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now - previous).toBeLessThanOrEqual(16 * 10 + 1e-6);
      previous = now;
    }

    dev.setTimeScale(1);
    for (let frame = 61; frame <= 120; frame++) {
      const now = dev.beginFrame(frame * 16, world);
      expect(now).toBeGreaterThanOrEqual(previous);
      expect(now - previous).toBeLessThanOrEqual(16 * 10 + 1e-6);
      previous = now;
    }
  });
});

describe('the state the panel reads', () => {
  /* `useSyncExternalStore` re-renders forever if the snapshot is a fresh
     object each call, so identity between changes is a correctness property
     rather than an optimisation. */
  it('is the same object until something changes', () => {
    const dev = new StageDevtools();
    expect(dev.getState()).toBe(dev.getState());

    const before = dev.getState();
    dev.setToggle('grid', true);
    expect(dev.getState()).not.toBe(before);
    expect(dev.getState().toggles.grid).toBe(true);
  });

  it('tells its subscribers, and stops when they leave', () => {
    const dev = new StageDevtools();
    const listener = vi.fn();
    const unsubscribe = dev.subscribe(listener);

    dev.toggleVisible();
    dev.setTimeScale(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    dev.setToggle('paths', true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  /* A cheat is a mutation with no command behind it, so a recording made
     across one is not a replay of anything. The overlay has to be able to say
     so, which means it has to remember. */
  it('remembers that a cheat fired', () => {
    const dev = new StageDevtools();
    expect(dev.getState().cheated).toBe(false);
    dev.markCheated();
    expect(dev.getState().cheated).toBe(true);
    dev.reset();
    expect(dev.getState().cheated).toBe(false);
  });
});

describe('recording', () => {
  it('returns nothing when it was not recording', () => {
    const dev = new StageDevtools();
    expect(dev.stopRecording({ stageId: '1-1' }, 3)).toBeNull();
  });

  it('carries the seed and the stage, which a replay is nothing without', () => {
    const dev = new StageDevtools();
    const world = fresh();
    dev.startRecording();
    expect(dev.getState().recording).toBe(true);

    dev.beforeTick(world);
    const replay = dev.stopRecording({ stageId: '1-1', modeId: 'normal' }, world.config.seed);

    expect(replay?.stageId).toBe('1-1');
    expect(replay?.seed).toBe(world.config.seed);
    expect(replay?.modeId).toBe('normal');
    expect(dev.getState().recording).toBe(false);
  });
});
