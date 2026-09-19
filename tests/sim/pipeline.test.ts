import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEMS, SYSTEM_ORDER, StagePhase, World, advance, buildTower, tick } from '@sim/index';

const config = {
  seed: 1,
  widthTiles: 30,
  heightTiles: 17,
  startingGold: 600,
  lives: 20,
  totalWaves: 10,
};

afterEach(() => vi.restoreAllMocks());

describe('the pipeline matches the specification', () => {
  /**
   * Ordering is the expensive thing to get wrong here. Status ticks must run
   * before reactions so a burn can apply the stack that triggers one; reactions
   * must run before damage so a Superconduct strips armour in time to matter.
   * A reordering that looks harmless changes the game, so the order is pinned.
   */
  it('runs exactly the fifteen specified systems', () => {
    expect(SYSTEMS.map((s) => s.name)).toEqual([...SYSTEM_ORDER]);
    expect(SYSTEMS).toHaveLength(15);
  });

  it('calls them in that order, once each per tick', () => {
    const calls: string[] = [];
    for (const system of SYSTEMS) {
      vi.spyOn(system, 'run').mockImplementation(() => {
        calls.push(system.name);
      });
    }

    tick(new World(config));
    expect(calls).toEqual([...SYSTEM_ORDER]);
  });

  it.each([
    ['statusSystem', 'reactionSystem'],
    ['reactionSystem', 'movementSystem'],
    ['reactionSystem', 'damageResolution'],
    ['movementSystem', 'targetingSystem'],
    ['targetingSystem', 'firingSystem'],
    ['firingSystem', 'projectileSystem'],
    ['projectileSystem', 'damageResolution'],
    ['groundEffectSystem', 'damageResolution'],
    ['damageResolution', 'economySystem'],
    ['economySystem', 'lifecycleSystem'],
    ['drainCommandQueue', 'waveSpawner'],
  ])('%s runs before %s', (earlier, later) => {
    expect(SYSTEM_ORDER.indexOf(earlier)).toBeLessThan(SYSTEM_ORDER.indexOf(later));
  });

  it('applies commands before anything else moves', () => {
    expect(SYSTEM_ORDER[0]).toBe('drainCommandQueue');
  });

  it('finalises output last', () => {
    expect(SYSTEM_ORDER[SYSTEM_ORDER.length - 1]).toBe('flushEvents');
  });
});

describe('tick', () => {
  it('advances the clock by one', () => {
    const world = new World(config);
    tick(world);
    tick(world);
    expect(world.tick).toBe(2);
  });

  /* A system setting `world.tick + 72` is measuring from the tick it ran on,
     so the counter increments after the systems, not before. */
  it('increments after the systems run, so deadlines are measured correctly', () => {
    const world = new World(config);
    let seen = -1;
    vi.spyOn(SYSTEMS[4]!, 'run').mockImplementation((w) => {
      seen = w.tick;
    });

    tick(world);
    expect(seen).toBe(0);
    expect(world.tick).toBe(1);
  });

  it('advances many ticks', () => {
    const world = new World(config);
    advance(world, 500);
    expect(world.tick).toBe(500);
  });

  /* A stray tick after the results screen must not award a bounty or leak a
     life into a stage that is already over. */
  it.each([StagePhase.Won, StagePhase.Lost])('does nothing once the stage is finished', (phase) => {
    const world = new World(config);
    world.phase = phase;
    tick(world);
    expect(world.tick).toBe(0);
  });
});

describe('the command queue drains every tick', () => {
  it('consumes queued commands rather than letting them accumulate', () => {
    const world = new World(config);
    buildTower(world.commands, 3, 0);
    buildTower(world.commands, 4, 1);
    expect(world.commands.count).toBe(2);

    tick(world);
    expect(world.commands.count).toBe(0);
  });

  it('never drops a command at human input rates', () => {
    const world = new World(config);
    for (let frame = 0; frame < 2000; frame++) {
      buildTower(world.commands, frame % 10, 0);
      tick(world);
    }
    /* A dropped command loses a player action, so anything but zero is a bug
       rather than tolerable overflow. */
    expect(world.commands.dropped).toBe(0);
  });
});
