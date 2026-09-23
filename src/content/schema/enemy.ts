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
  'devours',
  'spits_ground',
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
    /**
     * How long a behaviour telegraphs before it lands.
     *
     * Design pillar P4: every enemy that changes the rules gets a telegraph,
     * and a Sapper that disabled a tower the instant it arrived would be a rule
     * change the player could not answer. Authored rather than a constant in
     * code, because how much warning is enough is a balance question.
     */
    telegraphSeconds: Seconds.optional(),
    /** phase: damage threshold that triggers a jump, and how far. */
    phaseDamageThreshold: NonNegative.optional(),
    phaseDistanceTiles: Tiles.optional(),
    /** carrier / stationary_spawner: what it spawns and how often. */
    spawns: IdSchema.optional(),
    spawnIntervalSeconds: Seconds.optional(),
    spawnCount: z.number().int().positive().optional(),
    /**
     * shielder: how often the overshield is re-granted.
     *
     * Its own name rather than reusing `spawnIntervalSeconds`, which the
     * simulation folds it into: a Shieldwright spawns nothing, and authoring a
     * shield refresh under a key called "spawn" is how content ends up lying
     * about itself.
     */
    refreshIntervalSeconds: Seconds.optional(),
    /**
     * devours: the fraction of its own maximum health a swallow returns.
     *
     * Grendrix's Swallow is an instant kill on a soldier, so there is no
     * damage number to author — what a designer tunes is how much the boss
     * gains by doing it, and therefore how badly the player wants to deny it
     * (docs/GAME_DESIGN.md §10).
     */
    devourHealFraction: z.number().min(0).max(1).optional(),
    /** devours: how often it may swallow. */
    devourIntervalSeconds: Seconds.optional(),
    /** spits_ground: the pool it leaves, in the ground-effect system's terms. */
    groundIntervalSeconds: Seconds.optional(),
    groundRadiusTiles: Tiles.optional(),
    groundSeconds: Seconds.optional(),
    groundDamagePerSecond: NonNegative.optional(),
    /**
     * spits_ground: whether the pool holds down the towers it covers.
     *
     * A capability of the ground rather than of the boss, because "this patch
     * of floor suppresses what stands in it" is the same idea whether a Rift
     * Maw spat it or a region authored it into its terrain.
     */
    groundSuppressesTowers: z.boolean().optional(),
  })
  .default({});

/**
 * What a boss becomes below a health threshold (#33, docs/GAME_DESIGN.md §10).
 *
 * A phase states its whole trait set rather than a diff against the phase
 * before it. A designer thinks "in phase two it spits pools and stops
 * swallowing", not "add one trait and remove another", and a diff is the
 * format that makes a two-line change read as four.
 *
 * Everything a phase leaves out it inherits: the same health pool, bounty,
 * lives and melee, because a boss crossing 50% is still the same boss.
 */
export const EnemyPhaseSchema = z.object({
  /**
   * Health fraction at or below which this phase begins.
   *
   * Descending and exclusive of 1, checked cross-file: a phase that began at
   * full health would never be left, and two phases sharing a threshold would
   * make which one you get depend on iteration order.
   */
  belowHealthFraction: z.number().gt(0).lt(1),
  /** Overrides the base sprite, so a transition is visible and not only felt. */
  spriteId: IdSchema.optional(),
  traits: z.array(EnemyTraitSchema).default([]),
  traitConfig: EnemyTraitConfigSchema,
  /** Stat overrides. Anything omitted stays what it was. */
  speed: NonNegative.optional(),
  armour: NonNegative.optional(),
  ward: NonNegative.optional(),
});

export type EnemyPhase = z.infer<typeof EnemyPhaseSchema>;

export const EnemySchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  /**
   * How to fight it, for the Codex (#38, docs/GAME_DESIGN.md §9.1).
   *
   * Authored rather than derived from the trait list, because the useful
   * sentence is not "has directional_armour" but "put towers behind the road".
   * §9.1 already writes one per enemy and this is where they land.
   *
   * Optional in the schema so a fixture need not carry one;
   * `tests/app/codex.test.ts` requires one on every authored enemy, which
   * is the same split `perkKeys` takes on a tier-4 branch.
   */
  counterKey: LocaleKeySchema.optional(),
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
  /**
   * Later phases, in descending threshold order. Empty for everything but a
   * boss, and the simulation pays nothing for an enemy that has none.
   */
  phases: z.array(EnemyPhaseSchema).default([]),
});

export type EnemyDefinition = z.infer<typeof EnemySchema>;
