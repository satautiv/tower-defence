import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  MAX_CONCURRENT,
  MIN_INTERVAL_MS,
  StingerThrottle,
  detuneFor,
  stingerFor,
  stingerIds,
  stingerSeconds,
} from '@audio/index';

/**
 * The sound a reaction makes (#44's one bullet the reaction gate needs).
 *
 * > A unique, louder stinger per reaction — the player should learn to
 * > recognise a Thermal Shock without looking.
 *
 * "Without looking" is the whole point. The first gate session was lost to a
 * tester who triggered a Thermal Shock while watching his gold: every channel
 * the game had was visual, and not one of them reached him.
 */

const registry = buildRegistry(readContentFromDisk());

describe('every reaction sounds different', () => {
  it('has a stinger for every reaction the content defines', () => {
    for (const id of registry.reactions.keys()) {
      expect(stingerIds()).toContain(id);
    }
  });

  /**
   * Distinguished on every axis at once, not on pitch alone. A set of sounds
   * that differ only in pitch is a set most people cannot tell apart, which
   * would leave the audio channel technically present and useless.
   */
  it('gives each one its own starting pitch', () => {
    const pitches = stingerIds().map((id) => stingerFor(id).fromHz);
    expect(new Set(pitches).size).toBe(pitches.length);
  });

  it('does not distinguish them by pitch alone', () => {
    const shapes = new Set(stingerIds().map((id) => stingerFor(id).wave));
    expect(shapes.size).toBeGreaterThan(1);

    const textures = new Set(stingerIds().map((id) => stingerFor(id).noise));
    expect(textures.size).toBeGreaterThan(1);
  });

  /* Sweeping up and sweeping down are told apart instantly, even by someone
     who could not name either note. */
  it('sweeps some up and some down', () => {
    const directions = stingerIds().map((id) => {
      const recipe = stingerFor(id);
      return Math.sign(recipe.toHz - recipe.fromHz);
    });
    expect(directions).toContain(1);
    expect(directions).toContain(-1);
  });

  it('keeps every stinger short enough to be punctuation', () => {
    for (const id of stingerIds()) {
      expect(stingerSeconds(stingerFor(id))).toBeLessThan(1);
    }
  });

  it('never sweeps to silence, which an exponential ramp cannot reach', () => {
    for (const id of stingerIds()) {
      const recipe = stingerFor(id);
      expect(recipe.fromHz).toBeGreaterThan(0);
      expect(recipe.toHz).toBeGreaterThan(0);
    }
  });

  /* A reaction with no recipe must still be audible. Failing silently is the
     one outcome nobody notices until a playtest. */
  it('falls back to something audible for an unknown reaction', () => {
    const recipe = stingerFor('not_a_reaction');
    expect(recipe.gain).toBeGreaterThan(0);
    expect(stingerSeconds(recipe)).toBeGreaterThan(0);
  });
});

describe('the throttle keeps a chain from becoming noise', () => {
  const SECONDS = 0.3;

  it('lets the first one through', () => {
    const throttle = new StingerThrottle();
    expect(throttle.admit('thermal_shock', 0, SECONDS)).toBe(true);
  });

  /**
   * #44's own requirement: forty enemies dying in one Thermal Shock must not
   * trigger forty sounds. A chain can resolve dozens of reactions in a handful
   * of ticks, and played unthrottled that is a wall of noise carrying no
   * information at all.
   */
  it('refuses the same sound again immediately', () => {
    const throttle = new StingerThrottle();
    throttle.admit('thermal_shock', 0, SECONDS);
    expect(throttle.admit('thermal_shock', MIN_INTERVAL_MS - 1, SECONDS)).toBe(false);
    expect(throttle.suppressedCount).toBe(1);
  });

  it('lets it through once the interval has passed', () => {
    const throttle = new StingerThrottle();
    throttle.admit('thermal_shock', 0, SECONDS);
    expect(throttle.admit('thermal_shock', MIN_INTERVAL_MS, SECONDS)).toBe(true);
  });

  /* Different reactions arriving together are information, not spam — the
     player should hear that two things happened. */
  it('does not hold one reaction back because another just played', () => {
    const throttle = new StingerThrottle();
    throttle.admit('thermal_shock', 0, SECONDS);
    expect(throttle.admit('combustion', 1, SECONDS)).toBe(true);
  });

  it('caps how many sound at once, so nothing clips', () => {
    const throttle = new StingerThrottle();
    const ids = ['thermal_shock', 'superconduct', 'electrolysis', 'combustion', 'amplify'];

    const admitted = ids.filter((id) => throttle.admit(id, 0, SECONDS));
    expect(admitted).toHaveLength(MAX_CONCURRENT);
    expect(throttle.suppressedCount).toBe(ids.length - MAX_CONCURRENT);
  });

  it('frees the slots again as the sounds finish', () => {
    const throttle = new StingerThrottle();
    for (const id of ['thermal_shock', 'superconduct', 'electrolysis', 'combustion']) {
      throttle.admit(id, 0, SECONDS);
    }
    expect(throttle.admit('amplify', 1, SECONDS)).toBe(false);

    /* Every one of them has finished by now. */
    expect(throttle.admit('amplify', SECONDS * 1000 + 1, SECONDS)).toBe(true);
  });

  it('survives a chain without growing without bound', () => {
    const throttle = new StingerThrottle();
    let played = 0;
    for (let tick = 0; tick < 600; tick++) {
      /* Ten reactions a tick, which no real board produces. */
      for (let i = 0; i < 10; i++) {
        if (throttle.admit('thermal_shock', tick * 16, SECONDS)) played++;
      }
    }
    /* 600 ticks is ten seconds; at 90ms apart that is about 110 at most. */
    expect(played).toBeLessThan(120);
    expect(played).toBeGreaterThan(0);
  });

  it('starts over on reset', () => {
    const throttle = new StingerThrottle();
    throttle.admit('thermal_shock', 0, SECONDS);
    throttle.admit('thermal_shock', 1, SECONDS);
    throttle.reset();

    expect(throttle.suppressedCount).toBe(0);
    expect(throttle.admit('thermal_shock', 2, SECONDS)).toBe(true);
  });
});

describe('repeated stingers vary', () => {
  /**
   * #44 asks for variation so a repeated sound does not read as a machine.
   * Taken from a counter rather than `Math.random`, because a replay whose
   * audio diverged would be a replay nobody trusts.
   */
  it('detunes successive plays differently', () => {
    const offsets = [0, 1, 2, 3, 4].map(detuneFor);
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  it('gives the same answer for the same play count, every time', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(detuneFor)).toEqual([0, 1, 2, 3, 4, 5, 6].map(detuneFor));
  });

  it('starts unshifted, so the first one is the reference', () => {
    expect(detuneFor(0)).toBe(0);
  });

  /* Wide enough to hear, narrow enough that it is still the same sound. */
  it('stays within a musically small range', () => {
    for (let i = 0; i < 50; i++) expect(Math.abs(detuneFor(i))).toBeLessThanOrEqual(100);
  });
});
