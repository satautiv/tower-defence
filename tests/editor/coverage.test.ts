import { describe, expect, it } from 'vitest';
import { addPlot, emptyDraft, removePlot } from '@editor/draft';
import type { Draft } from '@editor/draft';
import { coverageOf } from '@editor/coverage';

/**
 * Coverage analysis (#34).
 *
 * The issue names one acceptance criterion for it — *"the coverage heatmap
 * catches an unreachable path segment"* — so that is what most of this file
 * checks, and it checks it by building a map with a hole in it rather than by
 * asserting the function returns an array.
 */

/** A straight road from (0,8) to (29,8), and no plots at all. */
function bareRoad(): Draft {
  const draft = emptyDraft('9-9', 'stage.9_9.name');
  let stage: Draft = draft;
  for (const plot of [...draft.plots]) stage = removePlot(stage, plot.id);
  /* One plot survives by design; park it far off the road. */
  return { ...stage, plots: [{ id: 0, position: { x: 0, y: 0 } }] };
}

describe('coverage is measured along the road, not over the map', () => {
  it('reports the whole road uncovered when nothing reaches it', () => {
    const result = coverageOf(bareRoad(), 0, 3);

    expect(result.covered).toBe(0);
    expect(result.maxPlots).toBe(0);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]?.fromTiles).toBeCloseTo(0, 1);
    expect(result.gaps[0]?.toTiles).toBeCloseTo(29, 0);
  });

  it('reports the whole road covered when one plot reaches all of it', () => {
    const stage = { ...bareRoad(), plots: [{ id: 0, position: { x: 15, y: 8 } }] };
    const result = coverageOf(stage, 0, 40);

    expect(result.covered).toBe(1);
    expect(result.gaps).toEqual([]);
    expect(result.minPlots).toBeGreaterThan(0);
  });

  /**
   * The criterion, stated as a map: two plots at either end with a hole in the
   * middle. A stage like this looks finished in an editor and is unwinnable in
   * play, which is exactly the class of bug this exists to catch.
   */
  it('finds the hole between two plots that do not meet', () => {
    const stage = {
      ...bareRoad(),
      plots: [
        { id: 0, position: { x: 3, y: 8 } },
        { id: 1, position: { x: 26, y: 8 } },
      ],
    };
    const result = coverageOf(stage, 0, 4);

    expect(result.gaps).toHaveLength(1);
    const gap = result.gaps[0];
    expect(gap?.fromTiles).toBeGreaterThan(6);
    expect(gap?.toTiles).toBeLessThan(23);
    expect(result.covered).toBeLessThan(1);
    expect(result.covered).toBeGreaterThan(0);
  });

  it('closes that hole when a plot is put in it', () => {
    const stage = {
      ...bareRoad(),
      plots: [
        { id: 0, position: { x: 3, y: 8 } },
        { id: 1, position: { x: 26, y: 8 } },
      ],
    };
    const patched = addPlot(addPlot(stage, { x: 11, y: 8 }), { x: 19, y: 8 });

    expect(coverageOf(patched, 0, 5).gaps).toEqual([]);
  });

  /* "Is this covered" has no answer independent of what is standing there. A
     Sniper Nest reaches 14 tiles and an Alchemist's Still 6. */
  it('answers differently for a longer reach', () => {
    const stage = {
      ...bareRoad(),
      plots: [
        { id: 0, position: { x: 3, y: 8 } },
        { id: 1, position: { x: 26, y: 8 } },
      ],
    };

    expect(coverageOf(stage, 0, 4).gaps).toHaveLength(1);
    expect(coverageOf(stage, 0, 14).gaps).toEqual([]);
  });

  it('counts overlapping plots, which is how an overpowered stretch shows up', () => {
    const stage = {
      ...bareRoad(),
      plots: [
        { id: 0, position: { x: 14, y: 8 } },
        { id: 1, position: { x: 15, y: 8 } },
        { id: 2, position: { x: 16, y: 8 } },
      ],
    };
    expect(coverageOf(stage, 0, 5).maxPlots).toBe(3);
  });

  /* A gap that runs off the end of the road still has to end somewhere, or the
     panel draws a range with an undefined edge. */
  it('closes a gap that reaches the end of the road', () => {
    const stage = { ...bareRoad(), plots: [{ id: 0, position: { x: 2, y: 8 } }] };
    const result = coverageOf(stage, 0, 4);

    const last = result.gaps[result.gaps.length - 1];
    expect(last?.toTiles).toBeCloseTo(29, 0);
    expect(Number.isFinite(last?.toTiles ?? NaN)).toBe(true);
  });

  it('says nothing at all about a path that is not there', () => {
    expect(coverageOf(bareRoad(), 42, 5).samples).toEqual([]);
  });
});
