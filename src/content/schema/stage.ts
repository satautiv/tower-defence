import { z } from 'zod';
import {
  IdSchema,
  LeyNodeTypeSchema,
  LocaleKeySchema,
  NonNegative,
  PointSchema,
  Positive,
  Seconds,
  StageIdSchema,
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

/** A one-shot, gold-cost map lever. One per map, for identity. */
export const InteractableSchema = z.object({
  id: IdSchema,
  nameKey: LocaleKeySchema,
  position: PointSchema,
  cost: z.number().int().nonnegative(),
  effect: z.enum(['collapse_bridge', 'drop_boulder', 'ignite_vent']),
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
  waves: z.array(WaveSchema).min(1),
  interactable: InteractableSchema.optional(),
  /** Minimum spacing between plots, in tiles. Enforced by content-lint. */
  minPlotSpacingTiles: NonNegative.default(1),
});

export type StageDefinition = z.infer<typeof StageSchema>;
export type WaveDefinition = z.infer<typeof WaveSchema>;
