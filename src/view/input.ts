import type { Camera } from './camera.js';
import { canvasToLogical } from './viewport.js';
import type { Viewport } from './viewport.js';

/**
 * Translates pointer and wheel input into camera movement.
 *
 * The arithmetic is exported separately from the event plumbing so the feel of
 * zooming — which is easy to get subtly wrong and annoying to debug through a
 * browser — can be pinned down in tests.
 */

/**
 * Wheel notches to a multiplicative zoom factor.
 *
 * Multiplicative rather than additive so that zooming out then back in returns
 * exactly where it started, and so each notch feels the same at every zoom
 * level. An additive step feels violent when zoomed out and useless when in.
 */
export function wheelZoomFactor(deltaY: number, sensitivity = 0.0015): number {
  return Math.exp(-deltaY * sensitivity);
}

export function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointerMidpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Ratio between two pinch spans, guarding the degenerate zero-span case. */
export function pinchZoomFactor(previousSpan: number, currentSpan: number): number {
  if (previousSpan <= 0 || currentSpan <= 0) return 1;
  return currentSpan / previousSpan;
}

/**
 * Below this, a press is a tap on whatever is underneath rather than a drag of
 * the camera. Without a threshold, every build tap nudges the map.
 */
export const DRAG_THRESHOLD_PX = 6;

export interface CameraControllerOptions {
  element: HTMLElement;
  camera: Camera;
  /** Supplies the current viewport; it changes on every resize. */
  getViewport: () => Viewport;
  /** Called for a press that never became a drag, in logical coordinates. */
  onTap?: (logicalX: number, logicalY: number) => void;
}

export class CameraController {
  private readonly options: CameraControllerOptions;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private lastPinchSpan = 0;
  private dragged = false;
  private pressOrigin?: { x: number; y: number };
  private attached = false;

  constructor(options: CameraControllerOptions) {
    this.options = options;
  }

  attach(): void {
    if (this.attached) return;
    const el = this.options.element;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    const el = this.options.element;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    this.pointers.clear();
    this.attached = false;
  }

  private localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.options.element.getBoundingClientRect();
    return canvasToLogical(
      this.options.getViewport(),
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.dragged = false;
      this.pressOrigin = { x: event.clientX, y: event.clientY };
    }
    if (this.pointers.size === 2) this.lastPinchSpan = this.currentSpan();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (previous === undefined) return;
    const current = { x: event.clientX, y: event.clientY };
    this.pointers.set(event.pointerId, current);

    if (this.pointers.size === 1) {
      const origin = this.pressOrigin;
      if (origin !== undefined && pointerDistance(origin, current) > DRAG_THRESHOLD_PX) {
        this.dragged = true;
      }
      if (!this.dragged) return;

      /* Divide by scale and zoom so the map tracks the finger exactly: a drag
         of n screen pixels must move the world by n screen pixels. */
      const { scale } = this.options.getViewport();
      const zoom = this.options.camera.zoom;
      const divisor = scale * zoom;
      if (divisor === 0) return;
      this.options.camera.panBy(
        -(current.x - previous.x) / divisor,
        -(current.y - previous.y) / divisor,
      );
      return;
    }

    if (this.pointers.size === 2) {
      this.dragged = true;
      const span = this.currentSpan();
      const factor = pinchZoomFactor(this.lastPinchSpan, span);
      this.lastPinchSpan = span;

      const [a, b] = [...this.pointers.values()];
      if (a === undefined || b === undefined) return;
      const rect = this.options.element.getBoundingClientRect();
      const mid = pointerMidpoint(a, b);
      const logical = canvasToLogical(
        this.options.getViewport(),
        mid.x - rect.left,
        mid.y - rect.top,
      );
      const world = this.options.camera.screenToWorld(logical.x, logical.y);
      this.options.camera.zoomAt(factor, world.x, world.y);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(event.pointerId);

    if (wasSingle && !this.dragged) {
      const logical = this.localPoint(event);
      this.options.onTap?.(logical.x, logical.y);
    }
    if (this.pointers.size < 2) this.lastPinchSpan = 0;
    if (this.pointers.size === 0) this.pressOrigin = undefined;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const logical = this.localPoint(event);
    const world = this.options.camera.screenToWorld(logical.x, logical.y);
    this.options.camera.zoomAt(wheelZoomFactor(event.deltaY), world.x, world.y);
  };

  private currentSpan(): number {
    const [a, b] = [...this.pointers.values()];
    return a === undefined || b === undefined ? 0 : pointerDistance(a, b);
  }
}
