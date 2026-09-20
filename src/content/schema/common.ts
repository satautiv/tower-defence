import { z } from 'zod';

/**
 * Primitives shared across every content schema.
 *
 * These enums are the vocabulary the whole game is described in. Adding a
 * damage type or status here is a deliberate act with consequences across
 * towers, enemies, reactions and VFX — which is exactly why they live in one
 * place rather than being restated as loose strings per file.
 */

/** Lower snake_case. Ids appear in generated TypeScript unions, so they must be identifier-safe. */
export const IdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, 'ids must be lower snake_case and start with a letter');

/** Stage ids are `region-index`, e.g. "1-1". */
export const StageIdSchema = z.string().regex(/^\d+-\d+$/, 'stage ids look like "1-1"');

export const DAMAGE_TYPES = ['kinetic', 'pyro', 'cryo', 'volt', 'toxic', 'arcane', 'true'] as const;
export const DamageTypeSchema = z.enum(DAMAGE_TYPES);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const STATUS_IDS = [
  'scorch',
  'chill',
  'freeze',
  'charge',
  'corrode',
  'unravel',
  'fracture',
] as const;
export const StatusIdSchema = z.enum(STATUS_IDS);
export type StatusId = z.infer<typeof StatusIdSchema>;

/**
 * Which status each damage type is allowed to apply on hit.
 *
 * Kinetic produces fracture — the physical-only mark that does not react, so
 * pure-physical builds still have a scaling lane. True damage applies nothing.
 * Freeze is absent because it is a derived state: it comes from chill reaching
 * max stacks, never directly from a hit. content-lint uses this to reject a
 * tower claiming a status its damage type cannot produce.
 */
export const STATUS_BY_DAMAGE_TYPE: Readonly<Partial<Record<DamageType, StatusId>>> = {
  kinetic: 'fracture',
  pyro: 'scorch',
  cryo: 'chill',
  volt: 'charge',
  toxic: 'corrode',
  arcane: 'unravel',
};

export const TargetClassSchema = z.enum(['ground', 'air', 'both']);
export type TargetClass = z.infer<typeof TargetClassSchema>;

export const LEY_NODE_TYPES = ['flux', 'depth', 'resonance', 'surge'] as const;
export const LeyNodeTypeSchema = z.enum(LEY_NODE_TYPES);
export type LeyNodeType = z.infer<typeof LeyNodeTypeSchema>;

export const TOWER_FAMILIES = ['marksman', 'ordnance', 'arcane', 'control'] as const;
export const TowerFamilySchema = z.enum(TOWER_FAMILIES);

export const DIFFICULTIES = ['normal', 'veteran', 'impossible'] as const;
export const DifficultySchema = z.enum(DIFFICULTIES);

/** World position in tiles. */
export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof PointSchema>;

export const Positive = z.number().positive();
export const NonNegative = z.number().nonnegative();
/** Tiles. Ranges, radii and blast sizes are all expressed this way. */
export const Tiles = z.number().nonnegative();
export const Seconds = z.number().nonnegative();

/**
 * A localisation key. Never a display string — every player-facing word goes
 * through i18n, so content files carry keys and the language files carry text.
 */
export const LocaleKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_.]*$/, 'locale keys are dot-separated lower snake_case');

/** Applying `stacks` of a status on hit. */
export const StatusApplicationSchema = z.object({
  status: StatusIdSchema,
  stacks: z.number().int().positive(),
});

/**
 * Ability effects are composed from primitives rather than coded per ability,
 * so a new Warden Power, tower capstone or hero ability is a data change
 * (docs/TECH_DESIGN.md §7.8).
 *
 * A discriminated union rather than a loose parameter bag: the acceptance
 * criterion for #26 is that all five powers, all sixteen tower capstones and
 * all nine hero abilities compose from **only** these primitives, and that is
 * a claim a schema can enforce. An untyped bag would let a typo pass
 * validation and fail silently at cast time, in a stage, months later.
 *
 * Adding a primitive is a deliberate act: if an ability cannot be expressed,
 * the answer is a new member here, never a special case in the executor.
 */
export const EFFECT_KINDS = [
  'damage_in_radius',
  'apply_status_in_radius',
  'create_ground_effect',
  'modify_stat',
  'force_reactions',
  'block_path',
  'taunt_in_radius',
  'spawn_entity',
] as const;

const Radius = z.object({ radiusTiles: Tiles });

/**
 * Everything an ability is allowed to change.
 *
 * A closed list rather than a free string, because "which stats can an ability
 * touch" is a design question and this is where it is answered. A capstone
 * that needs something not here is a conversation, not a typo.
 */
export const MODIFIABLE_STATS = [
  'damage',
  'fireRate',
  'armour',
  'ward',
  'defence',
  'speed',
  'chillDecay',
  'goldPerKill',
  'reactionPower',
  'reactionCooldown',
  'towerDamage',
] as const;

export const EffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('damage_in_radius'),
    params: Radius.extend({
      damage: NonNegative.default(0),
      /** Spread over this long instead of landing at once, when set. */
      durationSeconds: Seconds.default(0),
      damageType: DamageTypeSchema.default('arcane'),
    }),
  }),
  z.object({
    kind: z.literal('apply_status_in_radius'),
    params: Radius.extend({
      status: StatusIdSchema,
      stacks: z.number().int().positive(),
    }),
  }),
  z.object({
    kind: z.literal('create_ground_effect'),
    params: Radius.extend({
      durationSeconds: Seconds,
      intervalSeconds: Positive.default(1),
      damagePerSecond: NonNegative.default(0),
      damageType: DamageTypeSchema.default('arcane'),
      status: StatusIdSchema.optional(),
      stacks: z.number().int().positive().default(1),
      /** Movement multiplier inside. 0.25 is a 75% slow. */
      slowMultiplier: z.number().min(0).max(1).default(1),
      blocks: z.boolean().default(false),
    }),
  }),
  z.object({
    kind: z.literal('modify_stat'),
    params: z.object({
      stat: z.enum(MODIFIABLE_STATS),
      /** Scales the stat. 1 leaves it alone. */
      multiplier: NonNegative.default(1),
      /** Added after the multiplier. Negative strips, e.g. -50 ward. */
      flat: z.number().default(0),
      durationSeconds: Seconds.default(0),
      /** 0 means the caster or the tower itself rather than an area. */
      radiusTiles: Tiles.default(0),
      /** Uses rather than seconds, for effects counted in kills. */
      charges: z.number().int().nonnegative().default(0),
    }),
  }),
  z.object({
    kind: z.literal('force_reactions'),
    params: Radius.extend({
      /** Aether Siphon's whole point: the per-enemy lockout does not apply. */
      ignoreCooldown: z.boolean().default(false),
    }),
  }),
  z.object({
    kind: z.literal('block_path'),
    params: Radius.extend({ durationSeconds: Seconds }),
  }),
  z.object({
    kind: z.literal('taunt_in_radius'),
    params: Radius.extend({ durationSeconds: Seconds }),
  }),
  z.object({
    kind: z.literal('spawn_entity'),
    params: z.object({
      entity: IdSchema,
      count: z.number().int().positive().default(1),
      seconds: Seconds.default(0),
    }),
  }),
]);

export type EffectDefinition = z.infer<typeof EffectSchema>;
