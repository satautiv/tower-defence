import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { compareStageIds } from '@content/stages';
import { createWorldForStage } from '@sim/index';
import type { World } from '@sim/index';
import { MAX_GROUPS_PER_WAVE } from '@sim/capacity';
import { readContentFromDisk } from '../../tools/content/io.js';
import { runOnce } from '../../tools/balance-sim/runner.js';
import { strategyByName } from '../../tools/balance-sim/strategies.js';
import { FULL_ROSTER } from '../roster.js';

/**
 * Endless, and the question it exists to answer (#47).
 *
 * > Infinite escalating waves … must stay interesting, not become a pure
 * > stat wall.
 *
 * Health grows with the wave index whatever is sent, so a mode that cycled one
 * map's ten waves forever would eventually be the opening riftling with eight
 * times the health and no new question in it. Endless therefore draws its
 * repeats from the **whole region**: wave sixty on Emberfall Ridge is 1-9's
 * elites, which is a different fight rather than a bigger number. That claim is
 * what the composition tests below measure, and they measure it against the
 * resolved wave table rather than against the authoring, so a stage dragged
 * into a different order cannot quietly break it.
 *
 * The second half is how far a run actually goes. Measured with `endurance` —
 * the one scripted board that keeps spending after the plots are full — across
 * all ten maps at their authored thirty lives:
 *
 *     1-4 26 · 1-2 37 · 1-7 37 · 1-9 41 · 1-8 43 · 1-6 52 · 1-10 52 ·
 *     1-1 53 · 1-3 66 · 1-5 92
 *
 * Half the region runs past wave fifty on a board that reads no map, picks
 * no branch on merit and round-robins towers onto whatever plot is free. The
 * spread is the maps, not the mode, and it is the right shape for a
 * per-stage leaderboard: a score on 1-5 is not a score on 1-4.
 */

const registry = buildRegistry(readContentFromDisk());
const endless = [...registry.challenges.values()]
  .filter((c) => c.kind === 'endless')
  .sort((a, b) => compareStageIds(a.stageId, b.stageId));

/** Two hours of simulated play, which every run below ends well inside. */
const MAX_TICKS = TICK_HZ * 60 * 120;

function worldFor(stageId: string, challengeId: string, seed = 1): World {
  const stage = registry.stages.get(stageId);
  if (stage === undefined) throw new Error(`no stage ${stageId}`);
  return createWorldForStage(registry, stage, seed, { ...FULL_ROSTER, challengeId });
}

/** Enemy ids the resolved table sends between two wave indices. */
function typesIn(world: World, from: number, to: number): Set<string> {
  const seen = new Set<string>();
  for (let w = from; w < Math.min(to, world.rules.waves.count); w++) {
    for (let g = 0; g < (world.rules.waves.groupCount[w] as number); g++) {
      const idx = world.rules.waves.groupEnemy[w * MAX_GROUPS_PER_WAVE + g] as number;
      if (idx >= 0) seen.add(world.rules.enemies.ids[idx] as string);
    }
  }
  return seen;
}

describe('every map has an Endless run', () => {
  it('covers the region', () => {
    expect(endless.map((c) => c.stageId)).toEqual(
      [...registry.stages.keys()].sort(compareStageIds),
    );
  });

  it.each(endless.map((c) => [c.stageId, c] as const))('%s runs two hundred waves', (_id, c) => {
    expect(c.rules).toMatchObject({ waveLimit: 200, waveSource: 'region', lives: 30 });
    const world = worldFor(c.stageId, c.id);
    expect(world.rules.waves.count).toBe(200);
    expect(world.resources.lives).toBe(30);
  });
});

describe('Endless changes what it sends, not only how much health it has', () => {
  /**
   * The region's whole cast reaches every map.
   *
   * Stated as "at least", not "more than", because 1-10 already fields all
   * fifteen types the region has — it is the finale, and it was authored to
   * bring everything. Endless there varies *composition* rather than cast,
   * which the next test is what actually checks. The aggregate below keeps
   * that exception from quietly becoming the rule.
   */
  const gains: string[] = [];

  it.each(endless.map((c) => [c.stageId, c] as const))(
    '%s keeps everything the stage sends and adds the region on top',
    (stageId, challenge) => {
      const plain = worldFor(stageId, challenge.id);
      const own = typesIn(plain, 0, plain.rules.waves.count);

      const stage = registry.stages.get(stageId);
      if (stage === undefined) throw new Error('no stage');
      const authored = new Set(stage.waves.flatMap((w) => w.groups.map((g) => g.enemy)));

      for (const id of authored) expect(own.has(id)).toBe(true);
      expect(own.size).toBeGreaterThanOrEqual(authored.size);
      if (own.size > authored.size) gains.push(stageId);
    },
  );

  it('widens the cast on every map but the finale', () => {
    expect(gains.length).toBeGreaterThanOrEqual(endless.length - 1);
  });

  /* The specific failure this guards: a late Endless wave that is an early one
     with a bigger multiplier. */
  it.each(endless.map((c) => [c.stageId, c] as const))(
    '%s sends something past wave fifty that it never sent in the first ten',
    (stageId, challenge) => {
      const world = worldFor(stageId, challenge.id);
      const early = typesIn(world, 0, 10);
      const late = typesIn(world, 50, 100);
      const novel = [...late].filter((id) => !early.has(id));
      expect(novel.length).toBeGreaterThan(0);
    },
  );

  /**
   * Campaign order, not string order.
   *
   * "1-10" sorts before "1-5" as text, and the first draft did exactly that:
   * Grendrix arrived at Endless wave twenty on Emberfall Ridge and every run
   * ended there. The boss belongs where the campaign put it, which is after
   * the other nine maps have been through once.
   */
  it('reaches the region boss only after the region', () => {
    const first = endless[0];
    if (first === undefined) throw new Error('no Endless challenge');
    const world = worldFor(first.stageId, first.id);

    const stage = registry.stages.get(first.stageId);
    if (stage === undefined) throw new Error('no stage');
    /* 1-1 does not author Grendrix, so any appearance is a borrowed wave. */
    expect(typesIn(world, 0, stage.waves.length).has('grendrix')).toBe(false);

    let firstBoss = -1;
    for (let w = 0; w < world.rules.waves.count; w++) {
      if (typesIn(world, w, w + 1).has('grendrix')) {
        firstBoss = w;
        break;
      }
    }
    expect(firstBoss).toBeGreaterThan(100);
  });

  /* The borrowed waves name their own stage's spawn points, and this map may
     have fewer. Every index has to be one the stage actually has, or the
     spawner reads past the end of the list. */
  it.each(endless.map((c) => [c.stageId, c] as const))('%s spawns where it can', (_id, c) => {
    const world = worldFor(c.stageId, c.id);
    const points = world.rules.spawnPoints.length;
    expect(points).toBeGreaterThan(0);
    for (const point of world.rules.waves.groupSpawnPoint) {
      expect(point).toBeLessThan(points);
    }
  });
});

describe('how far a scripted board gets', () => {
  const reached = new Map<string, number>();

  it.each(endless.map((c) => [c.stageId, c] as const))('%s is a real run', (stageId, challenge) => {
    const world = worldFor(stageId, challenge.id);
    const result = runOnce(world, strategyByName('endurance', world), 1, { maxTicks: MAX_TICKS });
    reached.set(stageId, result.wavesCleared);

    /* Not a win and not a timeout: an Endless run ends by losing, which is
       what makes "how far did you get" the only score there is. */
    expect(result.won).toBe(false);
    expect(result.timedOut).toBe(false);

    const stage = registry.stages.get(stageId);
    if (stage === undefined) throw new Error('no stage');
    /* Comfortably past the stage's own length, or Endless is the campaign
       stage again with a different name on it. */
    expect(result.wavesCleared).toBeGreaterThan(stage.waves.length * 1.5);
  });

  it('carries half the region past wave fifty', () => {
    const scores = [...reached.values()].sort((a, b) => a - b);
    expect(scores).toHaveLength(endless.length);
    expect(scores.filter((wave) => wave > 50).length).toBeGreaterThanOrEqual(5);
    expect(scores[Math.floor(scores.length / 2)]).toBeGreaterThanOrEqual(40);
  });
});
