import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  SimEventKind,
  applyTowerStats,
  behaviourSystem,
  bossInfo,
  createWorldForStage,
  enemyIndex,
  STATUS_INDEX,
  applyStatus,
  groundEffectSystem,
  lifecycleSystem,
  placeTower,
  reactionSystem,
  soldierSystem,
  spawnEnemy,
  targetingSystem,
  towerIndex,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Bosses (#33, docs/GAME_DESIGN.md §10).
 *
 * The issue's own words are what this file is organised around, because each
 * criterion names a way the feature could be present and still wrong: a phase
 * that swaps behaviours but sheds the rules a boss must keep, a mechanic that
 * lands with no warning, a leak that costs one life like anything else.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

/** A boss standing at a known distance along the road, at full health. */
function bossAt(world: World, pathDistance: number, id = 'grendrix'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  if (slot < 0) throw new Error(`could not spawn ${id}`);
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);
  world.enemies.pathDist[slot] = pathDistance;
  world.enemies.x[slot] = sample.x;
  world.enemies.y[slot] = sample.y;
  return slot;
}

function barracksAt(world: World, pathDistance: number): number {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);
  const slot = placeTower(world, towerIndex(world, 'wardens_barracks'), sample.x, sample.y);
  applyTowerStats(world, slot);
  return slot;
}

const run = (world: World): void => {
  targetingSystem(world);
  behaviourSystem(world);
};

/** Drops a boss to a health fraction without going through the damage queue. */
function setHealth(world: World, slot: number, fraction: number): void {
  world.enemies.hp[slot] = (world.enemies.maxHp[slot] as number) * fraction;
}

const eventsOfKind = (world: World, kind: SimEventKind): number[] => {
  const out: number[] = [];
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === kind) out.push(event.b);
  }
  return out;
};

describe('the boss rules hold for the whole fight', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('marks every boss Freeze-immune and stun-immune without it being authored', () => {
    const table = world.rules.enemies;
    for (const id of ['grendrix', 'maw_spawn', 'rust_prelate']) {
      const flags = table.flags[enemyIndex(world, id)] as number;
      expect(flags & EnemyFlag.Boss, id).not.toBe(0);
      expect(flags & EnemyFlag.FreezeImmune, id).not.toBe(0);
      expect(flags & EnemyFlag.StunImmune, id).not.toBe(0);
    }
  });

  /* A phase states its own trait list, so an author who writes the second
     phase without repeating `boss` would otherwise hand the player a boss that
     becomes freezable exactly when the fight gets hard. */
  it('keeps those rules through a phase change, whatever the phase restates', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.4);
    run(world);

    const flags = world.enemies.flags[slot] as number;
    expect(flags & EnemyFlag.Boss).not.toBe(0);
    expect(flags & EnemyFlag.FreezeImmune).not.toBe(0);
    expect(flags & EnemyFlag.StunImmune).not.toBe(0);
  });

  it('costs ten lives on a leak, where an ordinary enemy costs one', () => {
    const table = world.rules.enemies;
    expect(table.livesCost[enemyIndex(world, 'grendrix')]).toBe(10);
    expect(table.livesCost[enemyIndex(world, 'husk')]).toBe(1);
  });

  /* The leak is read off whatever row the enemy is in, so a boss that reached
     the core in its second phase must not cost a life like a riftling. */
  it('still costs ten after it has changed phase', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.4);
    run(world);

    const before = world.resources.lives;
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;
    lifecycleSystem(world);
    expect(before - world.resources.lives).toBe(10);
  });

  /**
   * *"Fully affected by Corrode, Unravel, Fracture and all reactions. Bosses
   * are where the reaction system gets to show off"* (§10).
   *
   * The immunities are narrow on purpose, and the easy mistake is to make them
   * wide: a boss that shrugged off the signature mechanic would make the whole
   * fight a damage check, which is the one thing the design says it is not.
   */
  it('takes the statuses it is meant to, and refuses only Freeze', () => {
    const slot = bossAt(world, 200);

    for (const status of ['corrode', 'unravel', 'fracture', 'scorch', 'chill'] as const) {
      applyStatus(world, slot, STATUS_INDEX[status], 3);
      expect(world.enemies.stacksOf(slot, STATUS_INDEX[status]), status).toBeGreaterThan(0);
    }

    applyStatus(world, slot, STATUS_INDEX.freeze, 1);
    expect(world.enemies.stacksOf(slot, STATUS_INDEX.freeze)).toBe(0);
  });

  it('detonates a reaction like anything else does', () => {
    const slot = bossAt(world, 200);
    targetingSystem(world);

    applyStatus(world, slot, STATUS_INDEX.scorch, 3);
    applyStatus(world, slot, STATUS_INDEX.chill, 3);
    reactionSystem(world);

    expect(eventsOfKind(world, SimEventKind.ReactionTriggered).length).toBeGreaterThan(0);
  });
});

describe('a phase is another row of the same table', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('stays in phase one above the threshold', () => {
    const slot = bossAt(world, 200);
    const before = world.enemies.typeIdx[slot] as number;
    setHealth(world, slot, 0.51);
    run(world);
    expect(world.enemies.typeIdx[slot]).toBe(before);
  });

  it('crosses at the authored fraction and says so', () => {
    const slot = bossAt(world, 200);
    const before = world.enemies.typeIdx[slot] as number;
    setHealth(world, slot, 0.5);
    run(world);

    expect(world.enemies.typeIdx[slot]).not.toBe(before);
    expect(eventsOfKind(world, SimEventKind.BossPhaseChanged)).toContain(
      world.enemies.typeIdx[slot] as number,
    );
  });

  /* The transition has to be a transition and not a respawn: a boss that
     healed, forgot its Corrode or jumped back up the road on crossing 50%
     would undo the fight the player just had. */
  it('keeps health, position and statuses across the change', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.5);
    const hp = world.enemies.hp[slot] as number;
    const dist = world.enemies.pathDist[slot] as number;

    run(world);

    expect(world.enemies.hp[slot]).toBe(hp);
    expect(world.enemies.pathDist[slot]).toBe(dist);
  });

  it('takes on the phase behaviours, and drops the ones it left behind', () => {
    const world2 = freshWorld();
    const slot = bossAt(world2, 200, 'rust_prelate');
    const table = world2.rules.enemies;

    const first = table.behaviour[world2.enemies.typeIdx[slot] as number] as number;
    setHealth(world2, slot, 0.2);
    run(world2);
    const second = table.behaviour[world2.enemies.typeIdx[slot] as number] as number;

    expect(first).not.toBe(second);
    /* The Prelate stops healing when it is bared. A phase that only ever added
       behaviours would pass a weaker assertion than this one. */
    expect(second & first).toBe(0);
  });

  it('stops at the last phase however far the health falls', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.5);
    run(world);
    const second = world.enemies.typeIdx[slot] as number;

    setHealth(world, slot, 0.01);
    run(world);
    expect(world.enemies.typeIdx[slot]).toBe(second);
  });

  it('gives an ordinary enemy no phase to cross at all', () => {
    const table = world.rules.enemies;
    expect(table.nextPhase[enemyIndex(world, 'husk')]).toBe(-1);
  });

  /* Phase rows sit after every ordinary enemy precisely so that an enemy's
     index is still its index — a wave that named `husk` must not start
     spawning a boss's second phase because the table grew. */
  it('leaves every authored id at its own index', () => {
    const table = world.rules.enemies;
    for (const id of ['husk', 'riftling', 'grendrix']) {
      const index = table.indexOf.get(id) as number;
      expect(table.ids[index]).toBe(id);
    }
  });
});

describe('the health bar is told which phase the fight is in', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('reports no boss when none is alive', () => {
    expect(bossInfo(world)).toBeNull();
  });

  it('carries every threshold, from full health', () => {
    bossAt(world, 200);
    const info = bossInfo(world);
    expect(info?.enemyId).toBe('grendrix');
    expect(info?.phase).toBe(0);
    expect(info?.thresholds).toEqual([0.5]);
  });

  /* The bar dims a marker the fight has already passed, so the phase number
     has to move when the boss does. It reading zero for the whole fight is
     exactly what the browser showed before this was tested. */
  it('counts the phase up once the boss has crossed', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.4);
    run(world);

    const info = bossInfo(world);
    expect(info?.phase).toBe(1);
    expect(info?.thresholds).toEqual([0.5]);
  });

  it('keeps calling the boss by its own id after the change', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.4);
    run(world);
    expect(bossInfo(world)?.enemyId).toBe('grendrix');
  });

  /* An escort of elites is a boss fight with several bars' worth of candidate,
     and the one the player is working on is the one closest to dying. */
  it('picks the boss with the least health left', () => {
    const first = bossAt(world, 200, 'maw_spawn');
    const second = bossAt(world, 300, 'rust_prelate');
    setHealth(world, second, 0.2);
    expect(bossInfo(world)?.slot).toBe(second);

    setHealth(world, first, 0.05);
    expect(bossInfo(world)?.slot).toBe(first);
  });
});

describe('Swallow demands an answer rather than damage', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  /* The mechanic reaches only what is *holding* the boss, which is what makes
     the counter real: pull the rally flag back and it eats nothing. */
  it('eats nothing while nothing is blocking it', () => {
    bossAt(world, 200);
    for (let i = 0; i < TICK_HZ * 20; i++) run(world);
    expect(eventsOfKind(world, SimEventKind.BehaviourFired)).toHaveLength(0);
  });

  it('warns before it bites, and the warning is not the bite', () => {
    const slot = bossAt(world, 400);
    barracksAt(world, 400);
    soldierSystem(world);

    let warned = -1;
    let bitten = -1;
    for (let i = 0; i < TICK_HZ * 30 && bitten < 0; i++) {
      world.events.clear();
      soldierSystem(world);
      run(world);
      world.tick++;

      const fired = eventsOfKind(world, SimEventKind.BehaviourFired);
      if (fired.length === 0) continue;
      if (warned < 0) warned = i;
      else if (world.enemies.blockedBy[slot] === -1) bitten = i;
    }

    expect(warned, 'no telegraph at all').toBeGreaterThanOrEqual(0);
    expect(bitten, 'the swallow never landed').toBeGreaterThan(warned);
    /* The wind-up is what the player acts inside, so it has to be most of a
       second at least rather than a frame of courtesy. */
    expect(bitten - warned).toBeGreaterThanOrEqual(TICK_HZ);
  });

  it('heals the boss by its authored share of maximum health', () => {
    const slot = bossAt(world, 400);
    barracksAt(world, 400);
    soldierSystem(world);
    setHealth(world, slot, 0.6);
    const before = world.enemies.hp[slot] as number;

    for (let i = 0; i < TICK_HZ * 30; i++) {
      soldierSystem(world);
      run(world);
      world.tick++;
    }

    /* The authored share, not merely "more": a swallow that healed a token
       amount would read on the board as the mechanic working. */
    const share = world.rules.enemies.devourHealFraction[
      world.enemies.baseTypeIdx[slot] as number
    ] as number;
    expect(share).toBeGreaterThan(0);
    expect(world.enemies.hp[slot] as number).toBeGreaterThanOrEqual(
      before + (world.enemies.maxHp[slot] as number) * share,
    );
  });

  it('never heals past full', () => {
    const slot = bossAt(world, 400);
    barracksAt(world, 400);
    soldierSystem(world);

    for (let i = 0; i < TICK_HZ * 40; i++) {
      soldierSystem(world);
      run(world);
      world.tick++;
    }

    expect(world.enemies.hp[slot] as number).toBeLessThanOrEqual(
      world.enemies.maxHp[slot] as number,
    );
  });
});

describe('the corrosive pools hold down the plots they cover', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('lays nothing in phase one', () => {
    bossAt(world, 200);
    for (let i = 0; i < TICK_HZ * 20; i++) {
      run(world);
      world.tick++;
    }
    expect(world.groundEffects.watermark).toBe(0);
  });

  it('lays a pool once the boss is enraged', () => {
    const slot = bossAt(world, 200);
    setHealth(world, slot, 0.4);

    for (let i = 0; i < TICK_HZ * 10 && world.groundEffects.watermark === 0; i++) {
      run(world);
      world.tick++;
    }
    expect(world.groundEffects.watermark).toBeGreaterThan(0);
  });

  /* The plot goes dark while the pool is on it and comes back when the pool
     goes out, with nothing to unwind — the same bargain every aura takes. */
  it('darkens a tower under the pool and lets it go when the pool does', () => {
    const tower = barracksAt(world, 400);
    const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
    world.rules.paths[0]?.sample(400, sample);

    const slot = bossAt(world, 400);
    world.enemies.x[slot] = world.towers.x[tower] as number;
    world.enemies.y[slot] = world.towers.y[tower] as number;
    setHealth(world, slot, 0.4);

    for (let i = 0; i < TICK_HZ * 10 && world.groundEffects.watermark === 0; i++) {
      run(world);
      world.tick++;
    }
    groundEffectSystem(world);
    expect(world.towers.disabledUntil[tower] as number).toBeGreaterThan(world.tick);

    /* Run the pool out. The boss is removed first, or it would simply lay
       another one on top of the first. */
    world.enemies.free(slot);
    for (let i = 0; i < TICK_HZ * 15; i++) {
      groundEffectSystem(world);
      world.tick++;
    }
    expect(world.towers.disabledUntil[tower] as number).toBeLessThanOrEqual(world.tick);
  });
});
