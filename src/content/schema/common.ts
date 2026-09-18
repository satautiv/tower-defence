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
 * so a new Warden Power or hero ability is a data change (docs/TECH_DESIGN.md
 * §7.8). The payload is left loose here deliberately: the effect system lands
 * in #26, and pinning each effect's arguments now would mean guessing them.
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
export const EffectSchema = z.object({
  kind: z.enum(EFFECT_KINDS),
  params: z.record(z.string(), z.unknown()).default({}),
});
