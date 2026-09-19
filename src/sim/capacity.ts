/**
 * Entity pool sizes.
 *
 * Pools are preallocated, so these are the hard ceilings the simulation runs
 * against — exceeding one drops the entity rather than growing the array,
 * because a mid-wave reallocation is exactly the GC pause the whole
 * structure-of-arrays design exists to avoid.
 *
 * Sized from the worst case in docs/TECH_DESIGN.md §14.1 (300 enemies, 400
 * projectiles, 60 towers) with headroom, since a stage that briefly exceeds its
 * budget should look slow rather than start deleting enemies.
 */
export const MAX_ENEMIES = 512;
export const MAX_PROJECTILES = 768;
export const MAX_TOWERS = 96;
export const MAX_SOLDIERS = 64;
export const MAX_GROUND_EFFECTS = 64;

/**
 * Waves that can be in flight at once.
 *
 * Calling early stacks waves deliberately — it is the game's main risk/reward
 * dial — so more than one runs at a time. Four is far beyond what is survivable.
 */
export const MAX_ACTIVE_WAVES = 4;

/** Parallel spawn groups within one wave. */
export const MAX_GROUPS_PER_WAVE = 8;

/** Commands queued between two ticks. A frame cannot produce many. */
export const MAX_COMMANDS_PER_TICK = 64;

/**
 * Events emitted in one tick. A single Aether Siphon can kill most of a wave at
 * once, so this is sized for the worst burst rather than the average.
 */
export const MAX_EVENTS_PER_TICK = 4096;

/** Damage entries queued in one tick, resolved together in step 11. */
export const MAX_DAMAGE_PER_TICK = 2048;

/** Result buffer for one spatial query. Larger than any plausible pack. */
export const MAX_QUERY_RESULTS = 512;
