import { z } from 'zod';
import {
  DamageTypeSchema,
  IdSchema,
  LocaleKeySchema,
  NonNegative,
  Positive,
  StageIdSchema,
  StatusApplicationSchema,
  TargetClassSchema,
  Tiles,
  TowerFamilySchema,
} from './common.js';
import { EffectSchema } from './common.js';

/** One rung of a tower's upgrade path. */
export const TowerTierSchema = z.object({
  cost: z.number().int().positive(),
  damage: NonNegative,
  damageType: DamageTypeSchema,
  /** Shots per second. Aura towers use this as their pulse rate. */
  fireRate: Positive,
  rangeTiles: Positive,
  /** Mortars cannot hit what is too close. */
  minRangeTiles: Tiles.default(0),
  splashRadiusTiles: Tiles.default(0),
  targets: TargetClassSchema.default('both'),
  statusApplied: StatusApplicationSchema.optional(),
  /** Flat armour ignored before the damage formula runs. */
  armourPierce: NonNegative.default(0),
  /** Extra gold per kill, for economy towers. */
  bonusGoldPerKill: NonNegative.default(0),
  perkKeys: z.array(LocaleKeySchema).default([]),
});

/** A tier-5 capstone ability, paid for with Aether Charge. */
export const TowerAbilitySchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  cost: z.number().int().nonnegative(),
  cooldownSeconds: NonNegative,
  effects: z.array(EffectSchema).min(1),
});

/** One of the two tier-4 branches, plus its tier-5 capstone. */
export const SpecialisationSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  tiers: z.tuple([TowerTierSchema, TowerTierSchema]),
  ability: TowerAbilitySchema,
});

export const TowerSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  family: TowerFamilySchema,
  /** Tiers 1 to 3: straight power upgrades that keep the tower's identity. */
  tiers: z.tuple([TowerTierSchema, TowerTierSchema, TowerTierSchema]),
  /** Tier 4 branches into exactly two identity-changing choices. */
  specialisations: z.tuple([SpecialisationSchema, SpecialisationSchema]),
  /** Stage that must be cleared before this tower is available. Absent means available from the start. */
  unlockedByStage: StageIdSchema.optional(),
  /** Fraction of total invested gold returned on sell. */
  sellRefund: z.number().min(0).max(1).default(0.7),
});

export type TowerDefinition = z.infer<typeof TowerSchema>;
export type TowerTier = z.infer<typeof TowerTierSchema>;
