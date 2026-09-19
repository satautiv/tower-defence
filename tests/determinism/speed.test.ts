import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import type { GameSpeed } from '@core/constants';
import { loadContent } from '@content/load';
import { GameSession } from '@app/session';
import {
  buildOptions,
  buildTower,
  callWave,
  hashWorld,
  plotInfo,
  setSpeed,
  stageResult,
  upgradeTower,
} from '@sim/index';
import type { StageResult, World } from '@sim/index';

/**
 * Speed changes how many ticks run per frame, never what a tick does
 * (docs/GAME_DESIGN.md §15.3). #28 states it as a correctness test rather than
 * an approximation: a stage played at 1x and at 3x ends byte-identical.
 *
 * Played through GameSession, the route the game itself takes, with frames
 * advancing a synthetic clock. The player acts on exact ticks through the
 * session's per-tick hook, so its inputs land at the same moments whatever the
 * speed — which is the premise: the same inputs at the same ticks.
 */

const SEED = 20260919;
const FRAME_MS = 1000 / 60;
const MAX_FRAMES = TICK_HZ * 900;

const stage = loadContent().stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

/**
 * Fills plots with the dearest affordable tower, then upgrades, and calls each
 * wave as the last clears — so the run stacks waves and exercises combat,
 * economy and the spawner rather than idling to a loss.
 */
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

function play(speedAt: (frame: number) => GameSpeed): Run {
  const session = new GameSession(stage as NonNullable<typeof stage>, SEED);
  const world = session.world;
  const player = scriptedPlayer(world);
  let requested: GameSpeed = 1;

  session.start(0);
  let frame = 1;
  for (; frame < MAX_FRAMES && !world.finished; frame++) {
    const wanted = speedAt(frame);
    if (wanted !== requested) {
      session.dispatch((queue) => setSpeed(queue, wanted));
      requested = wanted;
    }
    session.update(frame * FRAME_MS, player);
    session.clearEvents();
  }
  return { world, frames: frame, result: stageResult(world) };
}

/** Everything but the speed setting, which is the one thing meant to differ. */
function gameState(world: World): string {
  const speed = world.speed;
  world.speed = 1;
  const hash = hashWorld(world);
  world.speed = speed;
  return hash;
}

describe('speed changes how fast a stage plays, never how it plays out', () => {
  const atOne = play(() => 1);

  it('plays the stage to an outcome, with a board that fights', () => {
    expect(atOne.world.finished).toBe(true);
    expect(atOne.result.towersBuilt).toBeGreaterThan(0);
    expect(atOne.result.enemiesKilled).toBeGreaterThan(0);
  });

  it('ends byte-identical at 3x', () => {
    const atThree = play(() => 3);

    expect(atThree.world.tick).toBe(atOne.world.tick);
    expect(atThree.result).toEqual(atOne.result);
    expect(gameState(atThree.world)).toBe(gameState(atOne.world));
    /* And it really was faster, or the comparison proves nothing. */
    expect(atThree.frames).toBeLessThan(atOne.frames / 2.5);
  });

  it('ends byte-identical when the speed changes mid-stage', () => {
    /* The scripted board wins 1-1 in under 6,000 ticks, so every speed is in
       play well before the end: 1,000 ticks at 1x, 2,400 at 3x, the rest at 2x. */
    const mixed = play((frame) => (frame < 1000 ? 1 : frame < 1800 ? 3 : 2));

    expect(mixed.world.tick).toBe(atOne.world.tick);
    expect(mixed.result).toEqual(atOne.result);
    expect(gameState(mixed.world)).toBe(gameState(atOne.world));
    expect(mixed.world.speed).toBe(2);
  });
});
