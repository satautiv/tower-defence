import { describe, expect, it } from 'vitest';
import {
  DAMAGE_COLOUR,
  MIN_HUE_SEPARATION,
  REACTION_COLOUR,
  STATUS_COLOUR,
  reservedColours,
  separation,
  toHsv,
} from '@view/palette';

/**
 * Colours that have to be told apart.
 *
 * This test exists because the reaction gate caught what its absence cost.
 * Thermal Shock was drawn in `0x9be7ff` while Chill's pip was `0x7fd4ff` — the
 * same hue, both pale blue — and a playtester could not tell the game's
 * signature mechanic from ordinary frost indication: *"it's possible that blue
 * circle is something I've been looking at the entire time without realising it
 * meant anything special."* Four of the five reactions had the same fault,
 * because each had been coloured after its own ingredients.
 */

const reactions = Object.entries(REACTION_COLOUR);

describe('a reaction never looks like an element', () => {
  it.each(reactions)('%s is distinguishable from every colour a player reads', (id, colour) => {
    for (const [name, other] of reservedColours()) {
      const { kind, amount, distinguishable } = separation(colour, other);
      expect(distinguishable, `${id} vs ${name}: ${kind} ${amount.toFixed(1)}`).toBe(true);
    }
  });

  it.each(reactions)('%s is distinguishable from every other reaction', (id, colour) => {
    for (const [other, otherColour] of reactions) {
      if (other === id) continue;
      const { kind, amount, distinguishable } = separation(colour, otherColour);
      expect(distinguishable, `${id} vs ${other}: ${kind} ${amount.toFixed(1)}`).toBe(true);
    }
  });

  it('gives each reaction its own colour', () => {
    const colours = Object.values(REACTION_COLOUR);
    expect(new Set(colours).size).toBe(colours.length);
  });

  /* Reactions are the loudest thing on the board on purpose. A washed-out one
     would lose to the sprites it is drawn over. */
  it.each(reactions)('%s is bright enough to carry a burst', (_id, colour) => {
    expect(toHsv(colour).value).toBeGreaterThanOrEqual(0.9);
  });
});

describe('separation measures hue, not overall difference', () => {
  /**
   * The pair that actually failed a playtest, kept as the calibration point.
   * Whatever the thresholds become, this must still be rejected.
   */
  it('rejects the pair a player could not separate', () => {
    const result = separation(0x9be7ff, STATUS_COLOUR.chill as number);
    expect(result.kind).toBe('hue');
    expect(result.distinguishable).toBe(false);
  });

  it('accepts what replaced it', () => {
    expect(
      separation(REACTION_COLOUR.thermal_shock as number, STATUS_COLOUR.chill as number)
        .distinguishable,
    ).toBe(true);
  });

  it('is symmetric', () => {
    const a = separation(0xff0000, 0x00ff00);
    const b = separation(0x00ff00, 0xff0000);
    expect(a.amount).toBeCloseTo(b.amount, 9);
  });

  it('treats two greys as a question about tone, not hue', () => {
    expect(separation(0x808080, 0xa0a0a0).kind).toBe('tone');
  });

  it('separates black from white on tone', () => {
    expect(separation(0x000000, 0xffffff).distinguishable).toBe(true);
  });

  it('holds the hue threshold where the palette can actually afford it', () => {
    /* Reserved hues sit at 21, 102, 195, 200, 215, 225, 267 and 311 degrees.
       The widest free gap left for a reaction is around 35 degrees either side
       of crimson, so a stricter rule than this could not be satisfied at all. */
    expect(MIN_HUE_SEPARATION).toBe(30);
  });
});

describe('toHsv', () => {
  it.each([
    [0xff0000, 0],
    [0x00ff00, 120],
    [0x0000ff, 240],
  ])('reads the primary hue of %i', (colour, hue) => {
    expect(toHsv(colour).hue).toBeCloseTo(hue, 3);
  });

  it('reports no saturation for a grey', () => {
    expect(toHsv(0x808080).saturation).toBe(0);
  });

  it('reports black as valueless rather than dividing by zero', () => {
    expect(toHsv(0x000000)).toMatchObject({ saturation: 0, value: 0 });
  });
});

describe('statuses keep the colour of the damage type that applies them', () => {
  /* Scorch should look like Pyro, Chill like Cryo: the player learns one
     mapping, not two (docs/GAME_DESIGN.md §4.2). */
  it.each([
    ['scorch', 'pyro'],
    ['chill', 'cryo'],
    ['charge', 'volt'],
    ['corrode', 'toxic'],
    ['unravel', 'arcane'],
    ['fracture', 'kinetic'],
  ])('%s matches %s', (status, damage) => {
    expect(STATUS_COLOUR[status]).toBe(DAMAGE_COLOUR[damage]);
  });
});
