import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { DamageWatcher, healthLost } from '@devtools/damageLog';
import {
  DAMAGE_INDEX,
  STATUS_INDEX,
  applyStatus,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  reactionSystem,
  spawnEnemy,
  statusSystem,
  targetingSystem,
} from '@sim/index';
import type { World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * The damage log (#41).
 *
 * > The damage log accounts for 100% of an enemy's lost HP.
 *
 * That is an arithmetic claim, so it is checked as arithmetic: everything the
 * log says was dealt, minus what an overshield swallowed, must equal the health
 * the enemy actually lost — measured off the pool, not off the log's own
 * running total.
 *
 * Driven through the real damage queue and the real systems rather than
 * hand-written events. A log tested against synthetic input proves only that
 * it can add up, which was never the part in doubt.
 *
 * **"100%" means to float32 precision, and that is a property of the pools
 * rather than a slack tolerance.** `EnemyPool.hp` is a `Float32Array` while the
 * log accumulates in an ordinary JavaScript number, so every comparison here is
 * float32 against float64: at 5,000 health the spacing between representable
 * values is about 0.0005, and `maxHp - hp` simply cannot recover a sum finer
 * than that. So the reconciliation is asserted as *relative* error, which holds
 * at any size, rather than as decimal places, which silently means something
 * different on a riftling and on Grendrix.
 */

/** The criterion: everything that cost health equals the health that was lost. */
function expectAccountsFor(toHealth: number, lost: number): void {
  expect(lost).toBeGreaterThanOrEqual(0);
  if (lost === 0) {
    expect(toHealth).toBeCloseTo(0, 4);
    return;
  }
  expect(Math.abs(toHealth - lost) / lost).toBeLessThan(1e-5);
}

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

/**
 * An enemy tough enough to survive the test, and no tougher.
 *
 * The health matters, which is not obvious. `EnemyPool.hp` is a `Float32Array`
 * and the log accumulates in an ordinary JavaScript number, so reconciling the
 * two is a float32-versus-float64 comparison. Near 500,000 the spacing between
 * representable float32 values is about 0.03, and `maxHp - hp` cannot recover
 * a sum finer than that — the first draft of this fixture used 500,000 and the
 * reconciliation missed by 0.014, which is catastrophic cancellation rather
 * than a bug in the log. Five thousand is comfortably inside a real enemy's
 * range and leaves the spacing far below anything worth reporting.
 */
function sturdy(world: World, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.hp[slot] = 5_000;
  world.enemies.maxHp[slot] = 5_000;
  world.enemies.x[slot] = 500;
  world.enemies.y[slot] = 500;
  return slot;
}

const fresh = (seed = 5): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

describe('what the log accounts for', () => {
  it('is nothing until it is watching something', () => {
    const world = fresh();
    const watcher = new DamageWatcher();
    const slot = sturdy(world);

    world.damage.push(slot, 100, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    watcher.consume(world);

    expect(watcher.read().entries).toEqual([]);
  });

  /* The criterion, in one assertion. */
  it('adds up to exactly the health an enemy lost', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    const watcher = new DamageWatcher();
    watcher.watch(enemyId);

    for (const [amount, type] of [
      [120, DAMAGE_INDEX.kinetic],
      [80, DAMAGE_INDEX.pyro],
      [55, DAMAGE_INDEX.arcane],
      [200, DAMAGE_INDEX.true],
    ] as const) {
      world.damage.push(slot, amount, type, -1);
    }
    damageResolutionSystem(world);
    watcher.consume(world);

    const log = watcher.read();
    expectAccountsFor(log.toHealth, healthLost(world, slot, enemyId));
    expect(log.toHealth).toBeGreaterThan(0);
  });

  /* Armour and ward mean the log's numbers are not the numbers pushed in —
     which is the whole point of reporting the *resolved* hit. */
  it('reports what landed, not what was aimed', () => {
    const world = fresh();
    const slot = sturdy(world, 'bulwark_golem');
    const enemyId = world.enemies.ids[slot] as number;
    const watcher = new DamageWatcher();
    watcher.watch(enemyId);

    world.damage.push(slot, 1000, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    watcher.consume(world);

    const log = watcher.read();
    expect(log.dealt).toBeLessThan(1000);
    expectAccountsFor(log.toHealth, healthLost(world, slot, enemyId));
  });

  /* Damage over time, reactions and projectiles all go through one queue, so
     the log needs no special case for any of them — the sum has to close over
     a fight that used all three. */
  it('closes over a fight with burns and reactions in it', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    const watcher = new DamageWatcher();
    watcher.watch(enemyId);

    applyStatus(world, slot, STATUS_INDEX.scorch, 5);
    applyStatus(world, slot, STATUS_INDEX.chill, 1);

    for (let t = 0; t < 240; t++) {
      targetingSystem(world);
      statusSystem(world);
      reactionSystem(world);
      damageResolutionSystem(world);
      watcher.consume(world);
      world.events.clear();
      world.tick++;
    }

    const log = watcher.read();
    expect(log.entries.length).toBeGreaterThan(0);
    expectAccountsFor(log.toHealth, healthLost(world, slot, enemyId));
    expect(log.entries.some((entry) => entry.fromReaction)).toBe(true);
  });

  /* An overshield is real damage that cost no health. Counting it against
     health would over-report by exactly the shield. */
  it('separates what an overshield ate from what cost health', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    world.enemies.overshield[slot] = 150;

    const watcher = new DamageWatcher();
    watcher.watch(enemyId);
    world.damage.push(slot, 400, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    watcher.consume(world);

    const log = watcher.read();
    expect(log.absorbed).toBeCloseTo(150, 4);
    expect(log.dealt).toBeCloseTo(400, 4);
    expectAccountsFor(log.toHealth, healthLost(world, slot, enemyId));
  });

  /* The same claim on a pool a hundred times larger, where float32's spacing
     is a hundred times coarser. A relative bound holds; a decimal one would
     have to be loosened per enemy, which is how a criterion stops meaning
     anything. */
  it('holds on an enemy with a huge health pool', () => {
    const world = fresh();
    const slot = sturdy(world);
    world.enemies.hp[slot] = 500_000;
    world.enemies.maxHp[slot] = 500_000;
    const enemyId = world.enemies.ids[slot] as number;

    const watcher = new DamageWatcher();
    watcher.watch(enemyId);
    world.damage.push(slot, 1000, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);
    watcher.consume(world);

    expectAccountsFor(watcher.read().toHealth, healthLost(world, slot, enemyId));
  });

  it('still closes when the shield eats the whole hit', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    world.enemies.overshield[slot] = 500;

    const watcher = new DamageWatcher();
    watcher.watch(enemyId);
    world.damage.push(slot, 200, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    watcher.consume(world);

    const log = watcher.read();
    expect(log.absorbed).toBeCloseTo(200, 4);
    expect(log.toHealth).toBeCloseTo(0, 4);
    expect(healthLost(world, slot, enemyId)).toBeCloseTo(0, 4);
  });
});

describe('what the log says about a hit', () => {
  it('names the tower that dealt it, and -1 for everything that is not one', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    const watcher = new DamageWatcher();
    watcher.watch(enemyId);

    world.damage.push(slot, 50, DAMAGE_INDEX.kinetic, 3);
    world.damage.push(slot, 50, DAMAGE_INDEX.pyro, -1);
    damageResolutionSystem(world);
    watcher.consume(world);

    const sources = watcher.read().entries.map((entry) => entry.source);
    expect(sources).toContain(3);
    expect(sources).toContain(-1);
  });

  it('groups repeats rather than listing every tick of a burn', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    const watcher = new DamageWatcher();
    watcher.watch(enemyId);

    for (let i = 0; i < 6; i++) world.damage.push(slot, 10, DAMAGE_INDEX.pyro, 1);
    damageResolutionSystem(world);
    watcher.consume(world);

    const log = watcher.read();
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ hits: 6, total: 60, source: 1 });
  });

  it('puts the biggest contributor first', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;
    const watcher = new DamageWatcher();
    watcher.watch(enemyId);

    world.damage.push(slot, 10, DAMAGE_INDEX.true, 1);
    world.damage.push(slot, 90, DAMAGE_INDEX.true, 2);
    damageResolutionSystem(world);
    watcher.consume(world);

    expect(watcher.read().entries[0]?.source).toBe(2);
  });

  it('forgets the last enemy when it follows a new one', () => {
    const world = fresh();
    const first = sturdy(world);
    const watcher = new DamageWatcher();
    watcher.watch(world.enemies.ids[first] as number);
    world.damage.push(first, 100, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    watcher.consume(world);
    expect(watcher.read().dealt).toBeGreaterThan(0);

    const second = sturdy(world);
    watcher.watch(world.enemies.ids[second] as number);
    expect(watcher.read().dealt).toBe(0);
    expect(watcher.read().entries).toEqual([]);
  });

  /* A slot is recycled the moment its enemy dies, and a log that answered
     confidently about whoever moved in would be worse than silent. */
  it('refuses to reconcile against a slot that has moved on', () => {
    const world = fresh();
    const slot = sturdy(world);
    const enemyId = world.enemies.ids[slot] as number;

    expect(healthLost(world, slot, enemyId)).toBeGreaterThanOrEqual(0);
    expect(healthLost(world, slot, enemyId + 9999)).toBe(-1);

    world.enemies.free(slot);
    expect(healthLost(world, slot, enemyId)).toBe(-1);
  });
});
