import type { Container } from 'pixi.js';
import { Graphics } from 'pixi.js';
import { DAMAGE_BY_INDEX, SimEventKind } from '@sim/index';
import type { World } from '@sim/index';
import type { Layers } from './layers.js';

/**
 * Transient visuals driven by the event stream.
 *
 * These are the things events are genuinely the right source for: a death has
 * no entity left to read, and by the time the view runs the slot has been
 * recycled. Persistent sprites are driven from the pools instead (entities.ts).
 *
 * Deliberately schematic. The real death variants — burning to ash, shattering,
 * an X-ray flash — are #43; what matters here is that a kill reads as a kill
 * and that the effect is coloured by what did it, so the player can tell which
 * tower is working.
 */

/** Colour per damage type, matching the reserved gameplay palette. */
const DAMAGE_COLOUR: Readonly<Record<string, number>> = {
  kinetic: 0x9aa4b2,
  pyro: 0xff7a33,
  cryo: 0x7fd4ff,
  volt: 0xc08cff,
  toxic: 0x7fd45a,
  arcane: 0xff5ce0,
  true: 0xe6e9f2,
};

interface Puff {
  x: number;
  y: number;
  colour: number;
  /** Ticks remaining, counted down per frame. */
  life: number;
  maxLife: number;
}

const DEATH_LIFE_FRAMES = 18;
const MAX_PUFFS = 256;

export class EffectsView {
  private readonly graphics = new Graphics();
  private readonly puffs: Puff[] = [];
  /** Preallocated, so a wave clearing at once allocates nothing. */
  private readonly spare: Puff[] = [];

  constructor(layers: Layers) {
    const host: Container = layers.particles;
    host.addChild(this.graphics);
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.spare.push({ x: 0, y: 0, colour: 0, life: 0, maxLife: 1 });
    }
  }

  /**
   * Drains this frame's events.
   *
   * The view is one of several consumers, so it must not clear the buffer —
   * the session does that once everyone has read it.
   */
  consume(world: World): void {
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind !== SimEventKind.EnemyDied) continue;

      const puff = this.spare.pop();
      /* Dropped rather than grown: a missing puff is invisible, a stutter is
         not. */
      if (puff === undefined) continue;

      puff.x = event.b;
      puff.y = event.c;
      puff.colour = DAMAGE_COLOUR[DAMAGE_BY_INDEX[event.d] ?? 'kinetic'] ?? 0xffffff;
      puff.life = DEATH_LIFE_FRAMES;
      puff.maxLife = DEATH_LIFE_FRAMES;
      this.puffs.push(puff);
    }
  }

  render(): void {
    const g = this.graphics;
    g.clear();

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i] as Puff;
      puff.life -= 1;

      if (puff.life <= 0) {
        this.puffs.splice(i, 1);
        this.spare.push(puff);
        continue;
      }

      /* Expands and fades, so a kill reads even in a crowd. */
      const t = 1 - puff.life / puff.maxLife;
      g.circle(puff.x, puff.y, 6 + t * 14).stroke({
        width: 2,
        color: puff.colour,
        alpha: 1 - t,
      });
    }
  }

  /** Drops every effect in flight. A restart must not inherit the last run's deaths. */
  reset(): void {
    for (const puff of this.puffs) this.spare.push(puff);
    this.puffs.length = 0;
    this.graphics.clear();
  }

  get activeCount(): number {
    return this.puffs.length;
  }

  destroy(): void {
    this.graphics.destroy();
    this.puffs.length = 0;
  }
}
