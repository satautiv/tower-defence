import { beforeEach, describe, expect, it } from 'vitest';
import { Camera } from '@view/camera';

const WORLD = 3000;
const VIEW = 1920;

describe('Camera', () => {
  let camera: Camera;

  beforeEach(() => {
    camera = new Camera();
    camera.setViewSize(VIEW, 1080);
    camera.setWorldSize(WORLD, 2000);
    camera.centreOnWorld();
  });

  it('centres on the world', () => {
    expect(camera.x).toBe(WORLD / 2);
    expect(camera.y).toBe(1000);
  });

  it('pans by a world delta', () => {
    camera.panBy(100, -50);
    expect(camera.x).toBe(WORLD / 2 + 100);
    expect(camera.y).toBe(950);
  });

  describe('clamping to the map', () => {
    it('will not show past the left or top edge', () => {
      camera.panBy(-99_999, -99_999);
      expect(camera.x).toBeCloseTo(camera.visibleWidth / 2, 6);
      expect(camera.y).toBeCloseTo(camera.visibleHeight / 2, 6);
    });

    it('will not show past the right or bottom edge', () => {
      camera.panBy(99_999, 99_999);
      expect(camera.x).toBeCloseTo(WORLD - camera.visibleWidth / 2, 6);
      expect(camera.y).toBeCloseTo(2000 - camera.visibleHeight / 2, 6);
    });

    /**
     * Zoomed out far enough that the map is smaller than the view, clamping
     * would pin it to one side and leave dead space on the other. Centring
     * reads as "you can see the whole map"; clamping reads as a bug.
     */
    it('centres rather than clamps when the world is smaller than the view', () => {
      camera.setWorldSize(500, 400);
      camera.panBy(9999, 9999);
      expect(camera.x).toBe(250);
      expect(camera.y).toBe(200);
    });

    it('re-clamps when the view grows but the world is still larger', () => {
      camera.panBy(99_999, 0);
      const atEdge = camera.x;
      /* 2400 stays under the 3000-wide world, so the edge clamp still applies;
         a wider view would cross over into the centring case below. */
      camera.setViewSize(2400, 1080);
      expect(camera.x).toBeLessThan(atEdge);
      expect(camera.x).toBeCloseTo(WORLD - camera.visibleWidth / 2, 6);
    });

    it('switches from clamping to centring when the view overtakes the world', () => {
      camera.panBy(99_999, 0);
      expect(camera.x).toBeGreaterThan(WORLD / 2);
      camera.setViewSize(WORLD * 2, 1080);
      expect(camera.x).toBe(WORLD / 2);
    });
  });

  describe('zoom', () => {
    it('respects its limits', () => {
      camera.setZoom(99);
      expect(camera.zoom).toBe(camera.maxZoom);
      camera.setZoom(0.001);
      expect(camera.zoom).toBe(camera.minZoom);
    });

    /**
     * The property that makes zooming feel right: whatever is under the cursor
     * stays under the cursor. Without it the map slides away as you zoom, which
     * is the single most common way camera code feels wrong.
     */
    it('keeps the focus point stationary on screen', () => {
      const focus = { x: 900, y: 700 };
      const before = camera.worldToScreen(focus.x, focus.y);
      camera.zoomAt(1.5, focus.x, focus.y);
      const after = camera.worldToScreen(focus.x, focus.y);

      expect(after.x).toBeCloseTo(before.x, 4);
      expect(after.y).toBeCloseTo(before.y, 4);
    });

    it('keeps the focus point stationary when zooming out too', () => {
      const focus = { x: 1200, y: 900 };
      const before = camera.worldToScreen(focus.x, focus.y);
      camera.zoomAt(0.7, focus.x, focus.y);
      const after = camera.worldToScreen(focus.x, focus.y);

      expect(after.x).toBeCloseTo(before.x, 4);
      expect(after.y).toBeCloseTo(before.y, 4);
    });

    it('does not move the camera when the zoom is already at its limit', () => {
      camera.setZoom(camera.maxZoom);
      const { x, y } = camera;
      camera.zoomAt(2, 100, 100);
      expect(camera.x).toBe(x);
      expect(camera.y).toBe(y);
    });

    it('shows less of the world as it zooms in', () => {
      const wide = camera.visibleWidth;
      camera.setZoom(2);
      expect(camera.visibleWidth).toBeCloseTo(wide / 2, 6);
    });
  });

  describe('coordinate conversion', () => {
    it('round-trips screen and world', () => {
      camera.setZoom(1.7);
      camera.panBy(120, -80);
      const world = camera.screenToWorld(400, 300);
      const screen = camera.worldToScreen(world.x, world.y);
      expect(screen.x).toBeCloseTo(400, 4);
      expect(screen.y).toBeCloseTo(300, 4);
    });

    it('maps the view centre to the camera position', () => {
      const world = camera.screenToWorld(VIEW / 2, 1080 / 2);
      expect(world.x).toBeCloseTo(camera.x, 6);
      expect(world.y).toBeCloseTo(camera.y, 6);
    });

    it('produces a container transform consistent with worldToScreen', () => {
      camera.setZoom(1.3);
      camera.panBy(50, 25);
      const t = camera.containerTransform();
      const screen = camera.worldToScreen(600, 400);
      expect(600 * t.scale + t.x).toBeCloseTo(screen.x, 4);
      expect(400 * t.scale + t.y).toBeCloseTo(screen.y, 4);
    });
  });

  it('survives a zero-sized world without producing NaN', () => {
    const fresh = new Camera();
    fresh.setViewSize(0, 0);
    fresh.setWorldSize(0, 0);
    expect(Number.isNaN(fresh.x)).toBe(false);
    expect(Number.isNaN(fresh.y)).toBe(false);
  });
});
