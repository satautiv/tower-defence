import { describe, expect, it } from 'vitest';
import { pinchZoomFactor, wheelZoomFactor } from '@view/input';

describe('wheel zoom', () => {
  it('zooms in on a negative delta and out on a positive one', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
  });

  it('does nothing on a zero delta', () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });

  /**
   * Multiplicative steps compose, so scrolling out and back in lands exactly
   * where it started and every notch feels the same at every zoom level. An
   * additive step is violent when zoomed out and useless when zoomed in.
   */
  it('is exactly reversible', () => {
    expect(wheelZoomFactor(120) * wheelZoomFactor(-120)).toBeCloseTo(1, 10);
  });

  it('composes, so two notches equal one of twice the size', () => {
    expect(wheelZoomFactor(50) * wheelZoomFactor(50)).toBeCloseTo(wheelZoomFactor(100), 10);
  });
});

describe('pinch zoom', () => {
  it('reports the ratio between spans', () => {
    expect(pinchZoomFactor(100, 200)).toBe(2);
    expect(pinchZoomFactor(200, 100)).toBe(0.5);
  });

  it('is neutral for a degenerate span rather than dividing by zero', () => {
    expect(pinchZoomFactor(0, 100)).toBe(1);
    expect(pinchZoomFactor(100, 0)).toBe(1);
  });
});
