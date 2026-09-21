import { z } from 'zod';
import {
  DamageTypeSchema,
  IdSchema,
  LeyNodeTypeSchema,
  LocaleKeySchema,
  NonNegative,
  PointSchema,
  Positive,
  Seconds,
  StageIdSchema,
  StatusApplicationSchema,
  Tiles,
} from './common.js';

/** A spawn group within a wave. Groups run in parallel with their own delays. */
export const WaveGroupSchema = z.object({
  /** Enemy id. Validated against the enemy registry by content-lint and codegen. */
  enemy: IdSchema,
  count: z.number().int().positive(),
  /** Seconds between spawns within this group. */
  intervalSeconds: Seconds.default(0),
  /** Seconds after the wave starts before this group begins. */
  delaySeconds: Seconds.default(0),
  spawnPoint: z.number().int().nonnegative(),
});

export const WaveSchema = z.object({
  /** Seconds before the wave auto-starts if the player does not call it. */
  autoStartDelaySeconds: Seconds,
  /** Gold awarded once every enemy from this wave is gone. */
  clearBonus: z.number().int().nonnegative().default(0),
  groups: z.array(WaveGroupSchema).min(1),
});

/** A polyline enemies walk. Baked into an arc-length table at load. */
export const PathSchema = z.object({
  id: z.number().int().nonnegative(),
  points: z.array(PointSchema).min(2),
  /** Optional mid-path branches, chosen deterministically at spawn. */
  branches: z
    .array(
      z.object({
        atDistanceTiles: Tiles,
        targetPathId: z.number().int().nonnegative(),
        weight: Positive,
      }),
    )
    .default([]),
  /** Range along the path where burrowing enemies are untargetable. */
  burrowSegment: z.object({ fromTiles: Tiles, toTiles: Tiles }).optional(),
});

export const BuildPlotSchema = z.object({
  id: z.number().int().nonnegative(),
  position: PointSchema,
  /** Ley nodes grant a bonus to whatever is built on them. 2-4 per map. */
  leyNode: LeyNodeTypeSchema.optional(),
});

export const SpawnPointSchema = z.object({
  id: z.number().int().nonnegative(),
  position: PointSchema,
  /** Ground enemies from this spawn follow this path. */
  pathId: z.number().int().nonnegative(),
});

/**
 * A one-shot, gold-cost map lever. One per map, for identity.
 *
 * Every lever resolves to a patch of ground with a payload, which is why the
 * three named effects need no code of their own: a collapsed bridge is ground
 * that blocks, a dropped boulder is ground that hits once and vanishes, an
 * ignited vent is ground that burns. The enum stays because the art and the
 * sound differ even where the mechanics do not.
 */
export const InteractableSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  position: PointSchema,
  cost: z.number().int().nonnegative(),
  effect: z.enum(['collapse_bridge', 'drop_boulder', 'ignite_vent']),
  radiusTiles: Tiles.default(2),
  /** How long the ground stays changed. A boulder's is a moment. */
  durationSeconds: Seconds.default(1),
  /** Total damage dealt per second to whatever is standing in it. */
  damagePerSecond: NonNegative.default(0),
  damageType: DamageTypeSchema.default('kinetic'),
  /** Seals the path while it lasts, e.g. a collapsed bridge. */
  blocks: z.boolean().default(false),
  statusApplied: StatusApplicationSchema.optional(),
});

/**
 * The win rate this stage is authored for, as fractions of runs won.
 *
 * The balance simulator (#35) reports every stage against its own band rather
 * than against one global number, because a tutorial stage and a region finale
 * are not supposed to be equally survivable. CI fails a change that moves a
 * stage out of its band, which is what stops a quiet tuning edit from making
 * stage four unwinnable three months before anyone plays it.
 */
export const BalanceTargetSchema = z
  .object({
    minWinRate: z.number().min(0).max(1).default(0.5),
    maxWinRate: z.number().min(0).max(1).default(1),
  })
  .refine((band) => band.minWinRate <= band.maxWinRate, {
    message: 'minWinRate must not exceed maxWinRate',
  });

export const StageSchema = z.object({
  id: StageIdSchema,
  nameKey: LocaleKeySchema,
  region: z.number().int().positive(),
  /** Logical map size in tiles; plots and paths must fall inside it. */
  widthTiles: Positive,
  heightTiles: Positive,
  startingGold: z.number().int().nonnegative(),
  lives: z.number().int().positive(),
  core: PointSchema,
  paths: z.array(PathSchema).min(1),
  spawnPoints: z.array(SpawnPointSchema).min(1),
  plots: z.array(BuildPlotSchema).min(1),
  /**
   * The glowing seams ley nodes sit on, as polylines in tiles.
   *
   * Purely something to look at — the bonus is the plot's, not the seam's —
   * but without them a ley plot is an unexplained coloured diamond. The seam is
   * what says *why* this plot is different, and the fiction the whole mechanic
   * hangs on (docs/GAME_DESIGN.md §5). Authored rather than derived from the
   * nodes, because where the Aether runs is a map-design decision.
   */
  leySeams: z.array(z.array(PointSchema).min(2)).default([]),
  waves: z.array(WaveSchema).min(1),
  interactable: InteractableSchema.optional(),
  /** Minimum spacing between plots, in tiles. Enforced by content-lint. */
  minPlotSpacingTiles: NonNegative.default(1),
  /** Win-rate band the balance simulator holds this stage to. */
  balance: BalanceTargetSchema.default({ minWinRate: 0.5, maxWinRate: 1 }),
});

export type StageDefinition = z.infer<typeof StageSchema>;
export type InteractableDefinition = z.infer<typeof InteractableSchema>;
export type BalanceTarget = z.infer<typeof BalanceTargetSchema>;
export type WaveDefinition = z.infer<typeof WaveSchema>;
