import { z } from 'zod';
import { IdSchema, LocaleKeySchema } from './common.js';

export const TALENT_BRANCHES = ['conduction', 'foundry', 'command', 'dominion'] as const;
export const TalentBranchSchema = z.enum(TALENT_BRANCHES);

/**
 * A node in the Warden Talent tree. Total contribution across the whole tree is
 * capped at roughly +35% effective power: talents smooth the curve for players
 * who struggle, they do not replace skill (docs/GAME_DESIGN.md §14.1).
 */
export const TalentSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  branch: TalentBranchSchema,
  maxRanks: z.number().int().positive(),
  /** Stars to buy one rank. */
  starCostPerRank: z.number().int().positive(),
  /** Stat modified, and the amount granted per rank. */
  modifier: z.object({
    stat: z.string().min(1),
    perRank: z.number(),
    /** Whether `perRank` is a fraction of the base or a flat amount. */
    mode: z.enum(['multiplier', 'flat']).default('multiplier'),
  }),
  /** Talents that must be ranked up first. Checked for cycles by content-lint. */
  requires: z.array(IdSchema).default([]),
});

export type TalentDefinition = z.infer<typeof TalentSchema>;
