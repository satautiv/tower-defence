import { z } from 'zod';
import {
  IdSchema,
  LocaleKeySchema,
  NonNegative,
  Seconds,
  StatusIdSchema,
  Tiles,
} from './common.js';

/**
 * A reaction between two statuses on the same enemy (docs/GAME_DESIGN.md §4.3).
 * This is the game's signature mechanic, so it is data rather than code: the
 * matrix will be retuned many times before launch.
 */
export const ReactionSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  /** The two statuses that must coexist. `any` matches any other reactive status. */
  a: StatusIdSchema,
  b: z.union([StatusIdSchema, z.literal('any')]),
  /** Whether triggering consumes the statuses. Amplify deliberately does not. */
  consumes: z.boolean().default(true),
  /** Per-enemy lockout before this reaction can trigger again. */
  cooldownSeconds: Seconds,
  /** Flat damage, before the per-stack contribution. */
  baseDamage: NonNegative.default(0),
  /** Additional damage per stack of `a` present when it triggers. */
  damagePerStack: NonNegative.default(0),
  radiusTiles: Tiles.default(0),
  /** Chain reactions such as electrolysis jump to this many further enemies. */
  jumps: z.number().int().nonnegative().default(0),
});

export type ReactionDefinition = z.infer<typeof ReactionSchema>;
export const ReactionFileSchema = z.array(ReactionSchema);
