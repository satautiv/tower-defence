import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@core/constants';

/**
 * Fits the fixed design resolution into whatever canvas the device gives us.
 *
 * The game is laid out once at 1920x1080 and scaled to fit. Uniform scale on
 * both axes, so a phone in landscape gets letterbox bars rather than a stretched
 * board — a distorted range circle would misrepresent what a tower actually
 * covers, which is information the player is making decisions on.
 *
 * Pure geometry, deliberately: this is the part that has to be right across
 * every aspect ratio, and it can be tested exhaustively without a GPU.
 */

/** Notch, punch-hole and gesture-bar margins. Zero on desktop. */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface Viewport {
  /** Logical pixels to CSS pixels. */
  scale: number;
  /** Letterbox offset from the canvas origin, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** Rendered content size in CSS pixels. */
  width: number;
  height: number;
  /** Backing-store multiplier handed to the renderer. */
  resolution: number;
}

/**
 * Beyond 2x, extra backing-store pixels cost fill rate and battery for a
 * difference nobody can see on a phone held at arm's length.
 */
export const MAX_RESOLUTION = 2;

export function clampResolution(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_RESOLUTION);
}

export interface FitOptions {
  canvasWidth: number;
  canvasHeight: number;
  logicalWidth?: number;
  logicalHeight?: number;
  insets?: SafeAreaInsets;
  devicePixelRatio?: number;
}

export function fitViewport(options: FitOptions): Viewport {
  const {
    canvasWidth,
    canvasHeight,
    logicalWidth = LOGICAL_WIDTH,
    logicalHeight = LOGICAL_HEIGHT,
    insets = NO_INSETS,
    devicePixelRatio = 1,
  } = options;

  /* A zero-area canvas happens during layout and on a hidden tab. Fall back to
     a valid viewport rather than producing NaN that poisons every transform. */
  const safeWidth = Math.max(0, canvasWidth - insets.left - insets.right);
  const safeHeight = Math.max(0, canvasHeight - insets.top - insets.bottom);
  if (safeWidth <= 0 || safeHeight <= 0 || logicalWidth <= 0 || logicalHeight <= 0) {
    return {
      scale: 1,
      offsetX: insets.left,
      offsetY: insets.top,
      width: 0,
      height: 0,
      resolution: clampResolution(devicePixelRatio),
    };
  }

  const scale = Math.min(safeWidth / logicalWidth, safeHeight / logicalHeight);
  const width = logicalWidth * scale;
  const height = logicalHeight * scale;

  return {
    scale,
    offsetX: insets.left + (safeWidth - width) / 2,
    offsetY: insets.top + (safeHeight - height) / 2,
    width,
    height,
    resolution: clampResolution(devicePixelRatio),
  };
}

/** CSS pixel position on the canvas to a point in the 1920x1080 design space. */
export function canvasToLogical(
  viewport: Viewport,
  canvasX: number,
  canvasY: number,
): { x: number; y: number } {
  if (viewport.scale === 0) return { x: 0, y: 0 };
  return {
    x: (canvasX - viewport.offsetX) / viewport.scale,
    y: (canvasY - viewport.offsetY) / viewport.scale,
  };
}

export function logicalToCanvas(
  viewport: Viewport,
  logicalX: number,
  logicalY: number,
): { x: number; y: number } {
  return {
    x: logicalX * viewport.scale + viewport.offsetX,
    y: logicalY * viewport.scale + viewport.offsetY,
  };
}

/**
 * Reads the CSS environment safe-area variables.
 *
 * Returns zeroes anywhere they are unavailable, which covers desktop browsers
 * and the test runner alike, so callers never need to branch on platform.
 */
export function readSafeAreaInsets(element?: HTMLElement): SafeAreaInsets {
  if (typeof globalThis.getComputedStyle !== 'function' || element === undefined) return NO_INSETS;
  const style = globalThis.getComputedStyle(element);
  const read = (property: string): number => {
    const value = Number.parseFloat(style.getPropertyValue(property));
    return Number.isFinite(value) ? value : 0;
  };
  return {
    top: read('--safe-area-top'),
    right: read('--safe-area-right'),
    bottom: read('--safe-area-bottom'),
    left: read('--safe-area-left'),
  };
}
