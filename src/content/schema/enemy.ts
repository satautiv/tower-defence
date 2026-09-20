import { z } from 'zod';
import {
  IdSchema,
  LocaleKeySchema,
  NonNegative,
  Positive,
  Seconds,
  StatusApplicationSchema,
  Tiles,
} from './common.js';

/**
 * Behaviours that change the rules, as opposed to stat blocks that change the
 * numbers. Behaviours are expensive to implement and cheap to restat, which is
 * why later regions reuse these with new numbers rather than inventing more
 * (docs/GAME_DESIGN.md §9.1).
 */
export const ENEMY_TRAITS = [
  'flying',
  'burrow',
  'phase',
  'evasion',
  'overshield',
  'directional_armour',
  'splitter',
  'healer',
  'shielder',
  'sapper',
  'tower_slow_aura',
  'ally_haste_aura',
  'carrier',
  'stationary_spawner',
  'freeze_immune',
  'boss',
] as const;
export const EnemyTraitSchema = z.enum(ENEMY_TRAITS);
export type EnemyTrait = z.infer<typeof EnemyTraitSchema>;

/** Per-trait tuning. Only the fields a given trait reads are meaningful. */
export const EnemyTraitConfigSchema = z
  .object({
    /** evasion: chance in [0,1] to ignore a projectile entirely. */
    evasionChance: z.number().min(0).max(1).optional(),
    /** overshield: absorb pool, and how long out of combat before it regenerates. */
    overshield: NonNegative.optional(),
    overshieldRegenDelaySeconds: Seconds.optional(),
    /** directional_armour: armour when struck from behind. */
    rearArmour: NonNegative.optional(),
    /** splitter: what it becomes on death, and how many. */
    splitsInto: IdSchema.optional(),
    splitCount: z.number().int().positive().optional(),
    /** healer / shielder / auras: radius and magnitude. */
    auraRadiusTiles: Tiles.optional(),
    healPerSecond: NonNegative.optional(),
    auraTargets: z.number().int().positive().optional(),
    towerFireRateMultiplier: z.number().positive().optional(),
    allySpeedMultiplier: z.number().positive().optional(),
    allyArmourBonus: NonNegative.optional(),
    /** sapper: how long a tower it reaches is disabled. */
    disableSeconds: Seconds.optional(),
    /** phase: damage threshold that triggers a jump, and how far. */
    phaseDamageThreshold: NonNegative.optional(),
    phaseDistanceTiles: Tiles.optional(),
    /** carrier / stationary_spawner: what it spawns and how often. */
    spawns: IdSchema.optional(),
    spawnIntervalSeconds: Seconds.optional(),
    spawnCount: z.number().int().positive().optional(),
  })
  .default({});

export const EnemySchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  hp: Positive,
  /** Tiles per second. */
  speed: NonNegative,
  armour: NonNegative.default(0),
  ward: NonNegative.default(0),
  /** Gold awarded on death. */
  bounty: z.number().int().nonnegative(),
  /** Lives lost if it reaches the core. Stationary spawners cost none. */
  livesCost: z.number().int().nonnegative().default(1),
  traits: z.array(EnemyTraitSchema).default([]),
  traitConfig: EnemyTraitConfigSchema,
  /** Melee retaliation against blocking soldiers. */
  meleeDamage: NonNegative.default(0),
  meleeIntervalSeconds: Positive.default(1),
  /**
   * Longest a soldier may hold this enemy before it shoulders past, in seconds.
   *
   * The release valve that stops a stall-lock. Without it two soldiers and a
   * rally flag can hold a boss forever, which is not a strategy the design
   * wants to exist — bosses get a short window, ordinary enemies a long one
   * (docs/TECH_DESIGN.md §7.7).
   */
  maxBlockSeconds: Positive.default(12),
  /** Status this enemy applies when it attacks, if any. */
  statusApplied: StatusApplicationSchema.optional(),
});

export type EnemyDefinition = z.infer<typeof EnemySchema>;
