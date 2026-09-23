import { MAX_COMMANDS_PER_TICK, MAX_DAMAGE_PER_TICK, MAX_EVENTS_PER_TICK } from '@sim/index';
import type { EntityPool, World, StagePhase } from '@sim/index';

/**
 * What the world is holding, counted (#41).
 *
 * Every number here answers the same question: is anything about to hit a
 * ceiling? The pools never grow — `alloc` returns -1 when full and the entity
 * simply does not spawn — and the spatial hash and the event buffer both drop
 * silently past capacity. Those are the failures that look like balance
 * problems from the outside ("the wave got easier at three hundred enemies"),
 * so the overlay shows the capacity beside the count rather than the count
 * alone.
 *
 * Pure, and reads nothing but the world: the panel polls it at 10Hz off the
 * frame, and a test can assert on it without a renderer.
 */

export interface PoolStat {
  readonly name: string;
  readonly live: number;
  /** One past the highest slot ever used, which is what iteration costs. */
  readonly watermark: number;
  readonly capacity: number;
  /** True once the pool has refused an allocation this stage. */
  readonly full: boolean;
}

export interface HashStat {
  readonly name: string;
  readonly size: number;
  readonly cells: number;
  readonly occupied: number;
  /** The worst bucket: a query that lands on it pays for every entity in it. */
  readonly largestCell: number;
  readonly overflowed: boolean;
}

export interface BufferStat {
  readonly name: string;
  /** Records written this frame, sampled before the consumers clear it. */
  readonly count: number;
  /** The most written in any one frame this stage. */
  readonly peak: number;
  readonly capacity: number;
  /** Records refused because the buffer was full. Non-zero is a real problem. */
  readonly dropped: number;
}

export interface DevStats {
  readonly tick: number;
  readonly phase: StagePhase;
  readonly wave: number;
  readonly pools: readonly PoolStat[];
  readonly hashes: readonly HashStat[];
  readonly buffers: readonly BufferStat[];
}

/**
 * Peaks a single reading cannot show, and where each has to be taken.
 *
 * Each of the three per-frame buffers is emptied by the time anything outside
 * the frame could look at it, and they are emptied at three *different*
 * moments — which is why this is two functions and one getter rather than one
 * sample call. Getting it wrong is silent: the first draft sampled all three
 * after the tick and reported a game that had never issued a command and never
 * dealt any damage.
 */
export interface BufferPeaks {
  events: number;
  commands: number;
}

export function freshPeaks(): BufferPeaks {
  return { events: 0, commands: 0 };
}

/**
 * The command queue, which `drainCommandQueue` empties at step 0 of the tick.
 *
 * So this has to run in the loop's pre-tick hook — the same moment the replay
 * recorder reads it, and for the same reason.
 */
export function sampleCommands(world: World, into: BufferPeaks): void {
  if (world.commands.count > into.commands) into.commands = world.commands.count;
}

/**
 * The event buffer, which the session clears once every consumer has drained
 * it. Sampled after the tick and before that clear.
 *
 * The damage queue is not here, and cannot be: it is filled and drained inside
 * a single tick, so there is no moment outside one where it holds anything.
 * `DamageQueue` keeps its own high-water mark instead.
 */
export function samplePeaks(world: World, into: BufferPeaks): void {
  if (world.events.count > into.events) into.events = world.events.count;
}

function poolStat(name: string, pool: EntityPool): PoolStat {
  return {
    name,
    live: pool.count,
    watermark: pool.watermark,
    capacity: pool.capacity,
    full: pool.count >= pool.capacity,
  };
}

export function readDevStats(world: World, peaks: BufferPeaks): DevStats {
  const ground = world.groundIndex.stats();
  const air = world.airIndex.stats();

  return {
    tick: world.tick,
    phase: world.phase,
    wave: world.wave.index,
    pools: [
      poolStat('enemies', world.enemies),
      poolStat('towers', world.towers),
      poolStat('projectiles', world.projectiles),
      poolStat('soldiers', world.soldiers),
      poolStat('ground fx', world.groundEffects),
    ],
    hashes: [
      {
        name: 'ground',
        size: world.groundIndex.size,
        cells: ground.cells,
        occupied: ground.occupied,
        largestCell: ground.largestCell,
        overflowed: world.groundIndex.didOverflow,
      },
      {
        name: 'air',
        size: world.airIndex.size,
        cells: air.cells,
        occupied: air.occupied,
        largestCell: air.largestCell,
        overflowed: world.airIndex.didOverflow,
      },
    ],
    buffers: [
      {
        name: 'events',
        count: world.events.count,
        peak: peaks.events,
        capacity: MAX_EVENTS_PER_TICK,
        dropped: world.events.dropped,
      },
      {
        name: 'commands',
        count: world.commands.count,
        peak: peaks.commands,
        capacity: MAX_COMMANDS_PER_TICK,
        dropped: world.commands.dropped,
      },
      {
        name: 'damage',
        count: world.damage.count,
        peak: world.damage.highWater,
        capacity: MAX_DAMAGE_PER_TICK,
        dropped: world.damage.dropped,
      },
    ],
  };
}
