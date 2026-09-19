import { Graphics } from 'pixi.js';
import { TILE_SIZE } from '@core/constants';
import { plotInfo, rangeOf } from '@sim/index';
import type { PlotInfo, World } from '@sim/index';
import type { Layers } from './layers.js';

/**
 * Draws the board.
 *
 * Plots and the range ring. Entities are sprites, drawn by EntityView.
 *
 * Redrawn from world state each frame rather than diffed: a plot's occupancy
 * and a range ring both change rarely but unpredictably, and at these counts
 * redrawing is cheaper than the bookkeeping a diff would need — and cannot
 * drift out of sync with the simulation.
 */
export class BoardView {
  private readonly plots = new Graphics();
  private readonly range = new Graphics();
  private plotCache: PlotInfo[] = [];

  constructor(layers: Layers) {
    layers.plots.addChild(this.plots);
    layers.plots.addChild(this.range);
  }

  /** Plot geometry is fixed for the stage, so it is laid out once. */
  syncPlots(world: World): void {
    this.plotCache = plotInfo(world);
    this.drawPlots(-1);
  }

  get plotPositions(): readonly PlotInfo[] {
    return this.plotCache;
  }

  render(world: World, selectedPlot: number, previewRadius: number, selectedTower: number): void {
    this.plotCache = plotInfo(world);
    this.drawPlots(selectedPlot);
    this.drawRange(world, selectedPlot, previewRadius, selectedTower);
  }

  private drawPlots(selected: number): void {
    const g = this.plots;
    g.clear();

    for (const plot of this.plotCache) {
      if (plot.occupiedBy >= 0) continue;
      /* Ley nodes are marked before the player commits, because which tower
         goes on one is the decision the mechanic exists to create. */
      const colour = plot.leyNode === null ? 0xf2c14e : 0x5ce1e6;
      const size = TILE_SIZE * 0.34;

      g.moveTo(plot.x, plot.y - size)
        .lineTo(plot.x + size, plot.y)
        .lineTo(plot.x, plot.y + size)
        .lineTo(plot.x - size, plot.y)
        .closePath()
        .stroke({ width: plot.id === selected ? 4 : 2, color: colour, alpha: 0.9 });
    }
  }

  /**
   * The ring is read from the tower's resolved stats, so what the player sees
   * is exactly the distance the targeting code uses. A preview that disagreed
   * with the simulation would be worse than showing nothing.
   */
  private drawRange(
    world: World,
    selectedPlot: number,
    previewRadius: number,
    selectedTower: number,
  ): void {
    const g = this.range;
    g.clear();

    if (selectedTower >= 0) {
      const ring = rangeOf(world, selectedTower);
      if (ring !== null) {
        g.circle(ring.x, ring.y, ring.radius).stroke({ width: 2, color: 0x8bd6ff, alpha: 0.7 });
        if (ring.minRadius > 0) {
          /* The dead zone matters as much as the reach for a mortar. */
          g.circle(ring.x, ring.y, ring.minRadius).stroke({
            width: 2,
            color: 0xd1495b,
            alpha: 0.6,
          });
        }
      }
      return;
    }

    if (selectedPlot < 0 || previewRadius <= 0) return;
    const plot = this.plotCache.find((candidate) => candidate.id === selectedPlot);
    if (plot === undefined) return;

    g.circle(plot.x, plot.y, previewRadius).stroke({ width: 2, color: 0x8bd6ff, alpha: 0.5 });
  }

  destroy(): void {
    this.plots.destroy();
    this.range.destroy();
  }
}
