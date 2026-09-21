/**
 * Every colour the board uses to say what something is.
 *
 * In one file because these three sets have to be told apart *from each other*,
 * and that is impossible to check when each lives beside the code that draws
 * it. The reaction gate found the failure this file exists to prevent: Thermal
 * Shock was drawn in `0x9be7ff` while Chill's status pip was `0x7fd4ff`, and a
 * playtester could not tell the game's signature mechanic from ordinary frost
 * indication — *"it's possible that blue circle is something I've been looking
 * at the entire time without realising it meant anything special."*
 *
 * Four of the five reactions had the same problem. Each had been coloured after
 * its own ingredients, which is exactly backwards: it makes the reaction look
 * like the thing that caused it, at the moment the player most needs to see
 * that something new has happened.
 *
 * The rule, enforced by a test rather than by memory:
 *
 * > A reaction's colour must be distinguishable from **every** damage type and
 * > **every** status colour. A reaction is a different kind of event, and it
 * > has to look like one.
 */

/** Damage types, as the design reserves them (docs/GAME_DESIGN.md §4.2). */
export const DAMAGE_COLOUR: Readonly<Record<string, number>> = {
  kinetic: 0x9aa4b2,
  pyro: 0xff7a33,
  cryo: 0x7fd4ff,
  volt: 0xc08cff,
  toxic: 0x7fd45a,
  arcane: 0xff5ce0,
  true: 0xe6e9f2,
};

/** Status pips, matching the damage type that applies each one. */
export const STATUS_COLOUR: Readonly<Record<string, number>> = {
  scorch: 0xff7a33,
  chill: 0x7fd4ff,
  freeze: 0xbfefff,
  charge: 0xc08cff,
  corrode: 0x7fd45a,
  unravel: 0xff5ce0,
  fracture: 0x9aa4b2,
};

/**
 * Reactions, deliberately off the elemental palette.
 *
 * Bright and saturated where the statuses are soft, so a detonation reads as an
 * event rather than as more of the same. Thermal Shock is gold rather than the
 * ice-blue of its own Chill; Combustion is a deep red against Scorch's orange;
 * Amplify is white, because it is not an element at all.
 */
export const REACTION_COLOUR: Readonly<Record<string, number>> = {
  thermal_shock: 0xfff200,
  superconduct: 0x3344ff,
  electrolysis: 0x00ffa0,
  combustion: 0xff1744,
  amplify: 0xffffff,
};

/**
 * Build plots, and the ley nodes a few of them sit on (§5).
 *
 * Four types that grant four different things, so four colours: a player has to
 * be able to read which node a plot carries *before* committing a tower to it,
 * and a single teal marker for all of them would mean tapping each plot to find
 * out. The rule here is that the four are tellable apart from each other and
 * from an ordinary plot — nothing more.
 *
 * Deliberately **not** held to the reaction rule below. These are static board
 * furniture on the plot layer, drawn before anything is built and covered by
 * the tower afterwards; they never share a moment with a detonation the way a
 * status pip does. Holding them to it would also be impossible — nine hues are
 * already reserved, and four more at 30 degrees' clearance do not fit.
 */
export const PLOT_COLOUR = 0xf2c14e;

export const LEY_COLOUR: Readonly<Record<string, number>> = {
  flux: 0x4dd0e1,
  depth: 0x8b7cff,
  resonance: 0x3ddc84,
  surge: 0xff4d94,
};

/**
 * Enemy behaviour telegraphs (#29, design pillar P4).
 *
 * *"Every enemy that changes the rules gets a telegraph"* (§9.3), and the thing
 * a telegraph has to say first is **which** rule is about to change — a Sapper
 * winding up and a Mender healing are answered by the player in opposite ways.
 *
 * Green for the support trio, because *"support enemies always outrank damage
 * enemies in threat"* and the player's decision about all three is the same
 * one: kill this before anything else. The two that act on a timer get their
 * own hues, since they are threats to a place rather than to a health bar.
 *
 * Held to the same mutual-distinguishability rule as the ley markers rather
 * than to the reaction rule: these are overlays on an enemy that is already
 * on screen, and what matters is telling them from each other.
 *
 * They are spaced evenly rather than chosen for flavour, and the slack is
 * nearly gone. The first attempt picked by feel and put suppression and
 * sapping 25 degrees apart, which the test caught: two pinks meaning "your
 * tower is slowed" and "your tower is about to go dark", the two telegraphs a
 * player most needs to tell apart.
 *
 * The bosses' two (#33) forced a respace of all of them. Seven sat at 51
 * degrees; nine sit at 40, still clear of the floor but with a third of the
 * room. Every existing hue moved as a result, which is a cost paid
 * deliberately and paid now: the behaviour telegraphs have not been in front
 * of a playtester yet, and the same respace at twelve would not fit at all.
 * **Whoever adds a tenth cannot solve it here.** The answer at that point is
 * the one `src/view/reactions.ts` already took — a second channel, shape, so
 * two telegraphs can share a hue and still be told apart.
 */
export const BEHAVIOUR_COLOUR: Readonly<Record<string, number>> = {
  sap: 0xff5338,
  haste: 0xffd738,
  heal: 0xa2ff38,
  shield: 0x38ff53,
  suppress: 0x38ffd7,
  spawn: 0x38a2ff,
  phase: 0x5338ff,
  devour: 0xd738ff,
  spit: 0xff38a2,
};

/** Hue in degrees, saturation and value, each 0-1 except hue. */
export function toHsv(colour: number): { hue: number; saturation: number; value: number } {
  const r = ((colour >> 16) & 0xff) / 255;
  const g = ((colour >> 8) & 0xff) / 255;
  const b = (colour & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;

  let hue = 0;
  if (span !== 0) {
    if (max === r) hue = ((g - b) / span) % 6;
    else if (max === g) hue = (b - r) / span + 2;
    else hue = (r - g) / span + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { hue, saturation: max === 0 ? 0 : span / max, value: max };
}

/**
 * Below this saturation a colour has no usable hue.
 *
 * Grey and near-white read as "colourless"; asking whether one is 40 degrees
 * from another is meaningless, so those pairs are compared on tone instead.
 */
export const NEUTRAL_SATURATION = 0.35;

/** Degrees of hue two coloured things need between them to read as different. */
export const MIN_HUE_SEPARATION = 30;
/** Saturation-and-value distance two near-neutral things need instead. */
export const MIN_TONE_SEPARATION = 0.25;

export interface Separation {
  /** Which rule applied: hue for two coloured things, tone when either is not. */
  kind: 'hue' | 'tone';
  amount: number;
  distinguishable: boolean;
}

/**
 * Whether two colours read as different things on a moving board.
 *
 * Hue, not overall distance. Overall distance is the wrong question here and
 * measuring it was how the bug shipped: the palette's thirteen reserved colours
 * are all bright and saturated, so *any* bright colour scores close to
 * something, and a threshold strict enough to catch a real collision would
 * reject every colour a burst could usefully be. What actually went wrong was
 * narrower than that — Thermal Shock and Chill were **the same hue**, both pale
 * blue, and no amount of brightness would have separated them.
 */
export function separation(a: number, b: number): Separation {
  const first = toHsv(a);
  const second = toHsv(b);

  if (first.saturation < NEUTRAL_SATURATION || second.saturation < NEUTRAL_SATURATION) {
    const amount = Math.hypot(first.saturation - second.saturation, first.value - second.value);
    return { kind: 'tone', amount, distinguishable: amount >= MIN_TONE_SEPARATION };
  }

  const raw = Math.abs(first.hue - second.hue);
  const amount = Math.min(raw, 360 - raw);
  return { kind: 'hue', amount, distinguishable: amount >= MIN_HUE_SEPARATION };
}

/**
 * The colours a reaction must not be mistaken for.
 *
 * Every status, and every damage type something actually deals. `true` damage
 * is excluded deliberately: nothing in the game deals it — it is reserved for
 * tier 5 (#32) — and it applies no status and triggers no reaction, so it can
 * never share a frame with a reaction meaning something else. **Whoever
 * implements true damage should put it back and re-check.**
 */
export function reservedColours(): Array<[string, number]> {
  return [
    ...Object.entries(DAMAGE_COLOUR).filter(([type]) => type !== 'true'),
    ...Object.entries(STATUS_COLOUR),
  ];
}
