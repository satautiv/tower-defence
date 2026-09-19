import { Graphics } from 'pixi.js';
import { TILE_SIZE } from '@core/constants';
import { EnemyFlag, plotInfo, rangeOf } from '@sim/index';
import type { PlotInfo, World } from '@sim/index';
import type { Layers } from './layers.js';

/**
 * Draws the board.
 *
 * Deliberately schematic: plots, towers, enemies and the range preview as
 * shapes. Sprite-backed entities with interpolation and health bars are #18;
 * what this exists for is to make the board legible enough to build on, and to
 * put the range ring on screen.
 *
 * Everything is redrawn from world state each frame rather than diffed. At
 * these counts that is cheaper than the bookkeeping a diff would need, and it
 * cannot drift out of sync with the simulation.
 */
export class BoardView {
  private readonly plots = new Graphics();
  private readonly range = new Graphics();
  private readonly towers = new Graphics();
  private readonly enemies = new Graphics();

  private plotCache: PlotInfo[] = [];

  constructor(layers: Layers) {
    layers.plots.addChild(this.plots);
    layers.plots.addChild(this.range);
    layers.entities.addChild(this.towers);
    layers.entities.addChild(this.enemies);
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
    this.drawTowers(world);
    this.drawEnemies(world);
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

  private drawTowers(world: World): void {
    const g = this.towers;
    g.clear();

    for (let slot = 0; slot < world.towers.watermark; slot++) {
      if (!world.towers.isAlive(slot)) continue;
      const x = world.towers.x[slot] as number;
      const y = world.towers.y[slot] as number;
      const size = TILE_SIZE * 0.3;

      g.rect(x - size, y - size, size * 2, size * 2).fill({ color: 0x9aa4b2, alpha: 0.95 });
      /* Tier pips, so upgrade state is readable without opening a panel. */
      const tier = (world.towers.tier[slot] as number) + 1;
      for (let pip = 0; pip < tier; pip++) {
        g.circle(x - size + 5 + pip * 7, y + size - 5, 2.2).fill({ color: 0xf2c14e });
      }
    }
  }

  private drawEnemies(world: World): void {
    const g = this.enemies;
    g.clear();

    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (!world.enemies.isAlive(slot)) continue;
      const flags = world.enemies.flags[slot] as number;
      if ((flags & EnemyFlag.Burrowed) !== 0) continue;

      const x = world.enemies.x[slot] as number;
      const y = world.enemies.y[slot] as number;
      const flying = (flags & EnemyFlag.Flying) !== 0;
      const health =
        (world.enemies.hp[slot] as number) / Math.max(1, world.enemies.maxHp[slot] as number);

      g.circle(x, y, flying ? 9 : 11).fill({ color: flying ? 0xb892ff : 0xd1495b });
      if (health < 1) {
        g.rect(x - 12, y - 18, 24 * Math.max(0, health), 3).fill({ color: 0x7fd45a });
      }
    }
  }

  destroy(): void {
    this.plots.destroy();
    this.range.destroy();
    this.towers.destroy();
    this.enemies.destroy();
  }
}
