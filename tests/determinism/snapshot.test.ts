import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import {
  advance,
  buildTower,
  callWave,
  captureWorld,
  createGroundEffect,
  createWorldForStage,
  hashWorld,
  plotInfo,
  restoreWorld,
  snapshotKeys,
} from '@sim/index';
import type { World, WorldSnapshot } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * #39's headline criterion: a mid-stage snapshot restores to a bit-identical
 * world state, verified with the determinism hash.
 *
 * The hash is necessary and not sufficient, which is why the tests here also
 * play on afterwards. `hashWorld` deliberately folds neither `nextId` nor the
 * slot allocator's free list, so a snapshot that dropped either would restore
 * to a matching fingerprint and then put the next enemy in a different slot.
 * Advancing both worlds is what catches that — a restored run has to *stay*
 * identical, not merely start that way.
 *
 * The fixture asserts its own richness before anything is measured against it.
 * The first draft of this file snapshotted stage 1-1 at tick 900 and passed
 * every assertion while holding zero live enemies, zero projectiles and an RNG
 * still sitting on its seed: four pools proven by an empty world. A snapshot
 * test on an empty world is a test that the word "empty" round-trips.
 */

const SEED = 20260922;
/* Late enough that waves overlap and the board cannot clear them, so enemies
   are alive in numbers at the moment of capture rather than killed on arrival. */
const STAGE = '1-6';
const OTHER_STAGE = '1-3';
/* Late enough, found by measurement, that waves overlap and the garrison is
   engaged. Projectiles are transient — airborne on about a ninth of all ticks —
   so the fixture steps on from here until one exists rather than naming a tick
   that happens to have one today. */
const BUSY_TICK = 11_600;
/* A shot is in flight within a second or two of this point, or the stage has
   changed enough that the fixture should fail rather than quietly go empty. */
const MAX_WAIT_FOR_A_SHOT = 600;

const registry = loadContent();

function freshWorld(stageId = STAGE): World {
  const stage = registry.stages.get(stageId);
  if (stage === undefined) throw new Error(`no stage ${stageId}`);
  return createWorldForStage(registry, stage, SEED, FULL_ROSTER);
}

function towerIdx(world: World, id: string): number {
  const index = world.rules.towers.ids.indexOf(id);
  if (index < 0) throw new Error(`no tower ${id}`);
  return index;
}

/**
 * A world with every pool holding something.
 *
 * Ground effects are laid directly rather than played into: at tier 1 nothing
 * lays them, and waiting for a tier-4 perk would make this fixture a test of
 * the upgrade path instead. The RNG is advanced by hand for the same reason —
 * Region 1 has no branching paths and no chance-based effects, so a whole stage
 * can be played without the generator moving once.
 */
function playedWorld(): World {
  const world = freshWorld();
  const plots = plotInfo(world);
  const loadout = ['wardens_barracks', 'flame_vent', 'alchemists_still', 'frost_cairn'];
  loadout.forEach((id, i) => {
    const plot = plots[i];
    if (plot !== undefined) buildTower(world.commands, plot.id, towerIdx(world, id));
  });
  callWave(world.commands);
  advance(world, BUSY_TICK);
  for (let i = 0; i < MAX_WAIT_FOR_A_SHOT && world.projectiles.count === 0; i++) {
    advance(world, 1);
  }

  createGroundEffect(world, {
    x: 12 * 64,
    y: 6 * 64,
    radiusTiles: 2,
    seconds: 30,
    damagePerSecond: 4,
    slowMultiplier: 0.5,
  });
  for (let i = 0; i < 7; i++) world.rng.next();

  return world;
}

/* Built once: the fixture is eleven thousand ticks, and every test below wants
   the same one. */
const original = playedWorld();
const originalHash = hashWorld(original);
const snapshot = captureWorld(original, STAGE);

function restored(from: WorldSnapshot = snapshot, stageId = STAGE): World {
  const world = freshWorld(stageId);
  restoreWorld(world, from, stageId);
  return world;
}

describe('the fixture is worth measuring against', () => {
  it('has every pool occupied and an RNG off its seed', () => {
    expect(original.enemies.count, 'live enemies').toBeGreaterThan(5);
    expect(original.projectiles.count, 'projectiles in flight').toBeGreaterThan(0);
    expect(original.soldiers.count, 'soldiers deployed').toBeGreaterThan(0);
    expect(original.groundEffects.count, 'ground effects').toBeGreaterThan(0);
    expect(original.towers.count, 'towers built').toBeGreaterThan(0);
    expect(original.rng.getState(), 'RNG moved off the seed').not.toBe(SEED);
    expect(original.wave.index, 'waves have run').toBeGreaterThan(0);
    expect(original.stats.enemiesKilled, 'kills recorded').toBeGreaterThan(0);
    expect(original.finished, 'still mid-stage').toBe(false);
  });
});

describe('a snapshot restores the world', () => {
  it('reproduces the hash exactly', () => {
    expect(hashWorld(restored())).toBe(originalHash);
  });

  /* The test that matters more than the one above. */
  it('carries on identically for a thousand further ticks', () => {
    const a = restored();
    const b = restored();
    advance(a, 1000);
    advance(b, 1000);
    expect(hashWorld(a)).toBe(hashWorld(b));
    /* And that those thousand ticks were not a no-op. */
    expect(hashWorld(a)).not.toBe(originalHash);
  });

  /* Entity ids come from the pool's private `nextId`, which the hash does not
     fold. A restore that reset it would hand the next spawn an id already in
     use, and nothing would notice until two entities collided. */
  it('gives the next spawned entity the id it would have had', () => {
    const world = restored();
    const mine = world.enemies.alloc();
    const theirs = original.enemies.alloc();
    expect(mine).toBe(theirs);
    expect(world.enemies.ids[mine]).toBe(original.enemies.ids[theirs]);
    /* Put the fixture back, since it is shared. */
    original.enemies.free(theirs);
    world.enemies.free(mine);
  });

  it('survives a JSON round trip, which is how it is actually stored', () => {
    const parsed = JSON.parse(JSON.stringify(snapshot)) as WorldSnapshot;
    expect(hashWorld(restored(parsed))).toBe(originalHash);
  });

  it('restores a world that was mid-build, before any wave', () => {
    const building = freshWorld();
    const plots = plotInfo(building);
    const plot = plots[0];
    if (plot !== undefined)
      buildTower(building.commands, plot.id, towerIdx(building, 'flame_vent'));
    advance(building, 30);

    expect(hashWorld(restored(captureWorld(building, STAGE)))).toBe(hashWorld(building));
  });

  /* Restoring into a world that has already been played must leave none of the
     previous run behind. */
  it('overwrites a world that had a different run in it', () => {
    const dirty = freshWorld();
    const plots = plotInfo(dirty);
    const plot = plots[3];
    if (plot !== undefined) buildTower(dirty.commands, plot.id, towerIdx(dirty, 'arcane_spire'));
    callWave(dirty.commands);
    advance(dirty, 1500);

    restoreWorld(dirty, snapshot, STAGE);
    expect(hashWorld(dirty)).toBe(originalHash);
  });
});

describe('a snapshot refuses what it cannot honestly restore', () => {
  it('refuses a snapshot of another stage', () => {
    expect(() => restored(snapshot, OTHER_STAGE)).toThrow(
      new RegExp(`stage ${STAGE}, not ${OTHER_STAGE}`),
    );
  });

  it('refuses a snapshot of another seed', () => {
    expect(() => restored({ ...snapshot, seed: SEED + 1 })).toThrow(/seed/);
  });

  it('refuses a snapshot missing a field', () => {
    const { ['enemies.hp']: _dropped, ...bag } = snapshot.bag;
    expect(() => restored({ ...snapshot, bag })).toThrow(/enemies\.hp/);
  });

  it('refuses a payload of the wrong size', () => {
    const bag = { ...snapshot.bag, 'enemies.hp': { bytes: 'AAAA', length: 3 } };
    expect(() => restored({ ...snapshot, bag })).toThrow(/enemies\.hp/);
  });

  it('refuses a payload that is not valid base64', () => {
    const saved = snapshot.bag['enemies.hp'] as { bytes: string; length: number };
    const bag = {
      ...snapshot.bag,
      'enemies.hp': { ...saved, bytes: '!'.repeat(saved.bytes.length) },
    };
    expect(() => restored({ ...snapshot, bag })).toThrow();
  });

  it('refuses a free list that points outside the pool', () => {
    const bag = { ...snapshot.bag, 'enemies.slots.highWater': 999_999 };
    expect(() => restored({ ...snapshot, bag })).toThrow(/highWater/);
  });

  it('refuses a scalar that is not a finite number', () => {
    const bag = { ...snapshot.bag, gold: Number.NaN };
    expect(() => restored({ ...snapshot, bag })).toThrow(/gold/);
  });
});

/**
 * The guard. A pool gaining a typed array is routine; a pool gaining one the
 * snapshot silently ignores is a save that restores a world short of a column,
 * with nothing to say so.
 *
 * Checked by the same reflection `hashWorld` uses, so the two cannot drift
 * apart: anything the fingerprint folds is something the snapshot must carry.
 */
describe('nothing escapes the snapshot', () => {
  const POOLS = ['enemies', 'towers', 'projectiles', 'soldiers', 'groundEffects'] as const;

  it('saves every typed array on every pool', () => {
    const world = freshWorld();
    const saved = new Set(snapshotKeys(world));

    for (const name of POOLS) {
      const pool = world[name] as unknown as Record<string, unknown>;
      for (const key of Object.keys(pool)) {
        if (!ArrayBuffer.isView(pool[key])) continue;
        expect(saved.has(`${name}.${key}`), `${name}.${key} is not saved`).toBe(true);
      }
    }
  });

  it('saves the private bookkeeping the hash does not fold', () => {
    const saved = new Set(snapshotKeys(freshWorld()));
    for (const name of POOLS) {
      for (const field of ['nextId', 'live', 'slots.freeSlots', 'slots.generations']) {
        expect(saved.has(`${name}.${field}`), `${name}.${field} is not saved`).toBe(true);
      }
    }
  });

  it('saves every typed array the wave runner owns', () => {
    const world = freshWorld();
    const saved = new Set(snapshotKeys(world));
    const runner = world.waveRunner as unknown as Record<string, unknown>;
    for (const key of Object.keys(runner)) {
      if (!ArrayBuffer.isView(runner[key])) continue;
      expect(saved.has(`waveRunner.${key}`), `waveRunner.${key} is not saved`).toBe(true);
    }
  });

  it('saves every counter the results screen reports', () => {
    const world = freshWorld();
    const saved = new Set(snapshotKeys(world));
    for (const key of Object.keys(world.stats)) {
      expect(saved.has(`stats.${key}`), `stats.${key} is not saved`).toBe(true);
    }
  });
});
