import { z } from 'zod';
import { EffectSchema, IdSchema, LocaleKeySchema, NonNegative, StageIdSchema } from './common.js';

/** A Warden Power: an active ability paid for with Aether Charge. */
export const PowerSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  cost: z.number().int().nonnegative(),
  cooldownSeconds: NonNegative,
  targeting: z.enum(['point', 'self', 'global', 'path_segment']),
  effects: z.array(EffectSchema).min(1),
  unlockedByStage: StageIdSchema.optional(),
});

export type PowerDefinition = z.infer<typeof PowerSchema>;
