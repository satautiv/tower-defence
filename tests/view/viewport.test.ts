import { describe, expect, it } from 'vitest';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@core/constants';
import {
  MAX_RESOLUTION,
  canvasToLogical,
  clampResolution,
  fitViewport,
  logicalToCanvas,
} from '@view/viewport';

/** Real devices, so "works across aspect ratios" is checked against actual shapes. */
const DEVICES = [
  { name: 'desktop 16:9', width: 1920, height: 1080 },
  { name: 'desktop ultrawide 21:9', width: 2560, height: 1080 },
  { name: 'laptop 16:10', width: 1680, height: 1050 },
  { name: 'tablet 4:3 landscape', width: 1024, height: 768 },
  { name: 'phone 19.5:9 landscape', width: 844, height: 390 },
  { name: 'phone 16:9 landscape', width: 800, height: 450 },
  { name: 'square', width: 900, height: 900 },
  { name: 'portrait', width: 500, height: 900 },
];

describe('fitting the design resolution to a device', () => {
  it.each(DEVICES)('scales uniformly on $name, so nothing is distorted', ({ width, height }) => {
    const v = fitViewport({ canvasWidth: width, canvasHeight: height });

    /* One scale for both axes is what "no distortion" means: the rendered
       aspect ratio must equal the design aspect ratio exactly. */
    expect(v.width / v.height).toBeCloseTo(LOGICAL_WIDTH / LOGICAL_HEIGHT, 6);
  });

  it.each(DEVICES)('fits inside the canvas on $name without overflowing', ({ width, height }) => {
    const v = fitViewport({ canvasWidth: width, canvasHeight: height });
    expect(v.width).toBeLessThanOrEqual(width + 1e-6);
    expect(v.height).toBeLessThanOrEqual(height + 1e-6);
  });

  it.each(DEVICES)('centres the letterbox on $name', ({ width, height }) => {
    const v = fitViewport({ canvasWidth: width, canvasHeight: height });
    expect(v.offsetX).toBeCloseTo((width - v.width) / 2, 6);
    expect(v.offsetY).toBeCloseTo((height - v.height) / 2, 6);
  });

  it('fills exactly at the design resolution', () => {
    const v = fitViewport({ canvasWidth: LOGICAL_WIDTH, canvasHeight: LOGICAL_HEIGHT });
    expect(v.scale).toBe(1);
    expect(v.offsetX).toBe(0);
    expect(v.offsetY).toBe(0);
  });

  it('letterboxes top and bottom when the canvas is wider than the design', () => {
    const v = fitViewport({ canvasWidth: 2560, canvasHeight: 1080 });
    expect(v.offsetX).toBeGreaterThan(0);
    expect(v.offsetY).toBeCloseTo(0, 6);
  });

  it('letterboxes left and right when the canvas is taller than the design', () => {
    const v = fitViewport({ canvasWidth: 1920, canvasHeight: 1600 });
    expect(v.offsetY).toBeGreaterThan(0);
    expect(v.offsetX).toBeCloseTo(0, 6);
  });
});

describe('safe areas', () => {
  it('keeps the whole board clear of a notch', () => {
    const insets = { top: 20, right: 44, bottom: 20, left: 44 };
    const v = fitViewport({ canvasWidth: 844, canvasHeight: 390, insets });

    expect(v.offsetX).toBeGreaterThanOrEqual(insets.left);
    expect(v.offsetY).toBeGreaterThanOrEqual(insets.top);
    expect(v.offsetX + v.width).toBeLessThanOrEqual(844 - insets.right + 1e-6);
    expect(v.offsetY + v.height).toBeLessThanOrEqual(390 - insets.bottom + 1e-6);
  });

  it('still scales uniformly once insets are applied', () => {
    const v = fitViewport({
      canvasWidth: 844,
      canvasHeight: 390,
      insets: { top: 0, right: 59, bottom: 21, left: 59 },
    });
    expect(v.width / v.height).toBeCloseTo(LOGICAL_WIDTH / LOGICAL_HEIGHT, 6);
  });
});

describe('resolution', () => {
  it('caps the backing store at 2x, beyond which nobody can see the difference', () => {
    expect(clampResolution(3)).toBe(MAX_RESOLUTION);
    expect(clampResolution(2)).toBe(2);
    expect(clampResolution(1.5)).toBe(1.5);
    expect(clampResolution(1)).toBe(1);
  });

  it('falls back to 1 for nonsense values', () => {
    expect(clampResolution(0)).toBe(1);
    expect(clampResolution(-1)).toBe(1);
    expect(clampResolution(Number.NaN)).toBe(1);
  });
});

describe('degenerate canvases', () => {
  it('returns a usable viewport for a zero-area canvas instead of NaN', () => {
    const v = fitViewport({ canvasWidth: 0, canvasHeight: 0 });
    expect(Number.isNaN(v.scale)).toBe(false);
    expect(v.scale).toBe(1);
  });

  it('survives insets larger than the canvas', () => {
    const v = fitViewport({
      canvasWidth: 100,
      canvasHeight: 100,
      insets: { top: 80, right: 80, bottom: 80, left: 80 },
    });
    expect(Number.isFinite(v.scale)).toBe(true);
  });
});

describe('coordinate conversion', () => {
  it('round-trips between canvas and design space', () => {
    const v = fitViewport({ canvasWidth: 1280, canvasHeight: 800 });
    const logical = canvasToLogical(v, 640, 400);
    const back = logicalToCanvas(v, logical.x, logical.y);
    expect(back.x).toBeCloseTo(640, 6);
    expect(back.y).toBeCloseTo(400, 6);
  });

  it('maps the canvas centre to the design centre', () => {
    const v = fitViewport({ canvasWidth: 1280, canvasHeight: 800 });
    const logical = canvasToLogical(v, 640, 400);
    expect(logical.x).toBeCloseTo(LOGICAL_WIDTH / 2, 6);
    expect(logical.y).toBeCloseTo(LOGICAL_HEIGHT / 2, 6);
  });
});
