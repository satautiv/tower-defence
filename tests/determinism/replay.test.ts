import { describe, expect, it } from 'vitest';
import { Rng } from '@core/rng';
import { loadContent } from '@content/load';
import {
  CommandKind,
  ReplayRecorder,
  buildTower,
  callWave,
  createWorldForStage,
  hashWorld,
  playReplay,
  setSpeed,
  tick,
  towerIndex,
  upgradeTower,
} from '@sim/index';
import type { Replay, World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * A replay is a seed and an ordered command list (#41).
 *
 * > A recorded replay reproduces a run exactly.
 *
 * That claim rests on three properties this project already paid for and did
 * not, until now, use together: nothing outside the simulation mutates the
 * world, every intent arrives as a command, and commands are applied at a tick
 * boundary rather than mid-pipeline. If any of them ever stops holding, this
 * file fails — which makes it a guard on the design and not only on the
 * replay code.
 *
 * "Exactly" is `hashWorld`, and it is checked *throughout* the run rather than
 * only at the end. A run that diverged at tick 300 and re-converged by tick 900
 * would pass an end-state comparison and be worthless as a bug report.
 */

const SEED = 20260923;
const registry = loadContent();
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const fresh = (seed = SEED): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

/**
 * Plays a varied run, recording as it goes.
 *
 * Varied on purpose: a replay of a world nobody touched proves only that two
 * idle simulations agree. Commands are chosen from a *seeded* stream, so the
 * run is busy and still reproducible from this file alone.
 */
function playAndRecord(ticks: number): { world: World; replay: Replay; hashes: string[] } {
  const world = fresh();
  const recorder = new ReplayRecorder();
  const rng = new Rng(99);
  const hashes: string[] = [];
  const plots = world.rules.plots;
  const towers = world.rules.towers.ids;

  for (let t = 0; t < ticks; t++) {
    /* Roughly twice a second, the same cadence the scripted strategies use. */
    if (t % 30 === 0) {
      const roll = rng.next();
      if (roll < 0.5) {
        const plot = plots[Math.floor(rng.next() * plots.length)];
        const type = Math.floor(rng.next() * towers.length);
        if (plot !== undefined) buildTower(world.commands, plot.id, type);
      } else if (roll < 0.7) {
        callWave(world.commands);
      } else if (roll < 0.85) {
        upgradeTower(world.commands, 0);
      } else {
        setSpeed(world.commands, roll < 0.95 ? 2 : 1);
      }
    }

    recorder.observe(world);
    tick(world);
    world.events.clear();
    hashes.push(hashWorld(world));
    if (world.finished) break;
  }

  return {
    world,
    replay: recorder.finish({ stageId: stage!.id, progressStageId: '1-10' }, SEED),
    hashes,
  };
}

describe('a run replays exactly', () => {
  const played = playAndRecord(2400);

  it('recorded something worth replaying', () => {
    /* The failure this guards: a fixture that proves nothing because the run
       it recorded was empty. */
    expect(played.replay.commands.length).toBeGreaterThan(20);
    expect(played.replay.ticks).toBeGreaterThan(1000);
    expect(new Set(played.replay.commands.map((c) => c.kind)).size).toBeGreaterThan(2);
    expect(played.world.stats.towersBuilt).toBeGreaterThan(0);
    expect(played.world.stats.enemiesKilled).toBeGreaterThan(0);
  });

  it('agrees with the original at every tick, not only at the end', () => {
    const replayed = fresh();
    const seen: string[] = [];

    /* Re-runs the playback loop by hand so a hash can be taken per tick. The
       shipped `playReplay` is exercised whole in the next test. */
    let next = 0;
    for (let t = 0; t < played.replay.ticks; t++) {
      while (next < played.replay.commands.length) {
        const command = played.replay.commands[next];
        if (command === undefined || command.tick > t) break;
        replayed.commands.push(command.kind, command.a, command.b, command.c, command.d, command.e);
        next++;
      }
      tick(replayed);
      replayed.events.clear();
      seen.push(hashWorld(replayed));
      if (replayed.finished) break;
    }

    expect(seen.length).toBe(played.hashes.length);
    const diverged = seen.findIndex((hash, i) => hash !== played.hashes[i]);
    expect(diverged, `diverged at tick ${diverged}`).toBe(-1);
  });

  it('ends on the same world through the shipped player', () => {
    const replayed = fresh();
    playReplay(replayed, played.replay, stage!.id);
    expect(hashWorld(replayed)).toBe(hashWorld(played.world));
  });

  /* The stats a results screen reports are part of "exactly". */
  it('reproduces what the run scored', () => {
    const replayed = fresh();
    playReplay(replayed, played.replay, stage!.id);
    expect(replayed.stats).toEqual(played.world.stats);
    expect(replayed.resources).toEqual(played.world.resources);
  });
});

describe('a replay that does not belong here', () => {
  it('refuses another stage', () => {
    const replay = { ...playAndRecord(120).replay, stageId: '1-7' };
    expect(() => playReplay(fresh(), replay, '1-1')).toThrow(/stage 1-7/);
  });

  /* The whole point of a seed: the same commands against a different one is a
     different run, and would replay into something that merely looks like the
     original. */
  it('refuses another seed', () => {
    const played = playAndRecord(120);
    expect(() => playReplay(fresh(SEED + 1), played.replay, '1-1')).toThrow(/seed/);
  });
});

describe('the recorder', () => {
  it('captures every payload slot a command carries', () => {
    const world = fresh();
    const recorder = new ReplayRecorder();
    /* Build carries a plot, a type and a target mode — three slots, and a
       recorder that dropped one would replay a tower aimed elsewhere. */
    buildTower(world.commands, world.rules.plots[0]!.id, towerIndex(world, 'frost_cairn'), 2);
    recorder.observe(world);

    const [only] = recorder.finish({ stageId: '1-1' }, SEED).commands;
    expect(only).toMatchObject({
      tick: 0,
      kind: CommandKind.BuildTower,
      a: world.rules.plots[0]!.id,
      b: towerIndex(world, 'frost_cairn'),
      c: 2,
    });
  });

  it('forgets everything on reset, so a retry is a new recording', () => {
    const world = fresh();
    const recorder = new ReplayRecorder();
    callWave(world.commands);
    recorder.observe(world);
    expect(recorder.count).toBe(1);

    recorder.reset();
    expect(recorder.count).toBe(0);
    expect(recorder.finish({ stageId: '1-1' }, SEED).ticks).toBe(1);
  });
});
