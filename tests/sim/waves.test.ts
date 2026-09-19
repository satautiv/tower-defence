import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  SimEventKind,
  StagePhase,
  advance,
  callWave,
  createWorldForStage,
  describeWave,
  earlyCallBonus,
  setSpeed,
  startWave,
  tick,
} from '@sim/index';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

const countEvents = (world: World, kind: SimEventKind): number => {
  let n = 0;
  for (let i = 0; i < world.events.count; i++) if (world.events.at(i).kind === kind) n++;
  return n;
};

/** Enemies alive and not yet through, i.e. still the player's problem. */
const liveEnemies = (world: World): number => {
  let n = 0;
  for (let slot = 0; slot < world.enemies.watermark; slot++) {
    if (!world.enemies.isAlive(slot)) continue;
    if (((world.enemies.flags[slot] as number) & EnemyFlag.Leaked) !== 0) continue;
    n++;
  }
  return n;
};

describe('the wave table mirrors authored content', () => {
  it('counts every wave', () => {
    expect(freshWorld().rules.waves.count).toBe(stage.waves.length);
  });

  it('totals a wave bounty from its enemies', () => {
    const world = freshWorld();
    const expected = stage.waves[0]!.groups.reduce(
      (sum, group) => sum + registry.enemies.get(group.enemy)!.bounty * group.count,
      0,
    );
    expect(world.rules.waves.totalBounty[0]).toBe(expected);
  });

  it('starts the stage in the build phase with wave one pending', () => {
    const world = freshWorld();
    expect(world.phase).toBe(StagePhase.Building);
    expect(world.wave.index).toBe(-1);
    expect(world.wave.autoStartIn).toBe(
      Math.round(stage.waves[0]!.autoStartDelaySeconds * TICK_HZ),
    );
  });
});

describe('the preview reads what the spawner reads', () => {
  /* A preview the player cannot trust turns a fair loss into an unfair one. */
  it('reports the exact composition the wave will spawn', () => {
    const world = freshWorld();
    const preview = describeWave(world.rules, 0);

    expect(preview).not.toBeNull();
    expect(preview!.groups).toHaveLength(stage.waves[0]!.groups.length);
    expect(preview!.groups[0]!.enemyId).toBe(stage.waves[0]!.groups[0]!.enemy);
    expect(preview!.groups[0]!.count).toBe(stage.waves[0]!.groups[0]!.count);
  });

  it('agrees with what actually spawns', () => {
    const world = freshWorld();
    const preview = describeWave(world.rules, 0)!;

    startWave(world, 0);
    /* Stop before the next wave auto-starts, or its spawns would be counted
       too — waves chain on a timer whether or not the last one is done. */
    advance(world, Math.ceil(preview.spawnDurationSeconds * TICK_HZ) + 2);

    let spawnedFromWaveZero = 0;
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.waveIndex[slot] === 0) spawnedFromWaveZero++;
    }
    expect(spawnedFromWaveZero).toBe(preview.totalEnemies);
  });

  it('returns nothing for a wave that does not exist', () => {
    const world = freshWorld();
    expect(describeWave(world.rules, -1)).toBeNull();
    expect(describeWave(world.rules, 999)).toBeNull();
  });
});

describe('spawning follows the schedule', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('releases the exact declared count, and no more', () => {
    const declared = stage.waves[0]!.groups.reduce((n, g) => n + g.count, 0);
    startWave(world, 0);
    /* Long enough to finish releasing, short enough that nothing has walked
       the length of the map and been collected as a leak. */
    const preview = describeWave(world.rules, 0)!;
    advance(world, Math.ceil(preview.spawnDurationSeconds * TICK_HZ) + 2);

    /* Counted by wave tag: later waves auto-start during this window. */
    let fromWaveZero = 0;
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.waveIndex[slot] === 0) fromWaveZero++;
    }
    expect(fromWaveZero).toBe(declared);
  });

  it('spaces spawns by the authored interval', () => {
    const group = stage.waves[0]!.groups[0]!;
    startWave(world, 0);

    /* One tick in, only the first of the group has appeared. */
    tick(world);
    expect(world.enemies.count).toBe(1);

    advance(world, Math.round(group.intervalSeconds * TICK_HZ));
    expect(world.enemies.count).toBe(2);
  });

  it('honours a group delay', () => {
    /* Wave four opens with riftlings and drops husks in four seconds later. */
    const delayed = stage.waves[3]!;
    const laterGroup = delayed.groups.find((g) => g.delaySeconds > 0);
    expect(laterGroup).toBeDefined();

    startWave(world, 3);
    advance(world, Math.round(laterGroup!.delaySeconds * TICK_HZ) - 2);
    const before = world.enemies.count;

    advance(world, 4);
    expect(world.enemies.count).toBeGreaterThan(before);
  });

  it('tags each enemy with the wave it came from', () => {
    startWave(world, 2);
    advance(world, 30);
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.isAlive(slot)) expect(world.enemies.waveIndex[slot]).toBe(2);
    }
  });

  it('moves the stage out of the build phase', () => {
    startWave(world, 0);
    expect(world.phase).toBe(StagePhase.Running);
  });
});

describe('waves start on their own', () => {
  it('begins wave one when its timer expires', () => {
    const world = freshWorld();
    advance(world, world.wave.autoStartIn + 1);
    expect(world.wave.index).toBe(0);
  });

  it('does not begin before the timer expires', () => {
    const world = freshWorld();
    advance(world, world.wave.autoStartIn - 2);
    expect(world.wave.index).toBe(-1);
  });

  it('queues each following wave after the one before', () => {
    const world = freshWorld();
    advance(world, world.wave.autoStartIn);
    expect(world.wave.index).toBe(0);
    expect(world.wave.autoStartIn).toBe(
      Math.round(stage.waves[1]!.autoStartDelaySeconds * TICK_HZ),
    );
  });

  it('refuses a fifth wave rather than stacking it, and holds the timer at zero', () => {
    const world = freshWorld();
    /* Four slots is already far past survivable. */
    for (let i = 0; i < 6; i++) startWave(world, i);
    expect(world.waveRunner.activeCount).toBe(4);

    advance(world, 500);
    /* A countdown going backwards would be shown to the player. */
    expect(world.wave.autoStartIn).toBeGreaterThanOrEqual(0);
  });

  it('stops scheduling once the final wave has started', () => {
    const world = freshWorld();
    world.wave.index = stage.waves.length - 1;
    world.wave.autoStartIn = 50;

    advance(world, 500);
    expect(world.wave.autoStartIn).toBe(50);
  });
});

describe('calling a wave early', () => {
  it('starts the next wave immediately', () => {
    const world = freshWorld();
    callWave(world.commands);
    tick(world);
    expect(world.wave.index).toBe(0);
  });

  it('pays the formula: 1.5 gold per second skipped', () => {
    const world = freshWorld();
    const remaining = world.wave.autoStartIn;
    const gold = world.resources.gold;

    callWave(world.commands);
    tick(world);

    /* Capped at what the wave is worth, which wave one hits: five riftlings. */
    const expected = Math.min(
      Math.floor((remaining / TICK_HZ) * 1.5),
      world.rules.waves.totalBounty[0]!,
    );
    expect(world.resources.gold - gold).toBe(expected);
  });

  /* A long timer must not pay more than the enemies it summons. */
  it('caps the bonus at what the wave itself is worth', () => {
    const world = freshWorld();
    expect(earlyCallBonus(world.rules, 0, TICK_HZ * 10_000)).toBe(world.rules.waves.totalBounty[0]);
  });

  it('pays nothing for a timer that has already run out', () => {
    const world = freshWorld();
    expect(earlyCallBonus(world.rules, 0, 0)).toBe(0);
    expect(earlyCallBonus(world.rules, 0, -50)).toBe(0);
  });

  it('refuses once every wave has been called', () => {
    const world = freshWorld();
    for (let i = 0; i < stage.waves.length; i++) startWave(world, i);

    callWave(world.commands);
    tick(world);
    expect(countEvents(world, SimEventKind.CommandRejected)).toBe(1);
  });

  /**
   * Stacking waves is the point: the player takes gold now for enemies they
   * may not survive. Both waves must run on their own schedules.
   */
  it('runs wave two alongside wave one', () => {
    const world = freshWorld();
    startWave(world, 0);
    advance(world, 20);

    callWave(world.commands);
    tick(world);

    expect(world.waveRunner.activeCount).toBe(2);
    advance(world, TICK_HZ * 20);

    const fromFirst = [...world.enemies.waveIndex.slice(0, world.enemies.watermark)];
    expect(fromFirst).toContain(0);
    expect(fromFirst).toContain(1);
  });

  it('spawns the full declared count of both stacked waves', () => {
    const world = freshWorld();
    startWave(world, 0);
    startWave(world, 1);
    const longest = Math.max(
      describeWave(world.rules, 0)!.spawnDurationSeconds,
      describeWave(world.rules, 1)!.spawnDurationSeconds,
    );
    advance(world, Math.ceil(longest * TICK_HZ) + 2);

    for (const index of [0, 1]) {
      const declared = stage.waves[index]!.groups.reduce((n, g) => n + g.count, 0);
      let actual = 0;
      for (let slot = 0; slot < world.enemies.watermark; slot++) {
        if (world.enemies.waveIndex[slot] === index) actual++;
      }
      expect(actual, `wave ${index}`).toBe(declared);
    }
  });
});

describe('clearing a wave', () => {
  it('pays the clear bonus once every enemy is gone', () => {
    const world = freshWorld();
    startWave(world, 0);

    /* Let the wave finish releasing before killing anything, or the spawner
       simply produces more. */
    const preview = describeWave(world.rules, 0)!;
    advance(world, Math.ceil(preview.spawnDurationSeconds * TICK_HZ) + 2);

    const gold = world.resources.gold;
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.waveIndex[slot] === 0) world.enemies.free(slot);
    }
    tick(world);

    expect(world.wave.cleared).toBeGreaterThanOrEqual(1);
    expect(world.resources.gold - gold).toBe(preview.clearBonus);
  });

  it('does not clear while enemies from the wave remain', () => {
    const world = freshWorld();
    startWave(world, 0);
    advance(world, 10);
    expect(liveEnemies(world)).toBeGreaterThan(0);
    expect(world.wave.cleared).toBe(0);
  });

  it('treats a leaked enemy as gone, rather than holding the wave open', () => {
    const world = freshWorld();
    startWave(world, 0);
    advance(world, TICK_HZ * 10);

    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.isAlive(slot)) {
        world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;
      }
    }
    advance(world, TICK_HZ * 30);
    expect(world.wave.cleared).toBeGreaterThanOrEqual(1);
  });

  it('frees the slot so a later wave can use it', () => {
    const world = freshWorld();
    startWave(world, 0);
    const preview = describeWave(world.rules, 0)!;
    advance(world, Math.ceil(preview.spawnDurationSeconds * TICK_HZ) + 2);

    for (let slot = 0; slot < world.enemies.watermark; slot++) world.enemies.free(slot);
    tick(world);

    expect(world.waveRunner.freeSlot()).toBeGreaterThanOrEqual(0);
  });
});

describe('speed is a command like any other', () => {
  it('accepts the supported speeds', () => {
    const world = freshWorld();
    setSpeed(world.commands, 3);
    tick(world);
    expect(world.speed).toBe(3);
  });

  it('rejects anything else rather than silently accepting it', () => {
    const world = freshWorld();
    setSpeed(world.commands, 7);
    tick(world);
    expect(world.speed).toBe(1);
    expect(countEvents(world, SimEventKind.CommandRejected)).toBe(1);
  });
});
