import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Spritesheet } from 'pixi.js';
import { STATUS_COLOUR } from './palette.js';
import { MAX_ENEMIES, MAX_TOWERS } from '@sim/index';
import { EnemyFlag, SoldierFlag, STATUS_BY_INDEX, STATUS_COUNT } from '@sim/index';
import type { World } from '@sim/index';
import type { Layers } from './layers.js';

/**
 * Keeps sprites in step with the simulation.
 *
 * Driven from the entity pools, not from the event stream. Events say *when*
 * something happened; the pool says *what exists now*, and reconstructing the
 * second from the first means a single dropped event leaks a sprite forever —
 * and the event buffer is explicitly allowed to drop under load. Scanning the
 * pools cannot desync, and at these counts it is cheaper than the bookkeeping
 * a reconciliation would need.
 *
 * Events still drive transient effects, which have no entity to read (see
 * effects.ts).
 *
 * Nothing here writes to the world. That is asserted directly: a test hashes
 * the world, renders, and hashes again.
 */

/** Interpolation state and the sprite for one live slot. */
interface Bound {
  sprite: Sprite;
  /** Entity id, so a recycled slot is detected rather than inherited. */
  id: number;
  prevX: number;
  prevY: number;
  x: number;
  y: number;
}

const HEALTH_BAR_WIDTH = 26;
const HEALTH_BAR_HEIGHT = 3;
const STATUS_DOT = 3;
/** How far the selection ring sits outside the sprite, so it never hides it. */
const SELECTION_GAP = 4;
/** Narrower than an enemy's, because a soldier is smaller and rarely alone. */
const SOLDIER_BAR_WIDTH = 20;

/* Status colours live in the shared palette, where they can be checked against
   the reaction colours they must not be confused with. */

export class EntityView {
  private readonly enemyLayer: Container;
  private readonly towerLayer: Container;
  private readonly overlay: Graphics;

  private readonly enemies = new Map<number, Bound>();
  private readonly towers = new Map<number, Bound>();
  private readonly soldiers = new Map<number, Bound>();
  /** Recycled sprites, so a wave of spawns allocates nothing. */
  private readonly spare: Sprite[] = [];

  private sheet: Spritesheet | null = null;
  private enemyFrames: string[] = [];
  private towerFrames: string[] = [];
  private soldierFrames: string[] = [];

  private readonly soldierLayer: Container;

  constructor(layers: Layers) {
    this.enemyLayer = new Container();
    this.towerLayer = new Container();
    this.soldierLayer = new Container();
    /* Only the entity layer pays for depth sorting, and only it needs it. */
    this.enemyLayer.sortableChildren = true;
    this.overlay = new Graphics();

    layers.entities.addChild(this.towerLayer);
    layers.entities.addChild(this.enemyLayer);
    layers.entities.addChild(this.soldierLayer);
    layers.bars.addChild(this.overlay);
  }

  /**
   * Resolves each content id to an atlas frame once, so the render loop indexes
   * an array instead of building a string per sprite per frame.
   */
  bindAtlas(sheet: Spritesheet, world: World): void {
    this.sheet = sheet;
    this.enemyFrames = world.rules.enemies.ids.map((id) =>
      sheet.textures[`enemy_${id}`] === undefined ? 'enemy_husk' : `enemy_${id}`,
    );
    this.towerFrames = world.rules.towers.ids.map((id) =>
      sheet.textures[`tower_${id}`] === undefined ? 'tower_arbalest_post' : `tower_${id}`,
    );
    /* One frame for every soldier: they are not typed the way enemies and
       towers are, so the index is ignored and the array is length one. */
    this.soldierFrames = ['soldier'];
  }

  /**
   * Snapshots positions as "previous" before the simulation advances.
   *
   * Called once per tick by the session. Without it there is nothing to
   * interpolate from, and a 60Hz simulation visibly steps on a 144Hz display.
   */
  captureForInterpolation(): void {
    for (const bound of this.enemies.values()) {
      bound.prevX = bound.x;
      bound.prevY = bound.y;
    }
    /* Soldiers walk too, and a soldier stepping at 60Hz on a 144Hz display is
       as visible as an enemy doing it. */
    for (const bound of this.soldiers.values()) {
      bound.prevX = bound.x;
      bound.prevY = bound.y;
    }
  }

  /** Reads current positions out of the world. Called after the ticks run. */
  sync(world: World): void {
    this.syncPool(world, world.enemies, this.enemies, this.enemyLayer, this.enemyFrames, true);
    this.syncPool(world, world.towers, this.towers, this.towerLayer, this.towerFrames, false);
    this.syncSoldiers(world);
  }

  /**
   * Soldiers, which are simpler than either pool above.
   *
   * One frame for all of them, and a respawning soldier is hidden rather than
   * released: its slot stays allocated while the timer runs, so releasing the
   * sprite would mean rebuilding it a few seconds later for the same body.
   */
  private syncSoldiers(world: World): void {
    const pool = world.soldiers;

    for (let slot = 0; slot < pool.watermark; slot++) {
      const existing = this.soldiers.get(slot);
      if (!pool.isAlive(slot)) {
        if (existing !== undefined) this.release(this.soldiers, this.soldierLayer, slot, existing);
        continue;
      }

      const id = pool.ids[slot] as number;
      const x = pool.x[slot] as number;
      const y = pool.y[slot] as number;

      if (existing === undefined || existing.id !== id) {
        if (existing !== undefined) this.release(this.soldiers, this.soldierLayer, slot, existing);
        const sprite = this.acquire(this.soldierFrames[0]);
        this.soldierLayer.addChild(sprite);
        this.soldiers.set(slot, { sprite, id, prevX: x, prevY: y, x, y });
        continue;
      }

      existing.x = x;
      existing.y = y;
      existing.sprite.visible = ((pool.flags[slot] as number) & SoldierFlag.Respawning) === 0;
    }

    for (const [slot, entry] of this.soldiers) {
      if (slot >= pool.watermark) this.release(this.soldiers, this.soldierLayer, slot, entry);
    }
  }

  private syncPool(
    world: World,
    pool: { watermark: number; isAlive: (slot: number) => boolean; ids: Int32Array },
    bound: Map<number, Bound>,
    layer: Container,
    frames: readonly string[],
    isEnemy: boolean,
  ): void {
    const positions = isEnemy ? world.enemies : world.towers;
    const types = isEnemy ? world.enemies.typeIdx : world.towers.typeIdx;

    for (let slot = 0; slot < pool.watermark; slot++) {
      const alive = pool.isAlive(slot);
      const existing = bound.get(slot);

      if (!alive) {
        if (existing !== undefined) this.release(bound, layer, slot, existing);
        continue;
      }

      const id = pool.ids[slot] as number;
      const x = positions.x[slot] as number;
      const y = positions.y[slot] as number;

      /* A slot whose id changed was recycled into a different entity, so its
         sprite and interpolation history must not carry over. */
      if (existing === undefined || existing.id !== id) {
        if (existing !== undefined) this.release(bound, layer, slot, existing);
        const sprite = this.acquire(frames[types[slot] as number]);
        layer.addChild(sprite);
        bound.set(slot, { sprite, id, prevX: x, prevY: y, x, y });
        continue;
      }

      existing.x = x;
      existing.y = y;

      if (isEnemy) {
        /* Burrowed enemies are underground: not drawn, and not targetable. */
        existing.sprite.visible =
          ((world.enemies.flags[slot] as number) & EnemyFlag.Burrowed) === 0;
      }
    }

    /* Slots beyond the watermark cannot hold anything. */
    for (const [slot, entry] of bound) {
      if (slot >= pool.watermark) this.release(bound, layer, slot, entry);
    }
  }

  /**
   * Places sprites for this frame.
   *
   * `alpha` is the fraction of a tick elapsed since the last one. Interpolating
   * is what makes a fixed 60Hz simulation look continuous on a 144Hz display —
   * and what keeps it smooth on a phone when one frame runs long.
   *
   * `selectedEnemy` is a slot to ring, or -1. The caller checks it still
   * holds the enemy the player chose; the view only draws it.
   */
  render(world: World, alpha: number, selectedEnemy = -1): void {
    for (const bound of this.enemies.values()) {
      const x = bound.prevX + (bound.x - bound.prevX) * alpha;
      const y = bound.prevY + (bound.y - bound.prevY) * alpha;
      bound.sprite.position.set(x, y);
      /* Depth by screen row, so something lower on the map draws in front. */
      bound.sprite.zIndex = y;
    }

    for (const bound of this.towers.values()) {
      bound.sprite.position.set(bound.x, bound.y);
    }

    for (const bound of this.soldiers.values()) {
      const x = bound.prevX + (bound.x - bound.prevX) * alpha;
      const y = bound.prevY + (bound.y - bound.prevY) * alpha;
      bound.sprite.position.set(x, y);
      bound.sprite.zIndex = y;
    }

    this.drawSoldierHealth(world, alpha);
    this.drawOverlay(world, alpha);
    this.drawSelection(selectedEnemy, alpha);
  }

  /** A ring round the enemy being inspected, so the panel is tied to a body. */
  private drawSelection(slot: number, alpha: number): void {
    const bound = slot < 0 ? undefined : this.enemies.get(slot);
    if (bound === undefined || !bound.sprite.visible) return;

    const x = bound.prevX + (bound.x - bound.prevX) * alpha;
    const y = bound.prevY + (bound.y - bound.prevY) * alpha;
    const radius = Math.max(bound.sprite.width, bound.sprite.height) / 2 + SELECTION_GAP;
    this.overlay.circle(x, y, radius).stroke({ width: 2, color: 0xe6e9f2, alpha: 0.9 });
  }

  /**
   * A soldier's health, above it, and only while it is hurt.
   *
   * The same conditional rule the enemy bars use, for the same reason: a full
   * garrison standing at a rally point should be three shapes, not three
   * shapes and three meters. But a soldier losing a fight is the single most
   * important thing on the board at that moment, because it is about to stop
   * holding whatever it is holding.
   */
  private drawSoldierHealth(world: World, alpha: number): void {
    const g = this.overlay;
    const pool = world.soldiers;

    for (const [slot, bound] of this.soldiers) {
      if (!bound.sprite.visible) continue;
      const max = pool.maxHp[slot] as number;
      if (max <= 0) continue;

      const health = (pool.hp[slot] as number) / max;
      if (health >= 1) continue;

      const x = bound.prevX + (bound.x - bound.prevX) * alpha;
      const y = bound.prevY + (bound.y - bound.prevY) * alpha;
      const top = y - 16;
      const width = SOLDIER_BAR_WIDTH;

      g.rect(x - width / 2, top, width, HEALTH_BAR_HEIGHT).fill({
        color: 0x000000,
        alpha: 0.5,
      });
      g.rect(x - width / 2, top, width * Math.max(0, health), HEALTH_BAR_HEIGHT).fill({
        /* Blue rather than the enemies' green, so a glance separates whose
           health is draining from whose. */
        color: health > 0.4 ? 0x5ce1e6 : 0xd1495b,
      });
    }
  }

  /**
   * Health bars and status pips.
   *
   * Drawn only for enemies that are actually damaged or statused: a full-health
   * enemy with nothing on it draws nothing at all, which keeps a busy board
   * legible and costs nothing for the common case.
   */
  private drawOverlay(world: World, alpha: number): void {
    const g = this.overlay;
    g.clear();
    const enemies = world.enemies;

    for (const [slot, bound] of this.enemies) {
      if (!bound.sprite.visible) continue;

      const max = enemies.maxHp[slot] as number;
      const health = max > 0 ? (enemies.hp[slot] as number) / max : 1;
      const statuses = this.statusesOn(world, slot);
      if (health >= 1 && statuses.length === 0) continue;

      const x = bound.prevX + (bound.x - bound.prevX) * alpha;
      const y = bound.prevY + (bound.y - bound.prevY) * alpha;
      const top = y - 20;

      if (health < 1) {
        g.rect(x - HEALTH_BAR_WIDTH / 2, top, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT).fill({
          color: 0x000000,
          alpha: 0.5,
        });
        g.rect(
          x - HEALTH_BAR_WIDTH / 2,
          top,
          HEALTH_BAR_WIDTH * Math.max(0, health),
          HEALTH_BAR_HEIGHT,
        ).fill({ color: health > 0.4 ? 0x7fd45a : 0xd1495b });
      }

      /* A row of pips above the bar, one per status, coloured by the damage
         type that applies it. Shape and colour both, for colourblind readers. */
      statuses.forEach((status, index) => {
        const px =
          x - ((statuses.length - 1) * (STATUS_DOT * 2 + 2)) / 2 + index * (STATUS_DOT * 2 + 2);
        g.circle(px, top - 6, STATUS_DOT).fill({ color: STATUS_COLOUR[status] ?? 0xffffff });
      });
    }
  }

  private statusesOn(world: World, slot: number): string[] {
    const out: string[] = [];
    for (let status = 0; status < STATUS_COUNT; status++) {
      if (world.enemies.stacksOf(slot, status) > 0) out.push(STATUS_BY_INDEX[status] as string);
    }
    return out;
  }

  private acquire(frame: string | undefined): Sprite {
    const texture =
      this.sheet !== null && frame !== undefined
        ? (this.sheet.textures[frame] ?? Texture.EMPTY)
        : Texture.EMPTY;

    const sprite = this.spare.pop() ?? new Sprite();
    sprite.texture = texture;
    sprite.anchor.set(0.5);
    sprite.visible = true;
    sprite.alpha = 1;
    return sprite;
  }

  private release(bound: Map<number, Bound>, layer: Container, slot: number, entry: Bound): void {
    layer.removeChild(entry.sprite);
    entry.sprite.visible = false;
    /* Recycled rather than destroyed, so a wave of spawns allocates nothing. */
    this.spare.push(entry.sprite);
    bound.delete(slot);
  }

  /** Sprites currently on screen. Used by the leak test. */
  get spriteCount(): number {
    return this.enemies.size + this.towers.size;
  }

  get pooledCount(): number {
    return this.spare.length;
  }

  destroy(): void {
    for (const [slot, entry] of this.enemies)
      this.release(this.enemies, this.enemyLayer, slot, entry);
    for (const [slot, entry] of this.towers)
      this.release(this.towers, this.towerLayer, slot, entry);
    for (const sprite of this.spare) sprite.destroy();
    this.spare.length = 0;
    this.overlay.destroy();
    this.enemyLayer.destroy();
    this.towerLayer.destroy();
  }
}

/** Capacities the view sizes itself against, re-exported for tests. */
export const VIEW_LIMITS = { MAX_ENEMIES, MAX_TOWERS };
