import { z } from 'zod';
import { NonNegative, Positive } from './common.js';

/**
 * What a ley node grants the tower standing on it (docs/GAME_DESIGN.md §5).
 *
 * Four independent columns, of which each authored type fills exactly one and
 * leaves the rest neutral. Expressed that way rather than as a tagged bonus so
 * the stat pipeline multiplies four numbers unconditionally instead of
 * branching on which node it is standing on — and so a fifth node type is a
 * JSON edit rather than a new case in `applyTowerStats`.
 */
const LeyBonusSchema = z.object({
  /** Multiplier on shots per second. */
  attackSpeed: Positive.default(1),
  /** Multiplier on reach. */
  range: Positive.default(1),
  /** Extra stacks on top of whatever this tower's hits already apply. */
  statusStacks: z.number().int().nonnegative().default(0),
  /** Multiplier on reactions this tower's hits set off. */
  reactionDamage: Positive.default(1),
});

/**
 * Global combat and economy constants.
 *
 * The numbers that belong to no single tower or enemy but still decide how the
 * game feels: how quickly armour pays off, how fast Aether charges, what an
 * early call is worth. They live in content for the same reason every other
 * balance number does — the simulator sweeps them, and tuning must not require
 * a rebuild.
 */
export const TuningSchema = z.object({
  /**
   * Armour value at which damage is halved. Diminishing returns rather than
   * flat subtraction, so no enemy is ever immune to a damage type — a heavily
   * armoured target is a bad choice for Kinetic, never an impossible one
   * (docs/GAME_DESIGN.md §7.1).
   */
  defenceHalfPoint: Positive,
  /** Ceiling on effective armour and ward, bounding the best case reduction. */
  defenceCap: Positive,

  aetherPerKill: NonNegative,
  aetherPerReaction: NonNegative,
  aetherPerSecond: NonNegative,
  aetherMax: Positive,

  /** Gold per second of timer skipped when a wave is called early. */
  earlyCallGoldPerSecond: NonNegative,

  /** Multiplier a Kinetic blow gets against a frozen target. */
  shatterMultiplier: Positive,
  /** Minimum damage before a blow counts as a shatter rather than a chip. */
  shatterThreshold: NonNegative,

  /**
   * Fraction of starting lives still needed for two stars. Three stars always
   * means losing none, so only this one needs authoring — and expressing it as
   * a fraction keeps it correct on every difficulty rather than assuming 20.
   */
  twoStarLivesFraction: z.number().min(0).max(1),

  /**
   * How long a build can be taken back for a full refund.
   *
   * Misplacing a tower on a touchscreen is common and infuriating, and a 70%
   * sell refund punishes a slip the same as a change of mind
   * (docs/GAME_DESIGN.md §17.3).
   */
  undoWindowSeconds: NonNegative,

  /**
   * Armour and ward at which the wave preview flags an enemy as Armoured or
   * Warded. A preview threshold, not a combat one: it decides when a defence
   * is high enough that the player should change what they build, which is
   * the question the preview exists to answer (docs/GAME_DESIGN.md §8.6).
   */
  previewArmourThreshold: Positive,
  previewWardThreshold: Positive,

  /**
   * The ley node bonuses, one entry per type in `LEY_NODE_TYPES`.
   *
   * Every type is required rather than optional: a node a map can author but
   * tuning has never heard of would be a plot that promises a bonus and grants
   * nothing, which is the one failure the player cannot see.
   */
  leyNodes: z.object({
    flux: LeyBonusSchema,
    depth: LeyBonusSchema,
    resonance: LeyBonusSchema,
    surge: LeyBonusSchema,
  }),
});

export type TuningDefinition = z.infer<typeof TuningSchema>;
