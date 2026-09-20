import type { World } from './world.js';

/**
 * A fingerprint of the entire world state.
 *
 * Exists for one job: proving that the same seed and the same commands produce
 * the same run. That test is the foundation everything else rests on — replays,
 * bug reports reduced to a seed, and a balance simulator whose results mean
 * anything. Comparing hashes is how "identical" gets checked without diffing
 * tens of thousands of numbers.
 *
 * Deliberately strict. It hashes every slot of every pool, including slots that
 * are currently dead, because with identical inputs there should be no
 * difference anywhere at all. A hash that ignored dead slots would hide a real
 * nondeterminism in allocation order.
 */

const FNV_PRIME = 0x01000193;
const FNV_OFFSET_A = 0x811c9dc5;
/* A second, independently seeded pass. 32 bits is not much against a 70KB
   input; two of them make an accidental collision implausible. */
const FNV_OFFSET_B = 0x9e3779b1;

const scratch = new DataView(new ArrayBuffer(8));

function foldBytes(hash: number, bytes: Uint8Array): number {
  let h = hash;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] as number;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function foldView(hash: number, view: ArrayBufferView): number {
  return foldBytes(hash, new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/** Folds a number through its exact bit pattern, so -0 and 0.1 both survive. */
function foldNumber(hash: number, value: number): number {
  scratch.setFloat64(0, value);
  return foldBytes(hash, new Uint8Array(scratch.buffer));
}

/**
 * Every typed array a pool owns, found by reflection rather than a hand-written
 * list — a list is something a new field can be left off, and the failure would
 * be a determinism test that quietly stops checking part of the state.
 *
 * Sorted by key so the result cannot depend on property enumeration order.
 */
function foldPool(hash: number, pool: object): number {
  let h = hash;
  for (const key of Object.keys(pool).sort()) {
    const value = (pool as Record<string, unknown>)[key];
    if (ArrayBuffer.isView(value)) h = foldView(h, value);
  }
  return h;
}

function foldWorld(hash: number, world: World): number {
  let h = hash;

  h = foldNumber(h, world.tick);
  h = foldNumber(h, world.phase);
  h = foldNumber(h, world.speed);
  h = foldNumber(h, world.reactionPower);
  h = foldNumber(h, world.rng.getState());

  h = foldNumber(h, world.resources.gold);
  h = foldNumber(h, world.resources.aether);
  h = foldNumber(h, world.resources.lives);

  h = foldNumber(h, world.wave.index);
  h = foldNumber(h, world.wave.active);
  h = foldNumber(h, world.wave.autoStartIn);
  h = foldNumber(h, world.wave.cleared);
  h = foldNumber(h, world.interactableUsed ? 1 : 0);

  for (const value of Object.values(world.stats)) h = foldNumber(h, value);
  for (const value of Object.values(world.lastBuild)) h = foldNumber(h, value);

  /* The wave runner is mutable state like any pool; leaving it out would let
     two runs differ in spawn progress and still hash the same. */
  h = foldNumber(h, world.waveRunner.activeCount);
  h = foldPool(h, world.waveRunner);

  for (const pool of [
    world.enemies,
    world.towers,
    world.projectiles,
    world.soldiers,
    world.groundEffects,
  ]) {
    /* Slot counters are not typed arrays, so they are folded explicitly. */
    h = foldNumber(h, pool.count);
    h = foldNumber(h, pool.watermark);
    h = foldPool(h, pool);
  }

  return h >>> 0;
}

/**
 * Sixteen hex characters. Two independent folds, so a match is strong evidence
 * the states are identical rather than merely similar.
 *
 * Not included: `EnemyPool.meta`, which holds object-shaped cold data. It is
 * empty today; whatever fills it must extend this.
 */
export function hashWorld(world: World): string {
  const a = foldWorld(FNV_OFFSET_A, world);
  const b = foldWorld(FNV_OFFSET_B, world);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
