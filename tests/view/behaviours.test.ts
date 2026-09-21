import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  BehaviourFlag,
  SimEventKind,
  behaviourSystem,
  createWorldForStage,
  enemyIndex,
  spawnEnemy,
  targetingSystem,
} from '@sim/index';
import type { World } from '@sim/index';
import { BehaviourFeed, behaviourColour } from '@view/behaviours';
import { BEHAVIOUR_COLOUR, separation } from '@view/palette';

/**
 * The telegraph half of #29 (design pillar P4).
 *
 * `BehaviourFeed` is the part with the logic and no renderer, so it is tested
 * here; the Pixi half draws exactly what the feed decided and is covered by
 * E2E, the same split the reaction view uses.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (): World => createWorldForStage(registry, stage, 1);

function place(world: World, id: string, x: number, y: number): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.hp[slot] = 10_000;
  world.enemies.maxHp[slot] = 10_000;
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = y;
  return slot;
}

describe('every behaviour has a telegraph of its own', () => {
  it.each([
    ['healer', BehaviourFlag.Healer],
    ['shielder', BehaviourFlag.Shielder],
    ['tower slow', BehaviourFlag.TowerSlowAura],
    ['ally haste', BehaviourFlag.AllyHasteAura],
    ['sapper', BehaviourFlag.Sapper],
    ['carrier', BehaviourFlag.Carrier],
    ['stationary spawner', BehaviourFlag.StationarySpawner],
    ['phase', BehaviourFlag.Phase],
  ])('%s draws something', (_name, flag) => {
    expect(behaviourColour(flag)).not.toBeNull();
  });

  it('draws nothing for an enemy that changes no rules', () => {
    expect(behaviourColour(BehaviourFlag.None)).toBeNull();
  });

  /**
   * The point of colouring them at all: a Sapper winding up and a Mender
   * healing are answered in opposite ways, so a player who cannot tell the two
   * telegraphs apart has been told only that *something* is happening.
   */
  it('keeps the telegraphs distinguishable from each other', () => {
    const entries = Object.entries(BEHAVIOUR_COLOUR);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [nameA, a] = entries[i] as [string, number];
        const [nameB, b] = entries[j] as [string, number];
        expect(separation(a, b).distinguishable, `${nameA} vs ${nameB}`).toBe(true);
      }
    }
  });
});

describe('a standing aura is drawn while it is standing', () => {
  it('shows a ring for a live aura source and drops it when the source dies', () => {
    const world = freshWorld();
    const nullifier = place(world, 'nullifier', 900, 900);
    const feed = new BehaviourFeed();

    feed.syncAuras(world);
    expect(feed.rings.length).toBe(1);
    expect(feed.rings[0]?.radius).toBeGreaterThan(0);

    world.enemies.free(nullifier);
    feed.syncAuras(world);
    /* An aura ring that outlived its source would tell the player the danger
       had passed while it had not — or worse, the reverse. */
    expect(feed.rings.length).toBe(0);
  });

  it('draws no ring for an enemy that has no aura', () => {
    const world = freshWorld();
    place(world, 'husk', 900, 900);

    const feed = new BehaviourFeed();
    feed.syncAuras(world);
    expect(feed.rings.length).toBe(0);
  });
});

describe('a moment is drawn from the event buffer and ages out', () => {
  it('pulses when a spawner breeds, and fades', () => {
    const world = freshWorld();
    const sprout = place(world, 'rift_sprout', 700, 700);
    world.enemies.behaviourReadyTick[sprout] = 0;

    targetingSystem(world);
    behaviourSystem(world);

    const feed = new BehaviourFeed();
    feed.consume(world);
    expect(feed.pulses.length).toBeGreaterThan(0);

    for (let i = 0; i < 200; i++) feed.advance();
    expect(feed.pulses.length).toBe(0);
  });

  it('drops telegraphs rather than growing without bound', () => {
    const world = freshWorld();
    const feed = new BehaviourFeed();

    /* Far more events than the cap, which is the dense-wave case risk T3
       names: a board under pressure must drop decoration, never stutter. */
    for (let i = 0; i < 500; i++) {
      world.events.push(SimEventKind.BehaviourFired, i, BehaviourFlag.Healer, i, i);
    }
    feed.consume(world);

    expect(feed.pulses.length).toBeLessThanOrEqual(48);
    expect(feed.dropped).toBeGreaterThan(0);
  });

  it('forgets everything on a restart', () => {
    const feed = new BehaviourFeed();
    const world = freshWorld();
    place(world, 'nullifier', 900, 900);

    feed.syncAuras(world);
    world.events.push(SimEventKind.BehaviourFired, 1, BehaviourFlag.Sapper, 10, 10);
    feed.consume(world);

    feed.clear();
    expect(feed.pulses.length).toBe(0);
    expect(feed.rings.length).toBe(0);
  });
});
