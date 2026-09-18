import { z } from 'zod';
import { LocaleKeySchema, NonNegative, Seconds, StatusIdSchema } from './common.js';

/** A status effect an enemy can carry (docs/GAME_DESIGN.md §4.2). */
export const StatusSchema = z.object({
  id: StatusIdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  maxStacks: z.number().int().positive(),
  durationSeconds: Seconds,
  /** Refreshing the duration on reapplication, rather than stacking timers. */
  refreshes: z.boolean().default(true),
  /** Damage per second per stack, if the status deals damage over time. */
  damagePerSecondPerStack: NonNegative.default(0),
  /** Fractional move-speed reduction per stack, e.g. 0.12 for chill. */
  slowPerStack: NonNegative.default(0),
  /** Flat armour and ward reduction per stack, e.g. corrode. */
  defenceReductionPerStack: NonNegative.default(0),
  /** Fractional increase to damage taken per stack, e.g. unravel, fracture. */
  vulnerabilityPerStack: NonNegative.default(0),
  /** Reaching max stacks converts into this status, e.g. chill becomes freeze. */
  escalatesTo: StatusIdSchema.optional(),
  /** Stacks remaining after escalation resolves. */
  stacksAfterEscalation: z.number().int().nonnegative().default(0),
  /** Whether this status participates in reactions. Fracture deliberately does not. */
  reactive: z.boolean().default(true),
});

export type StatusDefinition = z.infer<typeof StatusSchema>;
export const StatusFileSchema = z.array(StatusSchema);
