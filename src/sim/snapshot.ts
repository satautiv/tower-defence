/**
 * Serialising a world, and putting it back (#39).
 *
 * This is what lets a phone call not destroy a seven-minute run — on Android
 * that is not an edge case, it is Tuesday (docs/TECH_DESIGN.md §12.1).
 *
 * What is saved and what is not follows one rule: **state the simulation owns
 * is saved, state it can rebuild is not.** The ruleset is rebuilt from the
 * stage and the registry, because it is the same numbers every time and saving
 * them would mean a save that silently contradicts the content it was authored
 * against. The spatial indexes are rebuilt too — they are recomputed from
 * scratch every tick anyway, so a saved copy could only ever be stale.
 *
 * The bar this has to clear is not "the world looks the same". It is that the
 * *rest of the run* is the same: a restored world advanced a thousand ticks
 * must reach the state the original would have. That is a stricter thing than
 * matching the determinism hash, because the hash deliberately does not fold
 * `nextId` or the slot free list, and both steer what happens next.
 */

import { createReader, createWriter } from '@core/serialise';
import type { BagReader, BagWriter, SavedBag } from '@core/serialise';
import { SaveBagError } from '@core/serialise';
import type { World } from './world.js';
import type { StagePhase } from './world.js';

/** Bumped when the shape changes in a way an older save cannot satisfy. */
export const SNAPSHOT_VERSION = 1;

export interface WorldSnapshot {
  /** Which stage this is a run of. A snapshot is meaningless against another. */
  readonly stageId: string;
  /**
   * The seed the run started from.
   *
   * Saved even though the RNG's current state is saved too: a mismatch means
   * this snapshot belongs to a different run of the same stage, and restoring
   * it would be silently wrong rather than loudly wrong.
   */
  readonly seed: number;
  /** Stage the player's progress had reached, so the roster resolves the same. */
  readonly progressStageId: string | undefined;
  /**
   * Which mode the run was started on (#48).
   *
   * Carried for the same reason as `progressStageId` and the seed: the world
   * has to be *built* the same way before the bytes are written into it, and
   * nothing in the bag says whether these enemies were scaled for Veteran or
   * had their ward tripled by a Heroic challenge. No tick reads it.
   */
  readonly modeId: string | undefined;
  readonly bag: SavedBag;
}

/* Scalars live on the World itself rather than in a pool, so they are listed.
   A list is acceptable here and not for the pools: these are named properties
   of one class that changes rarely, and the guard test checks the list against
   what the determinism hash folds. */
function captureScalars(world: World, write: BagWriter): void {
  write.num('tick', world.tick);
  write.num('phase', world.phase);
  write.num('speed', world.speed);
  write.num('reactionPower', world.reactionPower);
  write.num('rng', world.rng.getState());

  write.num('gold', world.resources.gold);
  write.num('aether', world.resources.aether);
  write.num('lives', world.resources.lives);

  write.num('wave.index', world.wave.index);
  write.num('wave.active', world.wave.active);
  write.num('wave.autoStartIn', world.wave.autoStartIn);
  write.num('wave.cleared', world.wave.cleared);

  write.num('interactableUsed', world.interactableUsed ? 1 : 0);
  write.view('powerReadyTick', world.powerReadyTick);

  write.num('heroSlot', world.heroSlot);
  write.num('heroRespawnIn', world.heroRespawnIn);
  write.num('heroOrderX', world.heroOrderX);
  write.num('heroOrderY', world.heroOrderY);
  write.num('heroOrdered', world.heroOrdered ? 1 : 0);
  write.view('heroAbilityReadyTick', world.heroAbilityReadyTick);

  for (const [key, value] of Object.entries(world.stats)) write.num(`stats.${key}`, value);
  for (const [key, value] of Object.entries(world.lastBuild)) write.num(`lastBuild.${key}`, value);

  write.num('waveRunner.activeCount', world.waveRunner.activeCount);
  for (const key of Object.keys(world.waveRunner).sort()) {
    const value = (world.waveRunner as unknown as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(value)) write.view(`waveRunner.${key}`, value);
  }
}

function restoreScalars(world: World, read: BagReader): void {
  world.tick = read.num('tick');
  world.phase = read.num('phase') as StagePhase;
  world.speed = read.num('speed');
  world.reactionPower = read.num('reactionPower');
  world.rng.setState(read.num('rng'));

  world.resources.gold = read.num('gold');
  world.resources.aether = read.num('aether');
  world.resources.lives = read.num('lives');

  world.wave.index = read.num('wave.index');
  world.wave.active = read.num('wave.active');
  world.wave.autoStartIn = read.num('wave.autoStartIn');
  world.wave.cleared = read.num('wave.cleared');

  world.interactableUsed = read.num('interactableUsed') !== 0;
  read.into('powerReadyTick', world.powerReadyTick);

  world.heroSlot = read.num('heroSlot');
  world.heroRespawnIn = read.num('heroRespawnIn');
  world.heroOrderX = read.num('heroOrderX');
  world.heroOrderY = read.num('heroOrderY');
  world.heroOrdered = read.num('heroOrdered') !== 0;
  read.into('heroAbilityReadyTick', world.heroAbilityReadyTick);

  for (const key of Object.keys(world.stats)) {
    (world.stats as unknown as Record<string, number>)[key] = read.num(`stats.${key}`);
  }
  for (const key of Object.keys(world.lastBuild)) {
    (world.lastBuild as unknown as Record<string, number>)[key] = read.num(`lastBuild.${key}`);
  }

  for (const key of Object.keys(world.waveRunner).sort()) {
    const value = (world.waveRunner as unknown as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(value)) read.into(`waveRunner.${key}`, value);
  }
}

/** Every pool, with the prefix its keys are saved under. */
function pools(world: World): ReadonlyArray<readonly [string, World['enemies'] | World['towers']]> {
  return [
    ['enemies.', world.enemies],
    ['towers.', world.towers],
    ['projectiles.', world.projectiles],
    ['soldiers.', world.soldiers],
    ['groundEffects.', world.groundEffects],
  ] as ReadonlyArray<readonly [string, World['enemies'] | World['towers']]>;
}

/**
 * Captures a world between ticks.
 *
 * Between, not during: commands are applied at a tick boundary and the damage
 * queue, death list and event buffer are all drained within a single tick, so
 * at a boundary they are empty and there is nothing there to save. Capturing
 * mid-tick would need all three, and would also be saving a world no tick
 * boundary ever produced.
 */
export function captureWorld(
  world: World,
  stageId: string,
  progressStageId?: string,
  modeId?: string,
): WorldSnapshot {
  const { writer, bag } = createWriter();
  captureScalars(world, writer);
  for (const [prefix, pool] of pools(world)) pool.capture(writer, prefix);
  return { stageId, seed: world.config.seed, progressStageId, modeId, bag };
}

/**
 * Writes a snapshot into a world built for the same stage and seed.
 *
 * The world is rebuilt by the caller rather than constructed here, because
 * building one needs the content registry and `sim/` does not load content.
 *
 * Refuses a snapshot from a different stage or a different seed. Both would
 * restore without complaint — the pools are the same shape whatever stage they
 * hold — and produce a run whose enemies walk paths that are not there.
 */
export function restoreWorld(world: World, snapshot: WorldSnapshot, stageId: string): void {
  if (snapshot.stageId !== stageId) {
    throw new SaveBagError('stageId', `snapshot is of stage ${snapshot.stageId}, not ${stageId}`);
  }
  if (snapshot.seed !== world.config.seed) {
    throw new SaveBagError(
      'seed',
      `snapshot is of seed ${snapshot.seed}, not ${world.config.seed}`,
    );
  }

  const read = createReader(snapshot.bag);

  /* Cleared first so anything the snapshot does not mention is zero rather than
     whatever this world happened to hold. Restoring over a dirty world would
     make a load depend on what was played before it. */
  world.reset();

  restoreScalars(world, read);
  for (const [prefix, pool] of pools(world)) pool.restore(read, prefix);

  /* The indexes are derived state, rebuilt at step 7 of every tick. Populating
     them here would be guessing at what the next tick is about to overwrite. */
}

/** The keys a capture writes, so a test can prove nothing escaped it. */
export function snapshotKeys(world: World): string[] {
  const keys: string[] = [];
  const probe: BagWriter = { num: (key) => keys.push(key), view: (key) => keys.push(key) };
  captureScalars(world, probe);
  for (const [prefix, pool] of pools(world)) keys.push(...pool.saveKeys(prefix));
  return keys;
}
