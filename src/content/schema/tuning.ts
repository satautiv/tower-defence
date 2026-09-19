import { z } from 'zod';
import { NonNegative, Positive } from './common.js';

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
});

export type TuningDefinition = z.infer<typeof TuningSchema>;
