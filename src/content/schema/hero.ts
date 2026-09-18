import { z } from 'zod';
import {
  DamageTypeSchema,
  EffectSchema,
  IdSchema,
  LocaleKeySchema,
  NonNegative,
  Positive,
  Seconds,
  StageIdSchema,
  Tiles,
} from './common.js';

export const HeroAbilitySchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  cooldownSeconds: NonNegative,
  effects: z.array(EffectSchema).min(1),
});

/**
 * A commandable hero. Balance target is roughly one tier-3 tower's damage plus
 * a barracks' utility: flexible rather than stronger (docs/GAME_DESIGN.md §11).
 */
export const HeroSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  damageType: DamageTypeSchema,
  hp: Positive,
  damage: NonNegative,
  attacksPerSecond: Positive,
  attackRangeTiles: Tiles,
  armour: NonNegative.default(0),
  respawnSeconds: Seconds,
  /** Per-level multipliers applied from level 1 to 10. */
  hpPerLevel: NonNegative.default(0),
  damagePerLevel: NonNegative.default(0),
  abilities: z.tuple([HeroAbilitySchema, HeroAbilitySchema, HeroAbilitySchema]),
  unlockedByStage: StageIdSchema.optional(),
});

export type HeroDefinition = z.infer<typeof HeroSchema>;
