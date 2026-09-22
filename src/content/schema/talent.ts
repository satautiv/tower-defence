import { z } from 'zod';
import { IdSchema, LocaleKeySchema } from './common.js';

export const TALENT_BRANCHES = ['conduction', 'foundry', 'command', 'dominion'] as const;
export const TalentBranchSchema = z.enum(TALENT_BRANCHES);
export type TalentBranch = (typeof TALENT_BRANCHES)[number];

/**
 * Every stat a talent may modify.
 *
 * An enum rather than a free string, for the reason #26 found when it
 * tightened ability effects into a discriminated union: a loose field lets a
 * node be authored against a stat nothing applies, and the player buys a rank
 * that pays nothing. Adding a stat here is one entry, plus the line in
 * `sim/ruleset.ts` that applies it — and the schema refuses the node until
 * both exist.
 */
export const TALENT_STATS = [
  /* Conduction — reactions. */
  'reactionPower',
  'reactionCooldown',
  'aetherPerReaction',
  /* Foundry — towers. */
  'towerDamage',
  'towerRange',
  'buildCost',
  'sellRefund',
  /* Command — hero and soldiers. */
  'soldierHp',
  'heroRespawn',
  'rallyRange',
  'heroAbilityCooldown',
  /* Dominion — economy and powers. */
  'startingGold',
  'aetherRegen',
  'powerCooldown',
] as const;

export const TalentStatSchema = z.enum(TALENT_STATS);
export type TalentStat = (typeof TALENT_STATS)[number];

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
    stat: TalentStatSchema,
    perRank: z.number(),
    /** Whether `perRank` is a fraction of the base or a flat amount. */
    mode: z.enum(['multiplier', 'flat']).default('multiplier'),
  }),
  /** Talents that must be ranked up first. Checked for cycles by content-lint. */
  requires: z.array(IdSchema).default([]),
});

export type TalentDefinition = z.infer<typeof TalentSchema>;
