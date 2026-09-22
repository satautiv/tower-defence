import { TILE_SIZE } from '@core/constants';
import { BakedPath } from '@sim/index';
import type { Draft, TilePoint } from './draft.js';

/**
 * How much of the road each plot can actually shoot (#34).
 *
 * The one analysis the issue names an acceptance criterion for — *"the
 * coverage heatmap catches an unreachable path segment"* — and the reason is
 * that an uncovered stretch of road is invisible in an editor and obvious in
 * play, as a stage nobody can win. It is cheaper to find here than in a
 * playtest, and far cheaper than in #50.
 *
 * Measured **along the path** rather than over the map, because that is the
 * only place it matters: a corner of the map no tower reaches is scenery, and
 * a tile of road no tower reaches is a hole every enemy walks through. The
 * same distinction the blocking window makes in `soldiers.ts`.
 *
 * Everything here is pure and works on a draft, so it runs on every edit and
 * is unit-tested without a renderer.
 */

/** Samples per tile of road. Fine enough to catch a gap a Riftling fits through. */
const SAMPLES_PER_TILE = 2;

export interface CoverageSample {
  /** Distance along the path, in tiles. */
  atTiles: number;
  x: number;
  y: number;
  /** How many plots could hit an enemy standing here. */
  plots: number;
}

export interface Gap {
  fromTiles: number;
  toTiles: number;
}

export interface Coverage {
  samples: CoverageSample[];
  /** Stretches of road no plot covers at all. Empty is what an author wants. */
  gaps: Gap[];
  /** The deepest and shallowest cover anywhere on the road. */
  maxPlots: number;
  minPlots: number;
  /** Fraction of the road covered by at least one plot, 0..1. */
  covered: number;
}

/**
 * Coverage of one path by every plot on the stage.
 *
 * `rangeTiles` is the reach being asked about — the editor passes whichever
 * tower and tier the author has selected, because "is this covered" has no
 * answer independent of what is standing there. A Sniper Nest reaches 14 tiles
 * and an Alchemist's Still 6, and a map that is fully covered by the first and
 * full of holes for the second is a real thing to know.
 */
export function coverageOf(draft: Draft, pathId: number, rangeTiles: number): Coverage {
  const path = draft.paths.find((candidate) => candidate.id === pathId);
  const empty: Coverage = { samples: [], gaps: [], maxPlots: 0, minPlots: 0, covered: 0 };
  if (path === undefined || path.points.length < 2) return empty;

  /* Baked through the simulation's own class, so "distance along the path"
     means exactly what it means in play rather than approximately. */
  const baked = new BakedPath({ id: path.id, points: path.points, branches: [] });
  const totalTiles = baked.totalLength / TILE_SIZE;
  if (totalTiles <= 0) return empty;

  const steps = Math.max(1, Math.ceil(totalTiles * SAMPLES_PER_TILE));
  const rangeSq = rangeTiles * rangeTiles;
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };

  const samples: CoverageSample[] = [];
  let maxPlots = 0;
  let minPlots = Number.POSITIVE_INFINITY;
  let coveredSteps = 0;

  for (let i = 0; i <= steps; i++) {
    const atTiles = (totalTiles * i) / steps;
    baked.sample(atTiles * TILE_SIZE, sample);
    const x = sample.x / TILE_SIZE;
    const y = sample.y / TILE_SIZE;

    let plots = 0;
    for (const plot of draft.plots) {
      if (distanceSq(plot.position, x, y) <= rangeSq) plots++;
    }

    samples.push({ atTiles, x, y, plots });
    if (plots > maxPlots) maxPlots = plots;
    if (plots < minPlots) minPlots = plots;
    if (plots > 0) coveredSteps++;
  }

  return {
    samples,
    gaps: gapsFrom(samples),
    maxPlots,
    minPlots: Number.isFinite(minPlots) ? minPlots : 0,
    covered: coveredSteps / (steps + 1),
  };
}

/**
 * Runs of consecutive uncovered samples, as stretches of road.
 *
 * Merged into ranges rather than reported per sample because what an author
 * needs is "nothing covers tiles 18 through 24", not forty-eight zeroes.
 */
function gapsFrom(samples: readonly CoverageSample[]): Gap[] {
  const gaps: Gap[] = [];
  let start: number | null = null;

  for (const sample of samples) {
    if (sample.plots === 0) {
      if (start === null) start = sample.atTiles;
    } else if (start !== null) {
      gaps.push({ fromTiles: start, toTiles: sample.atTiles });
      start = null;
    }
  }
  /* A gap that runs to the end of the road still ends somewhere. */
  const last = samples[samples.length - 1];
  if (start !== null && last !== undefined) gaps.push({ fromTiles: start, toTiles: last.atTiles });

  return gaps;
}

function distanceSq(from: TilePoint, x: number, y: number): number {
  const dx = from.x - x;
  const dy = from.y - y;
  return dx * dx + dy * dy;
}
