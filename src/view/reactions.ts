import { Container, Graphics, Text } from 'pixi.js';
import { SimEventKind } from '@sim/index';
import type { World } from '@sim/index';
import type { Layers } from './layers.js';

/**
 * Making a reaction visible.
 *
 * The design's readability requirements are explicit and non-negotiable
 * (docs/GAME_DESIGN.md §4.5): every reaction needs a unique effect, a shape as
 * well as a colour so colourblind players can read it, and a named floating
 * label the first time it happens in a stage. The reaction gate (#62) asks
 * whether a player who has never seen the design can say what happened when
 * fire met ice — and nobody can answer that about an effect they cannot see.
 *
 * This is the readability slice that gate needs, not the full VFX pass (#43).
 * Schematic shapes drawn with the vector API, no particles and no textures; but
 * the burst is drawn at the reaction's *real* radius, read from the ruleset, so
 * what the player sees is the area that was actually affected rather than a
 * decoration that happens to be nearby.
 *
 * `ReactionFeed` holds all of the logic and knows nothing about a renderer, so
 * it is unit-testable; `ReactionsView` is the thin part that draws it.
 */

/** How a reaction's burst is drawn. Shape carries the identity, not just hue. */
export type ReactionShape = 'burst' | 'hex' | 'arc' | 'bloom' | 'rings';

export interface ReactionStyle {
  colour: number;
  shape: ReactionShape;
}

/**
 * One distinct look per reaction.
 *
 * Deliberately not the damage-type palette: every reaction deals Arcane, so
 * colouring them by damage type would make all five identical — which is the
 * exact failure mode risk T3 describes (docs/TECH_DESIGN.md §15).
 */
const STYLES: Readonly<Record<string, ReactionStyle>> = {
  thermal_shock: { colour: 0x9be7ff, shape: 'burst' },
  superconduct: { colour: 0x7f8cff, shape: 'hex' },
  electrolysis: { colour: 0xc08cff, shape: 'arc' },
  combustion: { colour: 0xff8a3d, shape: 'bloom' },
  amplify: { colour: 0xff5ce0, shape: 'rings' },
};

const FALLBACK: ReactionStyle = { colour: 0xffffff, shape: 'burst' };

/** A reaction with no authored style still draws, rather than vanishing. */
export function reactionStyle(id: string): ReactionStyle {
  return STYLES[id] ?? FALLBACK;
}

/** Radius drawn for a reaction that has none of its own, in world pixels. */
export const POINT_RADIUS = 28;

/**
 * How long a burst lives, in frames.
 *
 * Longer than it first was. The reaction gate (#62) found a tester who
 * triggered a Thermal Shock and did not notice it: he was watching his towers
 * and his gold, not one enemy among eight, and by the time anything drew his
 * eye the ring had gone. Half a second is the floor for something that has to
 * be caught in peripheral vision.
 */
const BURST_FRAMES = 40;
const LABEL_FRAMES = 100;
const NUMBER_FRAMES = 50;

/**
 * How many times each reaction announces itself by name per stage.
 *
 * It was once, which was a mistake: correct for a player who already knows the
 * mechanic, and useless for teaching one who does not. A player who happens to
 * be looking elsewhere on the first occurrence never gets another chance, which
 * is exactly what happened in the first gate session. Three gives a distracted
 * player somewhere to land without the fiftieth reaction shouting its own name.
 */
const NAME_REPEATS = 3;

/** The hard cap risk T3 calls for: a dense wave drops bursts, never stutters. */
const MAX_BURSTS = 64;
const MAX_LABELS = 8;
const MAX_NUMBERS = 32;

export interface Burst {
  x: number;
  y: number;
  radius: number;
  colour: number;
  shape: ReactionShape;
  /** Frames remaining. */
  life: number;
  maxLife: number;
}

export interface Label {
  x: number;
  y: number;
  text: string;
  colour: number;
  life: number;
  maxLife: number;
}

/**
 * A reaction's damage, floating where it happened.
 *
 * The most direct answer there is to "what just killed that?" — the question
 * §4.5 says the player must never have to visit a wiki to answer. A name tells
 * them something happened; a number tells them it mattered.
 */
export interface Number_ {
  x: number;
  y: number;
  amount: number;
  colour: number;
  life: number;
  maxLife: number;
}

/**
 * Turns reaction events into what should be on screen, and ages it.
 *
 * Pure: no renderer, no DOM, no clock of its own. Frames are counted rather
 * than measured, so a paused game simply stops calling `advance` and the burst
 * holds mid-expansion instead of finishing while nothing is moving.
 */
export class ReactionFeed {
  readonly bursts: Burst[] = [];
  readonly labels: Label[] = [];
  readonly numbers: Number_[] = [];

  private readonly spareBursts: Burst[] = [];
  /** Times each reaction row has named itself this stage. */
  private readonly named = new Map<number, number>();
  private dropped = 0;

  constructor() {
    for (let i = 0; i < MAX_BURSTS; i++) {
      this.spareBursts.push({
        x: 0,
        y: 0,
        radius: 0,
        colour: 0,
        shape: 'burst',
        life: 0,
        maxLife: 1,
      });
    }
  }

  /** Bursts refused because the cap was reached. Non-zero means a dense wave. */
  get droppedBursts(): number {
    return this.dropped;
  }

  /**
   * Drains this frame's events.
   *
   * One of several consumers, so it must not clear the buffer — the session
   * does that once everyone has read it.
   */
  consume(world: World, name: (reactionId: string) => string): void {
    const table = world.rules.reactions;

    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind !== SimEventKind.ReactionTriggered) continue;

      const row = event.a;
      const id = table.ids[row] ?? 'unknown';
      const style = reactionStyle(id);
      const radius = (table.radius[row] as number) || POINT_RADIUS;

      this.addBurst(event.b, event.c, radius, style);

      /* The first few of each reaction announce themselves; the fiftieth does
         not, or the name becomes wallpaper and stops being read at all. */
      const shown = this.named.get(row) ?? 0;
      if (shown < NAME_REPEATS) {
        this.named.set(row, shown + 1);
        this.addLabel(event.b, event.c, name(id), style.colour);
      }

      /* Magnitude rides in the event's last slot. A reaction that deals none —
         Superconduct strips armour instead — shows no number. */
      if (event.d > 0) this.addNumber(event.b, event.c, event.d, style.colour);
    }
  }

  private addBurst(x: number, y: number, radius: number, style: ReactionStyle): void {
    const burst = this.spareBursts.pop();
    /* Dropped rather than grown: a missing burst is invisible for a frame, a
       mid-wave allocation is a stutter the player feels. */
    if (burst === undefined) {
      this.dropped++;
      return;
    }

    burst.x = x;
    burst.y = y;
    burst.radius = radius;
    burst.colour = style.colour;
    burst.shape = style.shape;
    burst.life = BURST_FRAMES;
    burst.maxLife = BURST_FRAMES;
    this.bursts.push(burst);
  }

  private addLabel(x: number, y: number, text: string, colour: number): void {
    if (this.labels.length >= MAX_LABELS) return;
    this.labels.push({ x, y, text, colour, life: LABEL_FRAMES, maxLife: LABEL_FRAMES });
  }

  private addNumber(x: number, y: number, amount: number, colour: number): void {
    if (this.numbers.length >= MAX_NUMBERS) return;
    this.numbers.push({ x, y, amount, colour, life: NUMBER_FRAMES, maxLife: NUMBER_FRAMES });
  }

  /** Ages everything by a frame and retires what has finished. */
  advance(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i] as Burst;
      burst.life -= 1;
      if (burst.life > 0) continue;
      this.bursts.splice(i, 1);
      this.spareBursts.push(burst);
    }

    for (let i = this.labels.length - 1; i >= 0; i--) {
      const label = this.labels[i] as Label;
      label.life -= 1;
      if (label.life <= 0) this.labels.splice(i, 1);
    }

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const number = this.numbers[i] as Number_;
      number.life -= 1;
      if (number.life <= 0) this.numbers.splice(i, 1);
    }
  }

  /** 0 at the moment it fires, 1 as it finishes. */
  static progress(effect: { life: number; maxLife: number }): number {
    return 1 - effect.life / effect.maxLife;
  }

  /**
   * Back to a stage's opening state.
   *
   * The named set is cleared too: a restarted stage should announce its first
   * Thermal Shock again, because for the player it is the first one.
   */
  reset(): void {
    for (const burst of this.bursts) this.spareBursts.push(burst);
    this.bursts.length = 0;
    this.labels.length = 0;
    this.numbers.length = 0;
    this.named.clear();
    this.dropped = 0;
  }
}

/** Points of a regular polygon, written into a caller-supplied buffer. */
export function polygonPoints(
  x: number,
  y: number,
  radius: number,
  sides: number,
  rotation: number,
  out: number[],
): void {
  out.length = 0;
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    out.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
}

/** Spokes of a starburst, as pairs of inner and outer points. */
export const BURST_SPOKES = 8;
/** Segments an arc is drawn from. */
export const ARC_SEGMENTS = 6;

/**
 * Draws the feed. The only part that touches a renderer.
 */
export class ReactionsView {
  private readonly graphics = new Graphics();
  private readonly labelHost = new Container();
  private readonly labelPool: Text[] = [];
  private readonly numberPool: Text[] = [];
  private readonly feed = new ReactionFeed();
  private readonly scratch: number[] = [];

  constructor(layers: Layers) {
    layers.particles.addChild(this.graphics);
    layers.labels.addChild(this.labelHost);
  }

  consume(world: World, name: (reactionId: string) => string): void {
    this.feed.consume(world, name);
  }

  render(): void {
    this.feed.advance();
    this.drawBursts();
    this.drawLabels();
    this.drawNumbers();
  }

  private drawBursts(): void {
    const g = this.graphics;
    g.clear();

    for (const burst of this.feed.bursts) {
      const t = ReactionFeed.progress(burst);
      /* Holds full strength for the first third and only then fades, rather
         than dimming from the first frame. A burst that starts disappearing
         immediately is one a player glancing across the board never catches —
         which is how the first gate session was lost. */
      const alpha = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      /* Expands to the reaction's true radius, so the ring the player watches
         is the area that was actually caught in it. */
      const radius = burst.radius * (0.25 + 0.75 * t);

      /* A white core for the first few frames. Colour tells the player *which*
         reaction; the flash is what tells them one happened at all. */
      if (t < 0.25) {
        const flash = 1 - t / 0.25;
        g.circle(burst.x, burst.y, radius * 0.5).fill({
          color: 0xffffff,
          alpha: flash * 0.55,
        });
      }

      /* Filled wash under every shape, so the area reads as an area rather
         than as an outline the eye can slide past. */
      g.circle(burst.x, burst.y, radius).fill({ color: burst.colour, alpha: alpha * 0.14 });

      switch (burst.shape) {
        case 'hex':
          polygonPoints(burst.x, burst.y, radius, 6, t * 0.5, this.scratch);
          g.poly(this.scratch).stroke({ width: 4, color: burst.colour, alpha });
          break;

        case 'arc':
          this.drawJaggedRing(burst.x, burst.y, radius, burst.colour, alpha);
          break;

        case 'bloom':
          g.circle(burst.x, burst.y, radius).stroke({ width: 5, color: burst.colour, alpha });
          break;

        case 'rings':
          g.circle(burst.x, burst.y, radius).stroke({ width: 3, color: burst.colour, alpha });
          g.circle(burst.x, burst.y, radius * 0.6).stroke({
            width: 3,
            color: burst.colour,
            alpha,
          });
          break;

        default:
          g.circle(burst.x, burst.y, radius).stroke({ width: 4, color: burst.colour, alpha });
          this.drawSpokes(burst.x, burst.y, radius, burst.colour, alpha);
      }
    }
  }

  private drawSpokes(x: number, y: number, radius: number, colour: number, alpha: number): void {
    const g = this.graphics;
    for (let i = 0; i < BURST_SPOKES; i++) {
      const angle = (i / BURST_SPOKES) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      g.moveTo(x + cos * radius * 0.6, y + sin * radius * 0.6);
      g.lineTo(x + cos * radius * 1.15, y + sin * radius * 1.15);
    }
    g.stroke({ width: 3, color: colour, alpha });
  }

  private drawJaggedRing(
    x: number,
    y: number,
    radius: number,
    colour: number,
    alpha: number,
  ): void {
    const g = this.graphics;
    for (let i = 0; i < ARC_SEGMENTS; i++) {
      const from = (i / ARC_SEGMENTS) * Math.PI * 2;
      const to = ((i + 0.5) / ARC_SEGMENTS) * Math.PI * 2;
      /* Alternating radii, so the arc reads as electricity rather than a ring. */
      const near = radius * 0.7;
      g.moveTo(x + Math.cos(from) * radius, y + Math.sin(from) * radius);
      g.lineTo(x + Math.cos(to) * near, y + Math.sin(to) * near);
    }
    g.stroke({ width: 3, color: colour, alpha });
  }

  private drawLabels(): void {
    const labels = this.feed.labels;

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i] as Label;
      const view = this.labelAt(i);
      const t = ReactionFeed.progress(label);

      view.text = label.text;
      view.style.fill = label.colour;
      view.x = label.x;
      /* Drifts upward off the enemy it happened to, and fades late so the name
         is readable for most of its life rather than only at the start. */
      view.y = label.y - 24 - t * 28;
      view.alpha = t < 0.7 ? 1 : (1 - t) / 0.3;
      view.visible = true;
    }

    for (let i = labels.length; i < this.labelPool.length; i++) {
      (this.labelPool[i] as Text).visible = false;
    }
  }

  private labelAt(index: number): Text {
    const existing = this.labelPool[index];
    if (existing !== undefined) return existing;

    /* A handful per stage, created once and then reused for the life of the
       view. */
    const text = new Text({
      text: '',
      style: { fontFamily: 'sans-serif', fontSize: 20, fontWeight: 'bold', fill: 0xffffff },
    });
    text.anchor.set(0.5, 1);
    this.labelPool.push(text);
    this.labelHost.addChild(text);
    return text;
  }

  /**
   * The damage a reaction did, where it did it.
   *
   * The most direct answer to "what just killed that?", which §4.5 says a
   * player must be able to reach without a wiki. The name says a reaction
   * happened; the number says it was worth caring about.
   */
  private drawNumbers(): void {
    const numbers = this.feed.numbers;

    for (let i = 0; i < numbers.length; i++) {
      const number = numbers[i] as Number_;
      const view = this.numberAt(i);
      const t = ReactionFeed.progress(number);

      view.text = String(Math.round(number.amount));
      view.style.fill = number.colour;
      view.x = number.x;
      view.y = number.y - 8 - t * 34;
      view.alpha = t < 0.6 ? 1 : (1 - t) / 0.4;
      view.visible = true;
    }

    for (let i = numbers.length; i < this.numberPool.length; i++) {
      (this.numberPool[i] as Text).visible = false;
    }
  }

  private numberAt(index: number): Text {
    const existing = this.numberPool[index];
    if (existing !== undefined) return existing;

    const text = new Text({
      text: '',
      style: {
        fontFamily: 'sans-serif',
        fontSize: 22,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 4 },
      },
    });
    text.anchor.set(0.5, 1);
    this.numberPool.push(text);
    this.labelHost.addChild(text);
    return text;
  }

  reset(): void {
    this.feed.reset();
    this.graphics.clear();
    for (const text of this.labelPool) text.visible = false;
    for (const text of this.numberPool) text.visible = false;
  }

  get activeCount(): number {
    return this.feed.bursts.length;
  }

  destroy(): void {
    this.graphics.destroy();
    for (const text of this.labelPool) text.destroy();
    for (const text of this.numberPool) text.destroy();
    this.labelPool.length = 0;
    this.numberPool.length = 0;
    this.labelHost.destroy();
  }
}
