import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { giveGold, setLives, skipWave, unlockEverything } from '@sim/cheats';
import { SimEventKind, createWorldForStage, startWave, tick } from '@sim/index';
import type { World } from '@sim/index';

/**
 * The dev overlay's cheats (#41).
 *
 * Tested for one thing above all: that each of them sets up state and lets the
 * ordinary systems draw the conclusion, rather than reimplementing them. A
 * cheat that clears a wave by hand-crediting the bonus would drift from
 * `completeWave` the first time the bonus changed shape, and the drift would
 * show up as a debugging session chasing a number the game never actually
 * pays.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const fresh = (): World => createWorldForStage(registry, stage, 11);

/** Runs until the predicate holds, or gives up. Stops a hang becoming a stall. */
function runUntil(world: World, done: (w: World) => boolean, limit = 4_000): boolean {
  for (let i = 0; i < limit; i++) {
    if (done(world)) return true;
    tick(world);
  }
  return done(world);
}

describe('gold and lives', () => {
  it('adds gold', () => {
    const world = fresh();
    const before = world.resources.gold;
    giveGold(world, 1_000);
    expect(world.resources.gold).toBe(before + 1_000);
  });

  /* Taking gold away is as useful as giving it — "can this be built at 40
     gold" is a question — and it must not go negative, which the economy
     treats as an enormous purse rather than a debt. */
  it('clamps at zero rather than going into debt', () => {
    const world = fresh();
    giveGold(world, -1_000_000);
    expect(world.resources.gold).toBe(0);
  });

  it('sets lives rather than adding them', () => {
    const world = fresh();
    setLives(world, 1);
    expect(world.resources.lives).toBe(1);
    setLives(world, 99);
    expect(world.resources.lives).toBe(99);
  });
});

describe('unlocking everything', () => {
  /* Stage 1-1 opens with two towers of the eight; the rest arrive across the
     region. The cheat writes the same mask `placeTower` refuses on, so the
     build menu and the command handler agree without either learning about it. */
  it('opens every tower the stage had withheld', () => {
    const world = fresh();
    const unlocked = world.rules.towers.unlocked;
    expect([...unlocked].some((flag) => flag === 0)).toBe(true);

    unlockEverything(world);
    expect([...unlocked].every((flag) => flag === 1)).toBe(true);
  });
});

describe('skipping a wave', () => {
  it('does nothing, and says so, when no wave is running', () => {
    expect(skipWave(fresh())).toBe(false);
  });

  /**
   * The load-bearing assertion. The cheat neither pays the bonus nor emits the
   * event: it marks the groups spawned and empties the board, and the wave
   * spawner completes the wave on the next tick through the path it always
   * uses — which is why the gold and the `WaveCleared` event are right without
   * this file knowing what either is worth.
   */
  it('lets the spawner complete the wave through its own path', () => {
    const world = fresh();
    startWave(world, 0);
    runUntil(world, (w) => w.enemies.count > 0);
    expect(world.enemies.count).toBeGreaterThan(0);

    const clearedBefore = world.wave.cleared;
    const goldBefore = world.resources.gold;
    expect(skipWave(world)).toBe(true);
    expect(world.enemies.count).toBe(0);

    tick(world);

    expect(world.wave.cleared).toBe(clearedBefore + 1);
    expect(world.resources.gold).toBe(goldBefore + (world.rules.waves.clearBonus[0] as number));

    let announced = false;
    for (let i = 0; i < world.events.count; i++) {
      if (world.events.at(i).kind === SimEventKind.WaveCleared) announced = true;
    }
    expect(announced).toBe(true);
  });

  /**
   * Freed, not killed.
   *
   * Killing them would pay bounty, split the splitters and drop the carriers'
   * cargo — which is the wave rather than a way past it, and would make the
   * cheat a source of gold nobody asked for.
   */
  it('pays no bounty for what it clears', () => {
    const world = fresh();
    startWave(world, 0);
    runUntil(world, (w) => w.enemies.count > 2);

    const killsBefore = world.stats.enemiesKilled;
    const goldBefore = world.resources.gold;
    skipWave(world);

    expect(world.stats.enemiesKilled).toBe(killsBefore);
    expect(world.resources.gold).toBe(goldBefore);
  });

  /* A soldier holding an enemy that vanishes releases itself on the next tick,
     the same as it does when its enemy dies — so nothing is left blocked by a
     slot that no longer holds anybody. */
  it('leaves no enemy blocked by a slot that no longer holds it', () => {
    const world = fresh();
    startWave(world, 0);
    runUntil(world, (w) => w.enemies.count > 0);
    skipWave(world);
    tick(world);

    const enemies = world.enemies;
    for (let slot = 0; slot < enemies.watermark; slot++) {
      if (!enemies.isAlive(slot)) continue;
      const blocker = enemies.blockedBy[slot] as number;
      if (blocker >= 0) expect(world.soldiers.isAlive(blocker)).toBe(true);
    }
  });
});
