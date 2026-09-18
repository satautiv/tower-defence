import { clamp } from '@core/vec';

/**
 * Pan and zoom over the map.
 *
 * Position is the world point sitting at the centre of the view, which makes
 * clamping and zoom-to-cursor straightforward: both are expressed about the
 * same anchor. Storing a corner instead means every operation has to account
 * for the current zoom first.
 *
 * Pure state and arithmetic — no Pixi, no DOM. The Pixi container reads these
 * values each frame; input handlers call the mutators. That separation is what
 * makes the clamping rules testable without a renderer.
 */
export class Camera {
  /** World coordinates at the centre of the view. */
  x = 0;
  y = 0;
  zoom = 1;

  minZoom = 0.5;
  maxZoom = 3;

  private worldWidth = 0;
  private worldHeight = 0;
  private viewWidth = 0;
  private viewHeight = 0;

  /** World extent in logical pixels. */
  setWorldSize(width: number, height: number): void {
    this.worldWidth = Math.max(0, width);
    this.worldHeight = Math.max(0, height);
    this.clampToBounds();
  }

  /** Visible extent in logical pixels, before zoom. */
  setViewSize(width: number, height: number): void {
    this.viewWidth = Math.max(0, width);
    this.viewHeight = Math.max(0, height);
    this.clampToBounds();
  }

  /** How much world is on screen right now. */
  get visibleWidth(): number {
    return this.zoom === 0 ? 0 : this.viewWidth / this.zoom;
  }

  get visibleHeight(): number {
    return this.zoom === 0 ? 0 : this.viewHeight / this.zoom;
  }

  centreOnWorld(): void {
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
    this.clampToBounds();
  }

  /** Pans by a delta in world units. */
  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampToBounds();
  }

  /**
   * Zooms about a fixed world point, so the map does not slide out from under
   * the cursor or the pinch. Without this, zooming feels like the board is
   * being yanked away.
   */
  zoomAt(factor: number, focusWorldX: number, focusWorldY: number): void {
    const before = this.zoom;
    const after = clamp(before * factor, this.minZoom, this.maxZoom);
    if (after === before) return;

    /* Keep the focus point at the same screen offset from the centre: its
       distance from the camera scales by the inverse of the zoom change. */
    const ratio = before / after;
    this.x = focusWorldX + (this.x - focusWorldX) * ratio;
    this.y = focusWorldY + (this.y - focusWorldY) * ratio;
    this.zoom = after;
    this.clampToBounds();
  }

  setZoom(zoom: number): void {
    this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.clampToBounds();
  }

  /**
   * Keeps the view inside the map.
   *
   * When the world is narrower than the view — zoomed out past the map edges —
   * the camera centres on that axis instead of clamping. Clamping there would
   * pin the map to one side and leave dead space on the other, which reads as
   * a bug rather than as "you can see the whole map".
   */
  clampToBounds(): void {
    const halfW = this.visibleWidth / 2;
    const halfH = this.visibleHeight / 2;

    this.x =
      this.worldWidth <= this.visibleWidth
        ? this.worldWidth / 2
        : clamp(this.x, halfW, this.worldWidth - halfW);

    this.y =
      this.worldHeight <= this.visibleHeight
        ? this.worldHeight / 2
        : clamp(this.y, halfH, this.worldHeight - halfH);
  }

  /** Logical screen coordinates to world coordinates. */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + (screenX - this.viewWidth / 2) / this.zoom,
      y: this.y + (screenY - this.viewHeight / 2) / this.zoom,
    };
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom + this.viewWidth / 2,
      y: (worldY - this.y) * this.zoom + this.viewHeight / 2,
    };
  }

  /**
   * Transform for the world container: Pixi applies scale then position, so the
   * offset is in screen space already.
   */
  containerTransform(): { x: number; y: number; scale: number } {
    return {
      x: this.viewWidth / 2 - this.x * this.zoom,
      y: this.viewHeight / 2 - this.y * this.zoom,
      scale: this.zoom,
    };
  }
}
