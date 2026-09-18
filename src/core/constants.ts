/**
 * Technical constants only. Balance numbers live in content/data as JSON and
 * never appear here (docs/TECH_DESIGN.md §8.1).
 */

/** The simulation's only notion of time. Render rate is independent of it. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const TICK_SECONDS = 1 / TICK_HZ;

/**
 * Upper bound on catch-up ticks in one frame. Without it, a long stall makes
 * each frame simulate more than the last and the loop never recovers.
 */
export const MAX_CATCHUP_STEPS = 5;

/** Longest frame delta the loop will honour; beyond this, time is discarded. */
export const MAX_FRAME_DELTA_MS = 250;

/** World units. Ranges and speeds in content data are expressed in tiles. */
export const TILE_SIZE = 64;

/** Design resolution. Everything is laid out here and fit-scaled to the canvas. */
export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;

/**
 * Spatial hash cell size, ~2 tiles — near the median tower range, which is what
 * minimises both cells scanned per query and entities per cell.
 */
export const SPATIAL_CELL_SIZE = TILE_SIZE * 2;

/** Selectable game speeds. Each multiplies ticks per frame, never delta time. */
export const GAME_SPEEDS = [1, 2, 3] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];
