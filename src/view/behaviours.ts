import { Container, Graphics } from 'pixi.js';
import { BehaviourFlag, SimEventKind } from '@sim/index';
import type { World } from '@sim/index';
import type { Layers } from './layers.js';
import { BEHAVIOUR_COLOUR } from './palette.js';

/**
 * Making an enemy behaviour visible (#29, design pillar P4).
 *
 * *"Every enemy that changes the rules gets a telegraph"* (§9.3). The sim
 * already gives the Sapper a wind-up before it disables anything; this is the
 * half that makes that wind-up mean something, because a window the player
 * cannot see is not a window.
 *
 * Two different jobs, and they are drawn differently on purpose:
 *
 * - **A moment** — a sap landing, a jump, a drop — is an event, so it is drawn
 *   from the event buffer and ages out.
 * - **A standing threat** — a Mender's reach, a Nullifier's suppression — is a
 *   *state*, so it is drawn from the world every frame. An aura ring that aged
 *   out would tell the player the danger had passed while it had not, which is
 *   worse than drawing nothing.
 *
 * `BehaviourFeed` holds the logic and knows nothing about a renderer, so it is
 * unit-tested; `BehavioursView` is the thin part that touches Pixi — the same
 * split the reaction view uses, and for the same reason.
 */

/** Frames a one-off telegraph lives for. Long enough to catch peripherally. */
const PULSE_FRAMES = 36;

/** A dense wave drops telegraphs rather than stuttering — the same cap risk T3 names. */
const MAX_PULSES = 48;

export interface Pulse {
  x: number;
  y: number;
  radius: number;
  colour: number;
  /** Frames remaining, counted rather than measured so a pause holds it still. */
  life: number;
  maxLife: number;
}

/** A standing aura, read from the world rather than remembered. */
export interface AuraRing {
  x: number;
  y: number;
  radius: number;
  colour: number;
}

/**
 * Which telegraph a behaviour draws.
 *
 * Keyed off the `BehaviourFlag` the sim reports, so adding a behaviour is a
 * colour here rather than a new event kind and a new branch in the renderer.
 */
export function behaviourColour(behaviour: number): number | null {
  if ((behaviour & BehaviourFlag.Healer) !== 0) return BEHAVIOUR_COLOUR.heal ?? null;
  if ((behaviour & BehaviourFlag.Shielder) !== 0) return BEHAVIOUR_COLOUR.shield ?? null;
  if ((behaviour & BehaviourFlag.TowerSlowAura) !== 0) return BEHAVIOUR_COLOUR.suppress ?? null;
  if ((behaviour & BehaviourFlag.AllyHasteAura) !== 0) return BEHAVIOUR_COLOUR.haste ?? null;
  if ((behaviour & BehaviourFlag.Sapper) !== 0) return BEHAVIOUR_COLOUR.sap ?? null;
  if ((behaviour & BehaviourFlag.Devours) !== 0) return BEHAVIOUR_COLOUR.devour ?? null;
  if ((behaviour & BehaviourFlag.SpitsGround) !== 0) return BEHAVIOUR_COLOUR.spit ?? null;
  if ((behaviour & BehaviourFlag.Phase) !== 0) return BEHAVIOUR_COLOUR.phase ?? null;
  if ((behaviour & (BehaviourFlag.Carrier | BehaviourFlag.StationarySpawner)) !== 0) {
    return BEHAVIOUR_COLOUR.spawn ?? null;
  }
  return null;
}

/** Radius a one-off telegraph draws at, in world pixels. */
const PULSE_RADIUS = 26;
/**
 * A boss telegraph draws bigger (#33).
 *
 * Nine hues at 40 degrees is readable standing still and less so on a board
 * with three hundred enemies on it, and the two that cost the player the most
 * to miss — a soldier about to be eaten, a plot about to go dark — are the two
 * worth a second channel. Size rather than a new colour, because the hue
 * circle is what ran out.
 */
const BOSS_PULSE_RADIUS = 46;

const BOSS_TELEGRAPHS = BehaviourFlag.Devours | BehaviourFlag.SpitsGround;

export class BehaviourFeed {
  readonly pulses: Pulse[] = [];
  readonly rings: AuraRing[] = [];

  /** Telegraphs refused because the cap was reached. Non-zero means under-sized. */
  dropped = 0;

  /** Turns this tick's behaviour events into pulses. */
  consume(world: World): void {
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind !== SimEventKind.BehaviourFired) continue;

      const colour = behaviourColour(event.b);
      if (colour === null) continue;
      this.add(event.c, event.d, colour, (event.b & BOSS_TELEGRAPHS) !== 0);
    }
  }

  /**
   * Where every live aura currently reaches.
   *
   * Rebuilt from the world each frame rather than kept: an aura whose source
   * has died must stop being drawn on the same frame it stops applying, and
   * the sim already recomputes it from nothing for exactly that reason.
   */
  syncAuras(world: World): void {
    this.rings.length = 0;

    const enemies = world.enemies;
    const table = world.rules.enemies;

    for (let slot = 0; slot < enemies.watermark; slot++) {
      if (!enemies.isAlive(slot)) continue;

      const behaviour = table.behaviour[enemies.typeIdx[slot] as number] as number;
      if (behaviour === 0) continue;

      const radius = table.auraRadius[enemies.typeIdx[slot] as number] as number;
      if (radius <= 0) continue;

      const colour = behaviourColour(behaviour);
      if (colour === null) continue;

      this.rings.push({
        x: enemies.x[slot] as number,
        y: enemies.y[slot] as number,
        radius,
        colour,
      });
    }
  }

  private add(x: number, y: number, colour: number, boss = false): void {
    if (this.pulses.length >= MAX_PULSES) {
      this.dropped++;
      return;
    }
    this.pulses.push({
      x,
      y,
      radius: boss ? BOSS_PULSE_RADIUS : PULSE_RADIUS,
      colour,
      life: PULSE_FRAMES,
      maxLife: PULSE_FRAMES,
    });
  }

  /** Ages every pulse by a frame and retires the expired ones. */
  advance(): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pulse = this.pulses[i] as Pulse;
      pulse.life -= 1;
      if (pulse.life <= 0) this.pulses.splice(i, 1);
    }
  }

  clear(): void {
    this.pulses.length = 0;
    this.rings.length = 0;
    this.dropped = 0;
  }
}

/** The thin renderer. Everything it draws was decided by the feed. */
export class BehavioursView {
  private readonly graphics = new Graphics();
  private readonly root = new Container();
  readonly feed = new BehaviourFeed();

  constructor(layers: Layers) {
    this.root.addChild(this.graphics);
    layers.particles.addChild(this.root);
  }

  render(world: World): void {
    this.feed.consume(world);
    this.feed.syncAuras(world);
    this.feed.advance();

    const g = this.graphics;
    g.clear();

    /* Faint, and under the pulses: a standing aura is context, not an event,
       and four overlapping rings at full strength would read as the board
       being on fire. */
    for (const ring of this.feed.rings) {
      g.circle(ring.x, ring.y, ring.radius).stroke({
        width: 2,
        color: ring.colour,
        alpha: 0.25,
      });
    }

    for (const pulse of this.feed.pulses) {
      const t = pulse.life / pulse.maxLife;
      /* Expands as it fades, so it reads as something happening rather than
         something present. */
      g.circle(pulse.x, pulse.y, pulse.radius * (2 - t)).stroke({
        width: 3,
        color: pulse.colour,
        alpha: t * 0.9,
      });
    }
  }

  destroy(): void {
    this.graphics.destroy();
    this.root.destroy();
  }
}
