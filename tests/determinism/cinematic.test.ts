import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { loadContent } from '@content/load';
import { GameSession } from '@app/session';
import {
  buildOptions,
  buildTower,
  callWave,
  hashWorld,
  plotInfo,
  stageResult,
  upgradeTower,
} from '@sim/index';
import type { StageResult, World } from '@sim/index';

/**
 * The defeat sequence changes when ticks run, never which ticks run (#33).
 *
 * Hitstop and slow-motion are the first thing in the game that touches the
 * clock for a reason other than the player asking, so they are the first thing
 * that could quietly break replays, bug reproduction and the balance
 * simulator. The claim is the same one speed makes and is tested the same way:
 * a stage played with the sequence firing repeatedly ends byte-identical to
 * one played without, and takes visibly longer in frames to get there.
 */

const SEED = 20260921;
const FRAME_MS = 1000 / 60;
const MAX_FRAMES = TICK_HZ * 900;

const stage = loadContent().stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

/** The same greedy board the speed suite uses, so the run actually fights. */
function scriptedPlayer(world: World): () => void {
  let cleared = 0;
  return () => {
    if (world.tick % 30 === 0) {
      const plots = plotInfo(world);
      const affordable = buildOptions(world)
        .filter((option) => option.affordable)
        .sort((a, b) => b.cost - a.cost);
      const empty = plots.find((plot) => plot.occupiedBy < 0);
      const best = affordable[0];

      if (empty !== undefined && best !== undefined) {
        buildTower(world.commands, empty.id, best.typeIdx);
      } else {
        const built = plots.find((plot) => plot.occupiedBy >= 0);
        if (built !== undefined) upgradeTower(world.commands, built.occupiedBy);
      }
    }
    if (world.wave.cleared > cleared) {
      cleared = world.wave.cleared;
      callWave(world.commands);
    }
  };
}

interface Run {
  world: World;
  frames: number;
  result: StageResult;
}

/** `every` frames apart, or never when zero. */
function play(every: number): Run {
  const session = new GameSession(stage as NonNullable<typeof stage>, SEED);
  const world = session.world;
  const player = scriptedPlayer(world);

  session.start(0);
  let frame = 1;
  for (; frame < MAX_FRAMES && !world.finished; frame++) {
    const now = frame * FRAME_MS;
    if (every > 0 && frame % every === 0) session.playDefeatSequence(now);
    session.update(now, player);
    session.clearEvents();
  }
  return { world, frames: frame, result: stageResult(world) };
}

describe('a boss death slows the picture, not the simulation', () => {
  const plain = play(0);

  it('plays the stage to an outcome, with a board that fights', () => {
    expect(plain.world.finished).toBe(true);
    expect(plain.result.enemiesKilled).toBeGreaterThan(0);
  });

  it('ends byte-identical with the sequence firing throughout', () => {
    /* Every 200 frames, so hitstop and slow-motion are both in play for most
       of the run rather than once at the end. */
    const held = play(200);

    expect(held.world.tick).toBe(plain.world.tick);
    expect(held.result).toEqual(plain.result);
    expect(hashWorld(held.world)).toBe(hashWorld(plain.world));
    /* And it really did hold the board, or the comparison proves nothing. */
    expect(held.frames).toBeGreaterThan(plain.frames * 1.2);
  });
});
