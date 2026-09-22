import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  EnemyFlag,
  SimEventKind,
  StagePhase,
  advance,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  hashWorld,
  spawnEnemy,
  stageResult,
  starsFor,
  startWave,
  tick,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');
const tuning = registry.tuning;

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

const hasEvent = (world: World, kind: SimEventKind): boolean => {
  for (let i = 0; i < world.events.count; i++) if (world.events.at(i).kind === kind) return true;
  return false;
};

/** Puts an enemy at the core, the way movement would. */
function leak(world: World, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;
  return slot;
}

/** Runs the stage to completion by removing everything that spawns. */
function playPerfectly(world: World, maxTicks = TICK_HZ * 600): void {
  for (let t = 0; t < maxTicks && !world.finished; t++) {
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (world.enemies.isAlive(slot)) {
        world.damage.push(slot, 1e9, DAMAGE_INDEX.true, -1);
      }
    }
    tick(world);
  }
}

describe('leaks cost lives', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('charges the enemy authored cost and removes the body', () => {
    const slot = leak(world);
    const cost = registry.enemies.get('husk')!.livesCost;

    tick(world);
    expect(world.resources.lives).toBe(stage.lives - cost);
    expect(world.enemies.isAlive(slot)).toBe(false);
    expect(world.stats.enemiesLeaked).toBe(1);
  });

  it('charges more for an enemy worth more lives', () => {
    leak(world, 'chitin_mother');
    const cost = registry.enemies.get('chitin_mother')!.livesCost;

    tick(world);
    expect(world.resources.lives).toBe(stage.lives - cost);
    expect(cost).toBeGreaterThan(1);
  });

  it('announces the leak and the life lost', () => {
    leak(world);
    tick(world);
    expect(hasEvent(world, SimEventKind.EnemyLeaked)).toBe(true);
    expect(hasEvent(world, SimEventKind.LifeLost)).toBe(true);
  });

  it('never drives lives below zero', () => {
    world.resources.lives = 1;
    leak(world, 'chitin_mother');
    tick(world);
    expect(world.resources.lives).toBe(0);
  });

  it('collects several leaks in one tick', () => {
    for (let i = 0; i < 3; i++) leak(world);
    tick(world);
    expect(world.stats.enemiesLeaked).toBe(3);
    expect(world.enemies.count).toBe(0);
  });
});

describe('defeat', () => {
  it('fires on the exact tick the last life is lost, not before', () => {
    const world = freshWorld();
    world.resources.lives = 2;

    leak(world);
    tick(world);
    expect(world.phase).not.toBe(StagePhase.Lost);
    expect(world.resources.lives).toBe(1);

    leak(world);
    tick(world);
    expect(world.phase).toBe(StagePhase.Lost);
    expect(hasEvent(world, SimEventKind.StageLost)).toBe(true);
  });

  it('stops the simulation once lost', () => {
    const world = freshWorld();
    world.resources.lives = 1;
    leak(world);
    tick(world);

    const at = world.tick;
    advance(world, 100);
    expect(world.tick).toBe(at);
  });

  it('records when it ended, for the clock', () => {
    const world = freshWorld();
    advance(world, 50);
    world.resources.lives = 1;
    leak(world);
    tick(world);

    expect(world.stats.finishedAtTick).toBe(51);
  });

  /**
   * A leak that empties the pool on the same tick the final wave clears is
   * still a loss. The enemy reached the core; that it was the last one on the
   * board does not undo it.
   */
  it('loses rather than wins when both conditions land on one tick', () => {
    const world = freshWorld();
    world.phase = StagePhase.Running;
    world.wave.cleared = world.rules.waves.count;
    world.resources.lives = 1;

    leak(world);
    tick(world);
    expect(world.phase).toBe(StagePhase.Lost);
  });
});

describe('victory', () => {
  it('fires once every wave is cleared', () => {
    const world = freshWorld();
    playPerfectly(world);

    expect(world.phase).toBe(StagePhase.Won);
    expect(world.wave.cleared).toBe(world.rules.waves.count);
    expect(hasEvent(world, SimEventKind.StageWon)).toBe(true);
  });

  it('does not fire while a wave is still outstanding', () => {
    const world = freshWorld();
    startWave(world, 0);
    advance(world, 30);
    expect(world.phase).toBe(StagePhase.Running);
  });

  /* Not one tick early: enemies still on the board mean the wave is not
     cleared, whatever the spawner has finished releasing. */
  it('does not fire while enemies remain', () => {
    const world = freshWorld();
    world.phase = StagePhase.Running;
    world.wave.cleared = world.rules.waves.count - 1;
    spawnEnemy(world, enemyIndex(world, 'husk'), 0);

    tick(world);
    expect(world.phase).toBe(StagePhase.Running);
  });

  it('stops the simulation once won', () => {
    const world = freshWorld();
    playPerfectly(world);
    const at = world.tick;
    advance(world, 100);
    expect(world.tick).toBe(at);
  });
});

describe('stars', () => {
  const won = (livesRemaining: number): World => {
    const world = freshWorld();
    world.phase = StagePhase.Won;
    world.resources.lives = livesRemaining;
    return world;
  };

  it('awards three for losing nothing', () => {
    expect(starsFor(won(stage.lives))).toBe(3);
  });

  it('awards two at the authored fraction', () => {
    const threshold = Math.ceil(stage.lives * tuning.twoStarLivesFraction);
    expect(starsFor(won(threshold))).toBe(2);
    expect(starsFor(won(threshold - 1))).toBe(1);
  });

  it('awards one for surviving at all', () => {
    expect(starsFor(won(1))).toBe(1);
  });

  it('awards none for a loss, however many lives were left', () => {
    const world = freshWorld();
    world.phase = StagePhase.Lost;
    world.resources.lives = stage.lives;
    expect(starsFor(world)).toBe(0);
  });

  /* Expressed as a fraction, so the rule holds on Veteran and Impossible
     where fewer lives are granted. */
  it('scales to a difficulty with fewer lives', () => {
    const world = freshWorld();
    Object.assign(world.config, { lives: 10 });
    world.phase = StagePhase.Won;

    world.resources.lives = 10;
    expect(starsFor(world)).toBe(3);
    world.resources.lives = 6;
    expect(starsFor(world)).toBe(2);
    world.resources.lives = 2;
    expect(starsFor(world)).toBe(1);
  });
});

describe('the results payload', () => {
  it('reports a win with everything the screen needs', () => {
    const world = freshWorld();
    playPerfectly(world);
    const result = stageResult(world);

    expect(result.won).toBe(true);
    expect(result.stars).toBe(3);
    expect(result.livesRemaining).toBe(stage.lives);
    expect(result.startingLives).toBe(stage.lives);
    expect(result.wavesCleared).toBe(result.totalWaves);
    expect(result.enemiesKilled).toBeGreaterThan(0);
    expect(result.enemiesLeaked).toBe(0);
    expect(result.goldEarned).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  it('reports a loss with how far the player got', () => {
    const world = freshWorld();
    world.resources.lives = 1;
    leak(world);
    tick(world);

    const result = stageResult(world);
    expect(result.won).toBe(false);
    expect(result.stars).toBe(0);
    expect(result.enemiesLeaked).toBe(1);
  });

  it('counts towers built and gold earned, but not a refund as income', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.damage.push(slot, 1e9, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);

    const bounty = registry.enemies.get('husk')!.bounty;
    expect(world.stats.goldEarned).toBe(bounty);
    expect(world.stats.enemiesKilled).toBe(1);
  });

  it('measures the clock from the tick it ended, not from when it is read', () => {
    const world = freshWorld();
    playPerfectly(world);
    const first = stageResult(world).durationSeconds;
    advance(world, 500);
    expect(stageResult(world).durationSeconds).toBe(first);
  });
});

describe('restarting', () => {
  /* One tap, no penalty, and nothing bleeding between attempts
     (docs/GAME_DESIGN.md §17.3). */
  it('returns a finished stage to its exact starting fingerprint', () => {
    const world = freshWorld();
    const pristine = hashWorld(world);

    playPerfectly(world);
    expect(hashWorld(world)).not.toBe(pristine);

    world.reset();
    expect(hashWorld(world)).toBe(pristine);
  });

  it('clears the statistics as well as the board', () => {
    const world = freshWorld();
    playPerfectly(world);
    world.reset();

    expect(world.stats.enemiesKilled).toBe(0);
    expect(world.stats.goldEarned).toBe(0);
    expect(world.stats.finishedAtTick).toBe(-1);
    expect(world.phase).toBe(StagePhase.Building);
  });

  it('plays out identically on a retry', () => {
    const world = freshWorld(777);
    playPerfectly(world);
    const first = stageResult(world);

    world.reset();
    playPerfectly(world);
    expect(stageResult(world)).toEqual(first);
  });
});
