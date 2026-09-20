import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  COLUMN_WIDTH,
  LABEL_ROW,
  ReactionFeed,
  POINT_RADIUS,
  clearOf,
  polygonPoints,
  reactionStyle,
} from '@view/reactions';
import type { World } from '@sim/index';
import {
  STATUS_INDEX,
  applyStatus,
  createWorldForStage,
  enemyIndex,
  reactionSystem,
  spawnEnemy,
  targetingSystem,
} from '@sim/index';

/**
 * Whether a reaction can be seen (docs/GAME_DESIGN.md §4.5).
 *
 * The reaction gate (#62) asks a player who has never read the design to say
 * what happened when fire met ice. Nobody can answer that about an effect that
 * is not drawn, so this is a gameplay requirement rather than decoration — and
 * the part of it that is logic rather than drawing is tested here.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const REACTION_IDS = ['thermal_shock', 'superconduct', 'electrolysis', 'combustion', 'amplify'];

const name = (id: string): string => `name:${id}`;

/** A world with one Thermal Shock about to happen at a known place. */
function detonate(world: World, x = 500, y = 500): void {
  const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
  world.enemies.hp[slot] = 10_000;
  world.enemies.maxHp[slot] = 10_000;
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = y;
  applyStatus(world, slot, STATUS_INDEX.scorch, 2);
  applyStatus(world, slot, STATUS_INDEX.chill, 1);

  targetingSystem(world);
  reactionSystem(world);
}

describe('every reaction looks different', () => {
  /**
   * Colour alone is not enough: §4.5 requires a distinct shape too, because a
   * colourblind player reads shape. And every reaction deals Arcane, so
   * colouring them by damage type would make all five identical — the exact
   * failure risk T3 describes.
   */
  it('gives each reaction its own colour', () => {
    const colours = new Set(REACTION_IDS.map((id) => reactionStyle(id).colour));
    expect(colours.size).toBe(REACTION_IDS.length);
  });

  it('gives each reaction its own shape', () => {
    const shapes = new Set(REACTION_IDS.map((id) => reactionStyle(id).shape));
    expect(shapes.size).toBe(REACTION_IDS.length);
  });

  it('has a style for every reaction the content defines', () => {
    for (const id of registry.reactions.keys()) {
      expect(REACTION_IDS).toContain(id);
    }
  });

  /* An unstyled reaction must still draw. Vanishing silently is the one
     outcome that cannot be noticed in play. */
  it('falls back to something visible for an unknown reaction', () => {
    const style = reactionStyle('not_a_reaction');
    expect(style.colour).toBeGreaterThan(0);
    expect(style.shape).toBeTruthy();
  });
});

describe('the feed turns reactions into bursts', () => {
  it('raises a burst where the reaction happened', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world, 640, 320);

    const feed = new ReactionFeed();
    feed.consume(world, name);

    expect(feed.bursts).toHaveLength(1);
    expect(feed.bursts[0]?.x).toBeCloseTo(640, 3);
    expect(feed.bursts[0]?.y).toBeCloseTo(320, 3);
  });

  /**
   * Drawn at the reaction's real radius, read from the ruleset, so the ring the
   * player watches is the area that was actually caught in it. A decoration
   * that merely happened nearby would teach them the wrong thing.
   */
  it('sizes the burst to the reaction`s authored radius', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.bursts[0]?.radius).toBeCloseTo(
      registry.reactions.get('thermal_shock')!.radiusTiles * TILE_SIZE,
      3,
    );
  });

  it('gives a reaction with no radius something to draw', () => {
    const world = createWorldForStage(registry, stage, 1);
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    /* Amplify has no radius of its own; it happens to one enemy. */
    applyStatus(world, slot, STATUS_INDEX.unravel, 1);
    applyStatus(world, slot, STATUS_INDEX.scorch, 1);
    targetingSystem(world);
    reactionSystem(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.bursts[0]?.radius).toBe(POINT_RADIUS);
  });

  it('uses the style belonging to the reaction that fired', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.bursts[0]?.colour).toBe(reactionStyle('thermal_shock').colour);
    expect(feed.bursts[0]?.shape).toBe(reactionStyle('thermal_shock').shape);
  });

  it('ignores every other kind of event', () => {
    const world = createWorldForStage(registry, stage, 1);
    spawnEnemy(world, enemyIndex(world, 'husk'), 0);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.bursts).toHaveLength(0);
  });
});

describe('bursts age and are recycled', () => {
  const feedWithOne = (): ReactionFeed => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);
    const feed = new ReactionFeed();
    feed.consume(world, name);
    return feed;
  };

  it('expands as it ages', () => {
    const feed = feedWithOne();
    const first = ReactionFeed.progress(feed.bursts[0]!);
    feed.advance();
    expect(ReactionFeed.progress(feed.bursts[0]!)).toBeGreaterThan(first);
  });

  it('retires once it has run its course', () => {
    const feed = feedWithOne();
    for (let frame = 0; frame < 200; frame++) feed.advance();
    expect(feed.bursts).toHaveLength(0);
  });

  /**
   * The hard cap risk T3 calls for. A dense wave must drop bursts rather than
   * grow the pool, because a missing burst is invisible for a frame and a
   * mid-wave allocation is a stutter the player feels.
   */
  it('caps how many are in flight and reports what it dropped', () => {
    const world = createWorldForStage(registry, stage, 1);
    for (let i = 0; i < 200; i++) detonate(world, 400 + i * 200, 400);

    const feed = new ReactionFeed();
    feed.consume(world, name);

    expect(feed.bursts.length).toBeLessThanOrEqual(64);
    expect(feed.droppedBursts).toBeGreaterThan(0);
  });

  it('reuses retired bursts rather than allocating more', () => {
    const feed = feedWithOne();
    for (let frame = 0; frame < 200; frame++) feed.advance();

    const world = createWorldForStage(registry, stage, 1);
    for (let i = 0; i < 64; i++) detonate(world, 400 + i * 200, 400);
    feed.consume(world, name);

    expect(feed.bursts).toHaveLength(64);
    expect(feed.droppedBursts).toBe(0);
  });

  /**
   * Frames are counted, not measured against a clock. That is what lets a
   * paused game hold a burst mid-expansion — the render loop simply stops
   * calling `advance` — rather than having it finish while nothing else moves.
   */
  it('ages by exactly one frame per advance, and not otherwise', () => {
    const feed = feedWithOne();
    const started = feed.bursts[0]!.life;

    for (let frame = 1; frame <= 5; frame++) {
      feed.advance();
      expect(feed.bursts[0]!.life).toBe(started - frame);
    }

    /* Paused: no advance, no ageing, however long passes. */
    const held = feed.bursts[0]!.life;
    expect(feed.bursts[0]!.life).toBe(held);
    feed.advance();
    expect(feed.bursts[0]!.life).toBe(held - 1);
  });
});

describe('the first of each reaction names itself', () => {
  it('labels a reaction the first time it happens', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.labels).toHaveLength(1);
    expect(feed.labels[0]?.text).toBe(name('thermal_shock'));
  });

  /**
   * Named more than once, but not forever.
   *
   * Once was the original rule and it was wrong: a player looking elsewhere on
   * the first occurrence never got another chance, which is exactly how the
   * first gate session was lost. A few repeats give a distracted player
   * somewhere to land; unlimited ones turn the name into wallpaper.
   */
  it('names it again for the first few, then stops', () => {
    const feed = new ReactionFeed();
    const seen: number[] = [];

    for (let round = 0; round < 6; round++) {
      const world = createWorldForStage(registry, stage, 1);
      detonate(world);
      feed.consume(world, name);
      /* Counted per round and then retired, so each entry is what that round
         newly raised rather than what happens to still be on screen. */
      seen.push(feed.labels.length);
      for (let frame = 0; frame < 200; frame++) feed.advance();
    }

    expect(seen).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('labels a different reaction on its own first occurrence', () => {
    const feed = new ReactionFeed();

    const first = createWorldForStage(registry, stage, 1);
    detonate(first);
    feed.consume(first, name);

    const second = createWorldForStage(registry, stage, 1);
    const slot = spawnEnemy(second, enemyIndex(second, 'husk'), 0);
    applyStatus(second, slot, STATUS_INDEX.chill, 1);
    applyStatus(second, slot, STATUS_INDEX.charge, 1);
    targetingSystem(second);
    reactionSystem(second);
    feed.consume(second, name);

    expect(feed.labels.map((label) => label.text)).toEqual([
      name('thermal_shock'),
      name('superconduct'),
    ]);
  });

  it('takes its colour from the reaction it names', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.labels[0]?.colour).toBe(reactionStyle('thermal_shock').colour);
  });

  it('fades away on its own', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    for (let frame = 0; frame < 200; frame++) feed.advance();
    expect(feed.labels).toHaveLength(0);
  });
});

describe('the damage floats where it happened', () => {
  /**
   * The most direct answer to "what just killed that?" — the question §4.5
   * says a player must never need a wiki to answer.
   */
  it('shows what the reaction dealt', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);

    const thermal = registry.reactions.get('thermal_shock')!;
    expect(feed.numbers).toHaveLength(1);
    expect(feed.numbers[0]?.amount).toBeCloseTo(thermal.baseDamage + thermal.damagePerStack * 2, 2);
  });

  it('takes the reaction`s colour, like the burst', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.numbers[0]?.colour).toBe(reactionStyle('thermal_shock').colour);
  });

  /* Superconduct strips armour instead of dealing damage. A floating "0"
     would say something false about what just happened. */
  it('shows nothing for a reaction that deals no damage', () => {
    const world = createWorldForStage(registry, stage, 1);
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    applyStatus(world, slot, STATUS_INDEX.chill, 1);
    applyStatus(world, slot, STATUS_INDEX.charge, 1);
    targetingSystem(world);
    reactionSystem(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.bursts).toHaveLength(1);
    expect(feed.numbers).toHaveLength(0);
  });

  it('keeps going up as it ages, then leaves', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    for (let frame = 0; frame < 200; frame++) feed.advance();
    expect(feed.numbers).toHaveLength(0);
  });

  it('caps how many can pile up at once', () => {
    const world = createWorldForStage(registry, stage, 1);
    for (let i = 0; i < 100; i++) detonate(world, 400 + i * 200, 400);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    expect(feed.numbers.length).toBeLessThanOrEqual(32);
  });
});

describe('a restarted stage starts over', () => {
  /**
   * Including the record of what has been named. For the player, the restarted
   * run's first Thermal Shock is a first Thermal Shock, and #62 asks whether
   * they can make one happen again on purpose — which they will try to do by
   * restarting.
   */
  it('announces the first reaction again after a reset', () => {
    const feed = new ReactionFeed();

    const before = createWorldForStage(registry, stage, 1);
    detonate(before);
    feed.consume(before, name);
    feed.reset();

    const after = createWorldForStage(registry, stage, 1);
    detonate(after);
    feed.consume(after, name);

    expect(feed.labels).toHaveLength(1);
  });

  it('drops everything in flight', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    feed.reset();

    expect(feed.bursts).toHaveLength(0);
    expect(feed.labels).toHaveLength(0);
    expect(feed.numbers).toHaveLength(0);
    expect(feed.droppedBursts).toBe(0);
  });

  it('returns the bursts to the pool rather than losing them', () => {
    const world = createWorldForStage(registry, stage, 1);
    for (let i = 0; i < 64; i++) detonate(world, 400 + i * 200, 400);

    const feed = new ReactionFeed();
    feed.consume(world, name);
    feed.reset();

    const again = createWorldForStage(registry, stage, 1);
    for (let i = 0; i < 64; i++) detonate(again, 400 + i * 200, 400);
    feed.consume(again, name);

    expect(feed.bursts).toHaveLength(64);
    expect(feed.droppedBursts).toBe(0);
  });
});

describe('polygonPoints', () => {
  it('writes one x,y pair per side', () => {
    const out: number[] = [];
    polygonPoints(0, 0, 10, 6, 0, out);
    expect(out).toHaveLength(12);
  });

  it('places every point on the circle', () => {
    const out: number[] = [];
    polygonPoints(100, 50, 20, 6, 0.3, out);
    for (let i = 0; i < out.length; i += 2) {
      expect(Math.hypot((out[i] as number) - 100, (out[i + 1] as number) - 50)).toBeCloseTo(20, 6);
    }
  });

  /* Reused across every burst, so it must not leave the previous shape's
     points behind. */
  it('clears the buffer it is given', () => {
    const out: number[] = [1, 2, 3, 4, 5];
    polygonPoints(0, 0, 10, 4, 0, out);
    expect(out).toHaveLength(8);
  });
});

/**
 * Text that used to pile into a jumble.
 *
 * A playtester hit this directly: *"when a few enemies proc it close together,
 * the text overlaps and turns into a jumble you can't actually read"* — which
 * is most of why the reaction gate's readability criterion came back qualified
 * rather than clean.
 */
describe('floating text stacks instead of overlapping', () => {
  it('leaves the first one where it happened', () => {
    expect(clearOf(100, 200, [], LABEL_ROW)).toBe(200);
  });

  it('lifts a second one clear of the first', () => {
    const first = { x: 100, y: 200 };
    expect(clearOf(100, 200, [first], LABEL_ROW)).toBe(200 - LABEL_ROW);
  });

  it('keeps lifting as more pile up', () => {
    const placed: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 4; i++) {
      placed.push({ x: 100, y: clearOf(100, 200, placed, LABEL_ROW) });
    }
    const ys = placed.map((p) => p.y);
    expect(ys).toEqual([200, 178, 156, 134]);
    /* Every one readable on its own line. */
    expect(new Set(ys).size).toBe(ys.length);
  });

  it('leaves something far away alone', () => {
    const distant = { x: 100 + COLUMN_WIDTH, y: 200 };
    expect(clearOf(100, 200, [distant], LABEL_ROW)).toBe(200);
  });

  it('shares a line with something vertically clear of it', () => {
    const above = { x: 100, y: 200 - LABEL_ROW };
    expect(clearOf(100, 200, [above], LABEL_ROW)).toBe(200);
  });

  it('stacks the names raised by simultaneous reactions', () => {
    const world = createWorldForStage(registry, stage, 1);
    /* Three reactions in nearly the same place, in one frame. */
    detonate(world, 500);
    detonate(world, 505);
    detonate(world, 510);

    const feed = new ReactionFeed();
    feed.consume(world, name);

    const ys = feed.labels.map((label) => label.y);
    expect(ys.length).toBeGreaterThan(1);
    expect(new Set(ys).size, 'two labels landed on the same line').toBe(ys.length);
  });

  it('stacks the damage numbers too', () => {
    const world = createWorldForStage(registry, stage, 1);
    detonate(world, 500);
    detonate(world, 505);

    const feed = new ReactionFeed();
    feed.consume(world, name);

    const ys = feed.numbers.map((n) => n.y);
    expect(ys.length).toBeGreaterThan(1);
    expect(new Set(ys).size).toBe(ys.length);
  });
});
