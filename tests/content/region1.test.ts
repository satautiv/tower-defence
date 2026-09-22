import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { compareStageIds } from '@content/stages';
import { readContentFromDisk } from '../../tools/content/io.js';
import { coverageOf } from '@editor/coverage';

/**
 * Region 1's map authoring rules (#36, docs/GAME_DESIGN.md §12.3).
 *
 * §12.3 is a list of rules in prose, which means it is a list of rules nobody
 * re-checks. Here instead, so authoring an eleventh stage — or editing one of
 * these ten — is held to the same shape. Each rule names the section it comes
 * from, because a bare number invites someone to nudge it until the test stops
 * failing, which is the one thing these must not allow.
 */

const registry = buildRegistry(readContentFromDisk());
const region1 = [...registry.stages.values()]
  .filter((stage) => stage.region === 1)
  .sort((a, b) => compareStageIds(a.id, b.id));

const ids = region1.map((stage) => stage.id);

describe('Region 1 is ten stages', () => {
  it('has all ten, in order', () => {
    expect(ids).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5', '1-6', '1-7', '1-8', '1-9', '1-10']);
  });
});

describe.each(region1.map((stage) => [stage.id, stage] as const))('%s', (id, stage) => {
  /* §12.3: 12–20 build plots, of which 2–4 are ley nodes. */
  it('has between twelve and twenty plots', () => {
    expect(stage.plots.length).toBeGreaterThanOrEqual(12);
    expect(stage.plots.length).toBeLessThanOrEqual(20);
  });

  it('has two to four ley nodes', () => {
    const ley = stage.plots.filter((plot) => plot.leyNode !== undefined).length;
    expect(ley).toBeGreaterThanOrEqual(2);
    expect(ley).toBeLessThanOrEqual(4);
  });

  it('has one to three ground paths', () => {
    expect(stage.paths.length).toBeGreaterThanOrEqual(1);
    expect(stage.paths.length).toBeLessThanOrEqual(3);
  });

  /* §12.3: one environmental interactable per map — "cheap to build, huge for
     map identity". A region of ten stages sharing one lever has nine stages
     with no identity. */
  it('has an environmental interactable of its own', () => {
    expect(stage.interactable).toBeDefined();
  });

  /* §12.3: at least one plot that covers two path segments — the premium plot
     worth fighting for. Measured against the road rather than asserted, so it
     stays true when someone drags a plot. */
  it('has a premium plot that covers two separate stretches of road', () => {
    const best = Math.max(...stage.plots.map((plot) => stretchesCovered(stage, plot.position, 7)));
    expect(best, 'no plot sees two separate stretches').toBeGreaterThanOrEqual(2);
  });

  /* §12.3: at least one plot clearly bad for short range and good for a
     Mortar or a Sniper. "Clearly" is the point — a plot that a short tower
     covers almost as well is not that plot. */
  it('has a plot that only a long reach makes worth taking', () => {
    const short = stage.plots.map((plot) => reachedAt(stage, plot.position, 5));
    const long = stage.plots.map((plot) => reachedAt(stage, plot.position, 11));
    const gains = stage.plots.map((_, i) => (long[i] as number) - (short[i] as number));
    expect(Math.max(...gains), 'no plot rewards a long reach').toBeGreaterThan(0.25);
  });

  /* Every stretch of every road must be shootable from somewhere, or the
     stage is unwinnable in a way that is invisible in an editor. */
  it('leaves no stretch of any road uncovered', () => {
    for (const path of stage.paths) {
      const coverage = coverageOf(stage, path.id, 7);
      const real = coverage.gaps.filter((gap) => gap.toTiles - gap.fromTiles > 1);
      expect(real, `path ${path.id}: ${JSON.stringify(real)}`).toEqual([]);
    }
  });

  it('keeps every plot, path point and the core on the map', () => {
    const inside = (p: { x: number; y: number }) =>
      p.x >= 0 && p.y >= 0 && p.x <= stage.widthTiles && p.y <= stage.heightTiles;

    expect(inside(stage.core)).toBe(true);
    for (const plot of stage.plots) expect(inside(plot.position), `plot ${plot.id}`).toBe(true);
    for (const path of stage.paths) {
      for (const point of path.points) expect(inside(point), `path ${path.id}`).toBe(true);
    }
  });

  /* §12.2's difficulty curve, as wave counts. */
  it('carries the wave count its place in the curve calls for', () => {
    const index = Number(id.split('-')[1]);
    const [low, high] = index <= 3 ? [10, 12] : index <= 7 ? [12, 15] : [15, 18];
    expect(stage.waves.length).toBeGreaterThanOrEqual(low);
    expect(stage.waves.length).toBeLessThanOrEqual(high);
  });

  it('names every wave group an enemy that exists', () => {
    for (const wave of stage.waves) {
      for (const group of wave.groups) {
        expect(registry.enemies.has(group.enemy), group.enemy).toBe(true);
      }
    }
  });

  it('sends every wave group from a spawn point it has', () => {
    const spawns = new Set(stage.spawnPoints.map((spawn) => spawn.id));
    for (const wave of stage.waves) {
      for (const group of wave.groups) expect(spawns.has(group.spawnPoint)).toBe(true);
    }
  });
});

/**
 * §12.3 wants flyer lanes that do **not** trace the ground path — a board that
 * covers the road must not cover the air for free. A flyer's route is a
 * straight line from its spawn to the core, so the rule is about where the
 * spawn is, and a stage with air in its waves has to have one of its own.
 */
describe('air does not follow the road', () => {
  it.each(region1.filter((stage) => usesAir(stage)).map((s) => [s.id, s] as const))(
    '%s sends its flyers from a spawn off the road',
    (_id, stage) => {
      const airSpawns = new Set(
        stage.waves.flatMap((wave) =>
          wave.groups
            .filter((group) => registry.enemies.get(group.enemy)?.traits.includes('flying'))
            .map((group) => group.spawnPoint),
        ),
      );
      expect(airSpawns.size, 'no air groups found').toBeGreaterThan(0);

      for (const id of airSpawns) {
        const spawn = stage.spawnPoints.find((candidate) => candidate.id === id);
        if (spawn === undefined) throw new Error(`stage ${stage.id}: no spawn ${id}`);

        /* Far enough from every road start that the flight is its own line. */
        const nearest = Math.min(
          ...stage.paths.map((path) => {
            const head = path.points[0] as { x: number; y: number };
            return Math.hypot(head.x - spawn.position.x, head.y - spawn.position.y);
          }),
        );
        expect(nearest, `spawn ${id} sits on a road head`).toBeGreaterThan(1.5);
      }
    },
  );
});

/* ---- helpers, all measured against the stage rather than asserted ---- */

function usesAir(stage: (typeof region1)[number]): boolean {
  return stage.waves.some((wave) =>
    wave.groups.some((group) => registry.enemies.get(group.enemy)?.traits.includes('flying')),
  );
}

/** Fraction of the longest road a plot can reach at a given range. */
function reachedAt(
  stage: (typeof region1)[number],
  at: { x: number; y: number },
  rangeTiles: number,
): number {
  let best = 0;
  for (const path of stage.paths) {
    const coverage = coverageOf(
      { ...stage, plots: [{ id: 0, position: at }] },
      path.id,
      rangeTiles,
    );
    if (coverage.covered > best) best = coverage.covered;
  }
  return best;
}

/**
 * How many *separate* stretches of road one plot covers.
 *
 * Separate is the whole point: a plot beside a straight run covers one long
 * stretch, and a plot in the crook of a switchback covers two. The second is
 * the premium plot §12.3 asks every map to have.
 */
function stretchesCovered(
  stage: (typeof region1)[number],
  at: { x: number; y: number },
  rangeTiles: number,
): number {
  let most = 0;
  for (const path of stage.paths) {
    const coverage = coverageOf(
      { ...stage, plots: [{ id: 0, position: at }] },
      path.id,
      rangeTiles,
    );
    let runs = 0;
    let inside = false;
    for (const sample of coverage.samples) {
      const covered = sample.plots > 0;
      if (covered && !inside) runs++;
      inside = covered;
    }
    if (runs > most) most = runs;
  }
  return most;
}
