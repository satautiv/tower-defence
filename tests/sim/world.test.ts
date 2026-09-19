import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { StagePhase, World, advance, createWorldForStage } from '@sim/index';

const config = {
  seed: 42,
  widthTiles: 30,
  heightTiles: 17,
  startingGold: 600,
  lives: 20,
  totalWaves: 10,
};

describe('World construction', () => {
  it('starts in the building phase with the stage resources', () => {
    const world = new World(config);
    expect(world.phase).toBe(StagePhase.Building);
    expect(world.tick).toBe(0);
    expect(world.resources.gold).toBe(600);
    expect(world.resources.lives).toBe(20);
    expect(world.resources.aether).toBe(0);
  });

  it('has not started a wave yet', () => {
    const world = new World(config);
    expect(world.wave.index).toBe(-1);
    expect(world.wave.active).toBe(0);
  });

  it('seeds its RNG from the config, so two worlds agree', () => {
    expect(new World(config).rng.next()).toBe(new World(config).rng.next());
  });

  it('sizes its spatial indexes to the map', () => {
    const world = new World(config);
    expect(world.groundIndex.cellCount).toBeGreaterThan(0);
    expect(world.airIndex.cellCount).toBe(world.groundIndex.cellCount);
  });

  it('separates ground and air indexes, so anti-air never scans the ground', () => {
    const world = new World(config);
    expect(world.airIndex).not.toBe(world.groundIndex);
  });

  it('defaults reaction power to unmodified', () => {
    expect(new World(config).reactionPower).toBe(1);
    expect(new World({ ...config, reactionPower: 1.4 }).reactionPower).toBe(1.4);
  });
});

describe('createWorldForStage', () => {
  const registry = buildRegistry(readContentFromDisk());
  const stage = registry.stages.get('1-1');

  it('takes its dimensions and resources from authored content', () => {
    expect(stage).toBeDefined();
    const world = createWorldForStage(registry, stage!, 1);

    expect(world.config.widthTiles).toBe(stage!.widthTiles);
    expect(world.config.heightTiles).toBe(stage!.heightTiles);
    expect(world.resources.gold).toBe(stage!.startingGold);
    expect(world.resources.lives).toBe(stage!.lives);
    expect(world.config.totalWaves).toBe(stage!.waves.length);
  });
});

describe('finished', () => {
  it.each([
    [StagePhase.Building, false],
    [StagePhase.Running, false],
    [StagePhase.Won, true],
    [StagePhase.Lost, true],
  ])('phase %s reports finished as %s', (phase, expected) => {
    const world = new World(config);
    world.phase = phase;
    expect(world.finished).toBe(expected);
  });
});

describe('reset', () => {
  it('restores resources, clock and phase', () => {
    const world = new World(config);
    advance(world, 50);
    world.resources.gold = 0;
    world.resources.lives = 3;
    world.phase = StagePhase.Running;

    world.reset();
    expect(world.tick).toBe(0);
    expect(world.resources.gold).toBe(600);
    expect(world.resources.lives).toBe(20);
    expect(world.phase).toBe(StagePhase.Building);
  });

  it('rewinds the RNG to the seed, so a retry plays out the same way', () => {
    const world = new World(config);
    const first = world.rng.next();
    for (let i = 0; i < 100; i++) world.rng.next();

    world.reset();
    expect(world.rng.next()).toBe(first);
  });

  it('empties every pool', () => {
    const world = new World(config);
    world.enemies.alloc();
    world.towers.alloc();
    world.projectiles.alloc();

    world.reset();
    expect(world.enemies.count).toBe(0);
    expect(world.towers.count).toBe(0);
    expect(world.projectiles.count).toBe(0);
  });

  /* Restarting is instant and allocation-free, which is what lets the defeat
     screen offer a one-tap retry with no loading (docs/GAME_DESIGN.md §17.3). */
  it('reuses the same pool objects rather than rebuilding them', () => {
    const world = new World(config);
    const enemies = world.enemies;
    const index = world.groundIndex;

    world.reset();
    expect(world.enemies).toBe(enemies);
    expect(world.groundIndex).toBe(index);
  });
});
