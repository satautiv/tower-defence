import { afterEach, describe, expect, it, vi } from 'vitest';
import type { World as WorldType } from '@sim/index';
import { SYSTEMS, World, advance, buildTower, callWave, hashWorld, tick } from '@sim/index';

/**
 * The property the whole architecture rests on: the same seed and the same
 * commands produce the same run.
 *
 * Replays are a seed plus an ordered command list. A bug report is a few
 * hundred bytes. The balance simulator's numbers mean something. All of that
 * depends on this staying true, so it is checked on every pull request from
 * here on — the systems are stubs today and will not be for long.
 *
 * The first block matters as much as the second. With stub systems, two worlds
 * that never change would hash identically no matter how broken the hash was,
 * so the hash is proven sensitive before it is trusted.
 */

const config = {
  seed: 20260919,
  widthTiles: 30,
  heightTiles: 17,
  startingGold: 600,
  lives: 20,
  totalWaves: 10,
};

const freshWorld = (seed = config.seed): World => new World({ ...config, seed });

afterEach(() => vi.restoreAllMocks());

describe('the hash notices state changing', () => {
  it.each<[string, (w: WorldType) => void]>([
    ['a tick elapsing', (w) => tick(w)],
    ['the RNG advancing', (w) => void w.rng.next()],
    ['gold changing', (w) => (w.resources.gold += 1)],
    ['a life lost', (w) => (w.resources.lives -= 1)],
    ['aether charging', (w) => (w.resources.aether += 1)],
    ['the wave advancing', (w) => (w.wave.index += 1)],
    ['the phase changing', (w) => (w.phase = 1)],
    ['speed changing', (w) => (w.speed = 3)],
    ['reaction power changing', (w) => (w.reactionPower = 1.5)],
    ['an enemy spawning', (w) => void w.enemies.alloc()],
    ['a tower being built', (w) => void w.towers.alloc()],
    ['a projectile firing', (w) => void w.projectiles.alloc()],
    [
      'one enemy field moving',
      (w) => {
        const slot = w.enemies.alloc();
        w.enemies.pathDist[slot] = 0.001;
      },
    ],
    [
      'a single status stack landing',
      (w) => {
        const slot = w.enemies.alloc();
        w.enemies.statusStacks[slot * 7] = 1;
      },
    ],
    /* Two runs whose burns lapse a tick apart are not the same run, even while
       the stack counts still agree (#21). */
    [
      'a status deadline moving',
      (w) => {
        const slot = w.enemies.alloc();
        w.enemies.statusExpiry[slot * 7] = 240;
      },
    ],
    [
      'an enemy being queued for the reaction scan',
      (w) => {
        const slot = w.enemies.alloc();
        w.enemies.statusDirty[slot] = 1;
      },
    ],
  ])('changes when %s', (_label, mutate) => {
    const world = freshWorld();
    const before = hashWorld(world);
    mutate(world);
    expect(hashWorld(world)).not.toBe(before);
  });

  it('is stable when nothing changes', () => {
    const world = freshWorld();
    expect(hashWorld(world)).toBe(hashWorld(world));
  });

  it('distinguishes two different seeds', () => {
    expect(hashWorld(freshWorld(1))).not.toBe(hashWorld(freshWorld(2)));
  });

  it('notices a freed slot, so allocation history cannot diverge unseen', () => {
    const world = freshWorld();
    const before = hashWorld(world);
    const slot = world.enemies.alloc();
    world.enemies.free(slot);
    /* The slot is free again but its id counter moved on. */
    expect(hashWorld(world)).not.toBe(before);
  });
});

describe('identical inputs produce identical runs', () => {
  it('matches after 10,000 ticks', () => {
    const a = freshWorld();
    const b = freshWorld();

    advance(a, 10_000);
    advance(b, 10_000);

    expect(a.tick).toBe(10_000);
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  /**
   * Randomness is the likeliest way determinism breaks, so the run is made to
   * consume the seeded stream every tick — which is what the wave spawner,
   * evasion rolls and path branching will do once they exist.
   */
  it('matches when the run consumes the random stream', () => {
    const drive = (world: World): void => {
      vi.spyOn(SYSTEMS[1]!, 'run').mockImplementation((w) => {
        if (w.rng.next() < 0.02) {
          const slot = w.enemies.alloc();
          if (slot >= 0) {
            w.enemies.hp[slot] = w.rng.range(40, 300);
            w.enemies.pathDist[slot] = 0;
          }
        }
      });
      advance(world, 10_000);
      vi.restoreAllMocks();
    };

    const a = freshWorld();
    const b = freshWorld();
    drive(a);
    drive(b);

    expect(a.enemies.count).toBeGreaterThan(0);
    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  it('matches when the same commands are issued at the same ticks', () => {
    const play = (world: World): void => {
      for (let t = 0; t < 10_000; t++) {
        if (t % 500 === 0) buildTower(world.commands, t % 14, t % 3);
        if (t % 1200 === 0) callWave(world.commands);
        tick(world);
      }
    };

    const a = freshWorld();
    const b = freshWorld();
    play(a);
    play(b);

    expect(hashWorld(b)).toBe(hashWorld(a));
  });

  /* Guards the guard: if the check could not fail, it would prove nothing. */
  it('detects a divergence of one command', () => {
    const a = freshWorld();
    const b = freshWorld();

    advance(a, 100);
    advance(b, 100);
    b.rng.next();

    expect(hashWorld(b)).not.toBe(hashWorld(a));
  });

  it('detects a divergence of one tick', () => {
    const a = freshWorld();
    const b = freshWorld();
    advance(a, 100);
    advance(b, 101);

    expect(hashWorld(b)).not.toBe(hashWorld(a));
  });
});

describe('reset', () => {
  it('returns a used world to its starting fingerprint', () => {
    const world = freshWorld();
    const pristine = hashWorld(world);

    advance(world, 2000);
    world.resources.gold = 42;
    world.enemies.alloc();
    world.rng.next();
    expect(hashWorld(world)).not.toBe(pristine);

    world.reset();
    expect(hashWorld(world)).toBe(pristine);
  });

  /* Reuses every allocation, so restarting a stage cannot be the thing that
     triggers a collection. */
  it('makes a restarted stage identical to a fresh one', () => {
    const restarted = freshWorld();
    advance(restarted, 1000);
    restarted.reset();

    expect(hashWorld(restarted)).toBe(hashWorld(freshWorld()));
  });
});
