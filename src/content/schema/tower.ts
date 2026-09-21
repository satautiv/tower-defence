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

/**
 * How a tower delivers damage.
 *
 * Authored rather than inferred from the stats: a large radius could mean a
 * mortar's blast or a frost aura, and guessing would silently give one tower
 * the other's behaviour.
 */
export const FIRING_MODES = ['projectile', 'ballistic', 'beam', 'chain', 'aura', 'cone'] as const;
export const FiringModeSchema = z.enum(FIRING_MODES);

/**
 * The garrison a tower fields, for towers that fight through soldiers.
 *
 * A separate block rather than more loose fields on the tier, because these
 * only mean anything together: a tower either keeps soldiers or it does not,
 * and half a garrison is not a thing. Absent means the tower has none.
 */
export const GarrisonSchema = z.object({
  count: z.number().int().positive(),
  hp: Positive,
  damage: NonNegative,
  /** Seconds between swings. */
  attackIntervalSeconds: Positive,
  armour: NonNegative.default(0),
  damageType: DamageTypeSchema.default('kinetic'),
  /** Seconds before a fallen soldier returns. Counted per slot. */
  respawnSeconds: Positive,
  /** How far the rally flag may be dragged from the tower. */
  rallyRangeTiles: Positive,
  /** Melee is about half a tile; a ranger fights from further out. */
  attackRangeTiles: Positive.default(0.6),
  /** Health recovered per second while not engaged. */
  regenPerSecond: NonNegative.default(0),
  /** Status a soldier applies on hit, if any. */
  statusApplied: StatusApplicationSchema.optional(),
});

/**
 * The mechanics that make a specialisation a *choice* rather than a number
 * (#32, docs/GAME_DESIGN.md §8.2–8.5).
 *
 * A branch's stat block already differs; what makes Sniper Nest and Repeater
 * Battery different *strategies* is that one ignores armour and the other
 * stacks Fracture for the whole board. Those are rules, and rules need a name
 * the simulation can read.
 *
 * Named traits rather than free-form scripting, for the same reason enemy
 * behaviours are: the list is short, every entry is something a system already
 * knows how to do, and when a branch cannot be expressed the answer is to add
 * one here rather than a special case wherever it happened to be needed.
 */
export const TOWER_PERKS = [
  /** Sniper Nest: ignores a *fraction* of armour, where pierce is flat. */
  'pierce_fraction',
  /** Pyroclast Vent: hits harder into a status it did not apply itself. */
  'bonus_vs_status',
  /** Rime Spire: its Chill eats armour and feeds the Shatter bonus. */
  'chill_sunders',
  /** Storm Pylon: an enemy at the Charge cap is stunned and discharged. */
  'discharge_at_cap',
  /** Pyroclast Vent, Plague Vat: a corpse passes its status to its neighbours. */
  'spread_on_death',
  /** Firestorm Cannon, Arc Net: leaves ground behind where it struck. */
  'leaves_ground',
  /** Glacier Heart: a periodic Freeze on everything in reach. */
  'freeze_pulse',
  /** Plasma Lance: the beam does not stop at the first enemy. */
  'piercing',
  /** Void Obelisk: drags what it hits towards itself. */
  'pulls',
  /** Prism Tower: borrows the damage types of its neighbours. */
  'refracts',
  /** Gilded Alembic: every kill on the board pays more, not just its own. */
  'global_gold',
  /** Bulwark Order: returns a share of the melee damage its soldiers take. */
  'reflects',
  /** Ranger Lodge: what it shoots takes more from everything. */
  'marks_target',
] as const;
export const TowerPerkSchema = z.enum(TOWER_PERKS);
export type TowerPerkId = z.infer<typeof TowerPerkSchema>;

/**
 * Per-perk numbers. Only the fields a given perk reads are meaningful.
 *
 * Every one of these is a balance number, so it lives here rather than in
 * `src/` — the simulator sweeps them and a retune must not need a rebuild.
 */
export const TowerPerkConfigSchema = z
  .object({
    /** pierce_fraction: share of armour ignored, 0–1. */
    pierceFraction: z.number().min(0).max(1).optional(),
    /** bonus_vs_status: which status, and the extra damage against it. */
    bonusVsStatus: StatusApplicationSchema.shape.status.optional(),
    bonusVsStatusMultiplier: Positive.optional(),
    /** chill_sunders: armour removed per stack of Chill on the target. */
    armourPerChillStack: NonNegative.optional(),
    /** spread_on_death: stacks handed to each neighbour, and how far. */
    spreadStacks: z.number().int().positive().optional(),
    spreadRadiusTiles: Tiles.optional(),
    /** leaves_ground: the patch a shot leaves where it lands. */
    groundSeconds: NonNegative.optional(),
    groundRadiusTiles: Tiles.optional(),
    groundDamagePerSecond: NonNegative.optional(),
    /** freeze_pulse: how often, in seconds. */
    freezePulseSeconds: NonNegative.optional(),
    /** pulls: pixels of path distance dragged back per hit. */
    pullTiles: Tiles.optional(),
    /** refracts: how far it looks for neighbours to borrow from. */
    refractRadiusTiles: Tiles.optional(),
    /** refracts: damage added per distinct borrowed type, as a fraction. */
    refractBonusPerType: NonNegative.optional(),
    /** global_gold: extra fraction on every bounty the board earns. */
    globalGoldFraction: NonNegative.optional(),
    /** reflects: share of melee damage returned to the attacker. */
    reflectFraction: z.number().min(0).max(1).optional(),
    /** marks_target: extra damage everything deals to the marked enemy. */
    markMultiplier: Positive.optional(),
    markSeconds: NonNegative.optional(),
  })
  .default({});

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
  firingMode: FiringModeSchema.default('projectile'),
  /** Tiles per second for projectile and ballistic shots. */
  projectileSpeedTiles: Positive.default(18),
  /** Half-angle of a cone, in degrees. Cone mode only. */
  coneHalfAngleDegrees: z.number().min(1).max(180).default(30),
  /** Extra enemies a chain jumps to, and the damage kept per jump. */
  chainTargets: z.number().int().nonnegative().default(0),
  chainFalloff: z.number().min(0).max(1).default(0.75),
  statusApplied: StatusApplicationSchema.optional(),
  /** Flat armour ignored before the damage formula runs. */
  armourPierce: NonNegative.default(0),
  /** Extra gold per kill, for economy towers. */
  bonusGoldPerKill: NonNegative.default(0),
  /** Flavour: what the perk reads as in the tower panel. */
  perkKeys: z.array(LocaleKeySchema).default([]),
  /** Mechanics: what the perk actually does (#32). */
  perks: z.array(TowerPerkSchema).default([]),
  perkConfig: TowerPerkConfigSchema,
  /** Soldiers this tier fields. Absent for every tower that shoots. */
  garrison: GarrisonSchema.optional(),
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
export type Garrison = z.infer<typeof GarrisonSchema>;
