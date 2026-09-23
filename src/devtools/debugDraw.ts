import { Graphics } from 'pixi.js';
import { TILE_SIZE } from '@core/constants';
import { EnemyFlag } from '@sim/index';
import type { World } from '@sim/index';
import type { Layers } from '@view/layers';

/**
 * The visualisation toggles (#41): what the simulation thinks is there.
 *
 * Every one of these draws a number the simulation already holds, at the
 * position the simulation holds it at — never a re-derivation. That is the
 * point: the bugs this catches are the ones where the board and the world
 * disagree, and a debug layer that computed its own answer could agree with
 * neither.
 *
 * Drawn into `labels`, the topmost layer, because a debug ring hidden behind a
 * particle burst is a debug ring that was not drawn. One `Graphics` for all
 * five toggles, cleared and rebuilt each frame: at these counts the rebuild is
 * cheaper than tracking what changed, and it cannot go stale.
 */

export interface DebugToggles {
  hitboxes: boolean;
  ranges: boolean;
  paths: boolean;
  grid: boolean;
  targeting: boolean;
}

export const NO_TOGGLES: DebugToggles = {
  hitboxes: false,
  ranges: false,
  paths: false,
  grid: false,
  targeting: false,
};

export function anyToggle(toggles: DebugToggles): boolean {
  return toggles.hitboxes || toggles.ranges || toggles.paths || toggles.grid || toggles.targeting;
}

const GRID = 0x2b3a4a;
const PATH = 0x53f5c0;
const RANGE = 0xffd166;
const HITBOX = 0xff6b9d;
const TARGET = 0xff3355;

/** What the tap tests in the stage screen use, so a ring means "tappable". */
const ENEMY_RADIUS = TILE_SIZE * 0.5;

export class DebugView {
  private readonly g = new Graphics();

  constructor(layers: Layers) {
    /* Never intercepts a tap: the board underneath still has to be playable
       with the overlay open. */
    this.g.eventMode = 'none';
    layers.labels.addChild(this.g);
  }

  render(world: World, toggles: DebugToggles): void {
    const g = this.g;
    g.clear();
    if (!anyToggle(toggles)) return;

    if (toggles.grid) this.drawGrid(world);
    if (toggles.paths) this.drawPaths(world);
    if (toggles.ranges) this.drawRanges(world);
    if (toggles.targeting) this.drawTargeting(world);
    if (toggles.hitboxes) this.drawHitboxes(world);
  }

  destroy(): void {
    this.g.removeFromParent();
    this.g.destroy();
  }

  /**
   * The spatial hash's own cells, with the occupied ones filled.
   *
   * Cell size should sit near the median query radius, and this is the only
   * way to see that it does: a grid far finer than the ranges drawn over it
   * means every query sweeps dozens of cells.
   */
  private drawGrid(world: World): void {
    const g = this.g;
    const cell = world.groundIndex.cellSize;
    const width = world.config.widthTiles * TILE_SIZE;
    const height = world.config.heightTiles * TILE_SIZE;

    for (let x = 0; x <= width; x += cell) {
      g.moveTo(x, 0).lineTo(x, height);
    }
    for (let y = 0; y <= height; y += cell) {
      g.moveTo(0, y).lineTo(width, y);
    }
    g.stroke({ width: 1, color: GRID, alpha: 0.6 });

    const enemies = world.enemies;
    for (let slot = 0; slot < enemies.watermark; slot++) {
      if (!enemies.isAlive(slot)) continue;
      const col = Math.floor((enemies.x[slot] as number) / cell);
      const row = Math.floor((enemies.y[slot] as number) / cell);
      g.rect(col * cell, row * cell, cell, cell);
    }
    g.fill({ color: GRID, alpha: 0.35 });
  }

  /** Every baked route, as the movement system samples it. */
  private drawPaths(world: World): void {
    const g = this.g;
    for (const path of world.rules.paths) {
      const points = path.points;
      if (points.length < 4) continue;
      g.moveTo(points[0] as number, points[1] as number);
      for (let i = 1; i < path.pointCount; i++) {
        g.lineTo(points[i * 2] as number, points[i * 2 + 1] as number);
      }
      g.stroke({ width: 2, color: PATH, alpha: 0.8 });

      for (let i = 0; i < path.pointCount; i++) {
        g.circle(points[i * 2] as number, points[i * 2 + 1] as number, 3);
      }
      g.fill({ color: PATH, alpha: 0.9 });
    }
  }

  /** Resolved range, not the authored one: a ley node and a talent both move it. */
  private drawRanges(world: World): void {
    const g = this.g;
    const towers = world.towers;
    for (let slot = 0; slot < towers.watermark; slot++) {
      if (!towers.isAlive(slot)) continue;
      const x = towers.x[slot] as number;
      const y = towers.y[slot] as number;
      g.circle(x, y, towers.range[slot] as number);
      const min = towers.minRange[slot] as number;
      if (min > 0) g.circle(x, y, min);
    }
    g.stroke({ width: 1, color: RANGE, alpha: 0.5 });
  }

  /** Who each tower has actually locked, which is rarely who you expect. */
  private drawTargeting(world: World): void {
    const g = this.g;
    const towers = world.towers;
    const enemies = world.enemies;
    for (let slot = 0; slot < towers.watermark; slot++) {
      if (!towers.isAlive(slot)) continue;
      const target = towers.target[slot] as number;
      if (target < 0 || !enemies.isAlive(target)) continue;
      g.moveTo(towers.x[slot] as number, towers.y[slot] as number).lineTo(
        enemies.x[target] as number,
        enemies.y[target] as number,
      );
    }
    g.stroke({ width: 1, color: TARGET, alpha: 0.7 });
  }

  /**
   * Enemies and soldiers at the radius the game tests against.
   *
   * A burrowed enemy is drawn dashed rather than skipped: it is still there,
   * still moving and still untargetable, and "where did it go" is exactly the
   * question the hitbox toggle is opened to answer.
   */
  private drawHitboxes(world: World): void {
    const g = this.g;
    const enemies = world.enemies;
    for (let slot = 0; slot < enemies.watermark; slot++) {
      if (!enemies.isAlive(slot)) continue;
      const burrowed = ((enemies.flags[slot] as number) & EnemyFlag.Burrowed) !== 0;
      g.circle(
        enemies.x[slot] as number,
        enemies.y[slot] as number,
        burrowed ? ENEMY_RADIUS * 0.5 : ENEMY_RADIUS,
      );
    }
    g.stroke({ width: 1, color: HITBOX, alpha: 0.8 });

    const soldiers = world.soldiers;
    for (let slot = 0; slot < soldiers.watermark; slot++) {
      if (!soldiers.isAlive(slot)) continue;
      g.circle(soldiers.x[slot] as number, soldiers.y[slot] as number, ENEMY_RADIUS * 0.6);
    }
    g.stroke({ width: 1, color: 0x8bd6ff, alpha: 0.8 });
  }
}
