import { describe, expect, it } from 'vitest';
import { FrameMetrics } from '@view/metrics';

/**
 * The numbers the Android smoke build reports (#20) and the device matrix
 * measures against (#56). If they are wrong, a phone that cannot hold 60fps
 * looks like one that can.
 */

function feed(metrics: FrameMetrics, deltas: readonly number[]): void {
  let now = 1000;
  metrics.record(now);
  for (const delta of deltas) {
    now += delta;
    metrics.record(now);
  }
}

describe('FrameMetrics', () => {
  it('reports nothing before it has seen a frame', () => {
    const stats = new FrameMetrics().stats();
    expect(stats.samples).toBe(0);
    expect(stats.fps).toBe(0);
  });

  it('converts a steady frame time into a frame rate', () => {
    const metrics = new FrameMetrics();
    feed(
      metrics,
      Array.from({ length: 60 }, () => 16.67),
    );

    const stats = metrics.stats();
    expect(stats.fps).toBeCloseTo(60, 0);
    expect(stats.meanMs).toBeCloseTo(16.67, 2);
  });

  /* The first delta spans everything before the loop started, so counting it
     would report the load time as a frame. */
  it('ignores the first frame, which has no meaningful delta', () => {
    const metrics = new FrameMetrics();
    feed(metrics, [16, 16, 16]);
    expect(metrics.stats().samples).toBe(3);
  });

  /**
   * The reason a mean is not enough. A stage that renders at 60fps with one
   * 90ms hitch per wave feels broken while averaging beautifully.
   */
  it('surfaces a hitch that the mean hides', () => {
    const metrics = new FrameMetrics();
    feed(metrics, [...Array.from({ length: 99 }, () => 16.67), 90]);

    const stats = metrics.stats();
    expect(stats.fps).toBeGreaterThan(55);
    expect(stats.worstMs).toBeCloseTo(90, 0);
    expect(stats.p95Ms).toBeGreaterThanOrEqual(16.67);
  });

  it('counts frames over the budget', () => {
    const metrics = new FrameMetrics();
    feed(metrics, [16, 16, 30, 16, 40]);
    expect(metrics.stats().droppedFrames).toBe(2);
  });

  it('reports the time to the first frame, for the launch budget', () => {
    const metrics = new FrameMetrics();
    metrics.record(2500);
    expect(metrics.timeToFirstFrameMs).toBe(2500);
  });

  /* A long session must not grow the sample buffer without limit. */
  it('keeps a bounded window over a long run', () => {
    const metrics = new FrameMetrics();
    feed(
      metrics,
      Array.from({ length: 5000 }, () => 16.67),
    );

    const stats = metrics.stats();
    expect(stats.samples).toBeLessThanOrEqual(240);
    expect(stats.fps).toBeCloseTo(60, 0);
  });

  it('reports a slow device as slow', () => {
    const metrics = new FrameMetrics();
    feed(
      metrics,
      Array.from({ length: 60 }, () => 33.3),
    );
    expect(metrics.stats().fps).toBeCloseTo(30, 0);
  });

  it('starts fresh on reset', () => {
    const metrics = new FrameMetrics();
    feed(metrics, [50, 50, 50]);
    metrics.reset();
    expect(metrics.stats().samples).toBe(0);
    expect(metrics.stats().droppedFrames).toBe(0);
  });
});
