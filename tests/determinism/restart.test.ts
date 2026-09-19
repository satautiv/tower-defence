import { describe, expect, it } from 'vitest';
import { loadContent } from '@content/load';
import { GameSession } from '@app/session';
import { buildTower, callWave, hashWorld, plotInfo, setSpeed, tick } from '@sim/index';
import type { World } from '@sim/index';

/**
 * Restart (#28, docs/GAME_DESIGN.md §17.3): one tap, no confirmation, no
 * loading screen over 500ms — and it must fully reset, with nothing carried
 * over from the run it replaces.
 *
 * "Fully" is checked the strict way: a restarted world must be the same world
 * a fresh one is, not merely one that looks reset. Anything left behind —
 * entity ids still counting, a stray timer, the RNG where the last run left
 * it — would make the second attempt play differently from the first, which
 * is exactly the unfairness a restart must not introduce.
 */

const SEED = 20260919;
const FRAME_MS = 1000 / 60;

const stage = loadContent().stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');
const newSession = (): GameSession => new GameSession(stage as NonNullable<typeof stage>, SEED);

/** The same inputs every time: one tower, an early call, then a stretch of play. */
function playSomeOf(world: World, ticks: number): void {
  const plot = plotInfo(world)[2];
  if (plot !== undefined) buildTower(world.commands, plot.id, 0);
  callWave(world.commands);
  for (let t = 0; t < ticks; t++) {
    tick(world);
    world.events.clear();
  }
}

/** Plays a session through frames on a synthetic clock, as the game does. */
function drive(session: GameSession, fromMs: number, frames: number): number {
  let now = fromMs;
  for (let frame = 0; frame < frames && !session.world.finished; frame++) {
    now += FRAME_MS;
    session.update(now);
    session.clearEvents();
  }
  return now;
}

describe('a restarted world is a fresh world', () => {
  it('matches one never played, straight after the reset', () => {
    const played = newSession().world;
    playSomeOf(played, 1500);
    played.reset();

    expect(hashWorld(played)).toBe(hashWorld(newSession().world));
  });

  /* The part a hash of the reset state alone cannot show: nothing left behind
     that only matters once play resumes. */
  it('plays on exactly as a fresh one does', () => {
    const played = newSession().world;
    playSomeOf(played, 1500);
    played.reset();
    const fresh = newSession().world;

    playSomeOf(played, 2500);
    playSomeOf(fresh, 2500);
    expect(hashWorld(played)).toBe(hashWorld(fresh));
  });

  it('forgets a run that was lost', () => {
    const session = newSession();
    session.start(0);
    drive(session, 0, 60 * 60 * 5);
    expect(session.world.finished).toBe(true);

    session.restart();
    expect(session.world.finished).toBe(false);
    expect(hashWorld(session.world)).toBe(hashWorld(newSession().world));
  });
});

describe('restarting a session', () => {
  it('unpauses, and runs from the first tick again', () => {
    const session = newSession();
    session.start(0);
    let now = drive(session, 0, 600);
    session.setPaused(true);
    now = drive(session, now, 60);

    session.restart();
    expect(session.isPaused).toBe(false);
    drive(session, now, 10);
    expect(session.world.tick).toBeGreaterThan(0);
    expect(session.world.tick).toBeLessThanOrEqual(10);
  });

  /* Speed is part of the world, and a restart is a fresh stage. Keeping the
     player's speed across stages is a separate item on #28. */
  it('resets speed along with everything else', () => {
    const session = newSession();
    session.start(0);
    session.dispatch((queue) => setSpeed(queue, 3));
    drive(session, 0, 5);
    expect(session.world.speed).toBe(3);

    session.restart();
    expect(session.world.speed).toBe(1);
  });

  /* The budget is 500ms of visible loading; the reset itself should not come
     close, since it reuses every allocation rather than building a stage. */
  it('takes a small fraction of the loading budget', () => {
    const session = newSession();
    session.start(0);
    drive(session, 0, 3000);

    const started = performance.now();
    session.restart();
    expect(performance.now() - started).toBeLessThan(50);
  });
});
