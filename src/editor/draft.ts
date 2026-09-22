import { StageSchema } from '@content/schema/stage';
import type { StageDefinition } from '@content/schema/stage';

/**
 * A stage being edited (#34).
 *
 * The draft is a plain `StageDefinition` — the very type the game loads and
 * `content-lint` validates — rather than an editor-shaped model that has to be
 * converted on the way out. A separate authoring model is where round-trip
 * bugs live: it drifts from the schema, and the drift only shows up as a stage
 * that exports but will not load.
 *
 * Every edit below returns a new stage instead of mutating one. The editor is
 * React, undo is a stack of these, and a shared mutable object would make both
 * of those subtly wrong. This is not the tick loop; there is no allocation
 * budget here.
 */

export type Draft = StageDefinition;

/** A point in tiles, which is what the schema stores and the editor edits. */
export interface TilePoint {
  x: number;
  y: number;
}

/**
 * The smallest stage that is still a *valid* one.
 *
 * Not merely parseable: it starts clean against `content-lint` too, ley nodes
 * and all. A draft that begins with a diagnostic teaches the author to ignore
 * the panel, which is the one thing the panel cannot survive — and the
 * two-to-four ley node rule means "blank" and "valid" are not the same stage.
 *
 * Four plots rather than one for the same reason: the map authoring rules want
 * two ley nodes at least, and a starting draft that cannot satisfy them
 * without editing is a starting draft nobody can use as a starting point.
 */
export function emptyDraft(id: string, nameKey: string): Draft {
  return StageSchema.parse({
    id,
    nameKey,
    region: 1,
    widthTiles: 30,
    heightTiles: 17,
    startingGold: 600,
    lives: 20,
    core: { x: 29, y: 8 },
    paths: [
      {
        id: 0,
        points: [
          { x: 0, y: 8 },
          { x: 29, y: 8 },
        ],
      },
    ],
    spawnPoints: [{ id: 0, position: { x: 0, y: 8 }, pathId: 0 }],
    plots: [
      { id: 0, position: { x: 4, y: 6 } },
      { id: 1, position: { x: 10, y: 10 } },
      { id: 2, position: { x: 16, y: 6 }, leyNode: 'flux' },
      { id: 3, position: { x: 22, y: 10 }, leyNode: 'resonance' },
    ],
    waves: [
      { autoStartDelaySeconds: 20, groups: [{ enemy: 'riftling', count: 5, spawnPoint: 0 }] },
    ],
  });
}

/** Ids are positions in the list for paths and spawns, but not for plots. */
function nextId(used: readonly { id: number }[]): number {
  return used.reduce((highest, item) => Math.max(highest, item.id), -1) + 1;
}

/* ---- paths ---- */

export function addWaypoint(draft: Draft, pathId: number, at: TilePoint): Draft {
  return {
    ...draft,
    paths: draft.paths.map((path) =>
      path.id === pathId ? { ...path, points: [...path.points, at] } : path,
    ),
  };
}

export function moveWaypoint(draft: Draft, pathId: number, index: number, to: TilePoint): Draft {
  return {
    ...draft,
    paths: draft.paths.map((path) =>
      path.id === pathId
        ? { ...path, points: path.points.map((point, i) => (i === index ? to : point)) }
        : path,
    ),
  };
}

/**
 * Removes a waypoint, unless doing so would leave a path that is not a path.
 *
 * Refused rather than allowed-and-flagged: two points is the schema's own
 * minimum, and a draft that cannot be parsed stops the live validation the
 * whole editor depends on.
 */
export function removeWaypoint(draft: Draft, pathId: number, index: number): Draft {
  const path = draft.paths.find((candidate) => candidate.id === pathId);
  if (path === undefined || path.points.length <= 2) return draft;

  return {
    ...draft,
    paths: draft.paths.map((candidate) =>
      candidate.id === pathId
        ? { ...candidate, points: candidate.points.filter((_, i) => i !== index) }
        : candidate,
    ),
  };
}

/* ---- plots ---- */

export function addPlot(draft: Draft, at: TilePoint): Draft {
  return {
    ...draft,
    plots: [...draft.plots, { id: nextId(draft.plots), position: at }],
  };
}

export function movePlot(draft: Draft, plotId: number, to: TilePoint): Draft {
  return {
    ...draft,
    plots: draft.plots.map((plot) => (plot.id === plotId ? { ...plot, position: to } : plot)),
  };
}

/** Refused at the last plot: the schema requires one, and so does a stage. */
export function removePlot(draft: Draft, plotId: number): Draft {
  if (draft.plots.length <= 1) return draft;
  return { ...draft, plots: draft.plots.filter((plot) => plot.id !== plotId) };
}

/**
 * Sets or clears a plot's ley node.
 *
 * `undefined` clears it, which is how the schema says "ordinary plot" — an
 * explicit null would be a second way to say the same thing and would not
 * survive a round trip through JSON.
 */
export function setLeyNode(draft: Draft, plotId: number, node: string | undefined): Draft {
  return {
    ...draft,
    plots: draft.plots.map((plot) => {
      if (plot.id !== plotId) return plot;
      if (node === undefined) {
        const { leyNode: _dropped, ...rest } = plot;
        return rest;
      }
      return { ...plot, leyNode: node as NonNullable<typeof plot.leyNode> };
    }),
  };
}

/* ---- spawns and the core ---- */

export function addSpawnPoint(draft: Draft, at: TilePoint, pathId: number): Draft {
  return {
    ...draft,
    spawnPoints: [...draft.spawnPoints, { id: nextId(draft.spawnPoints), position: at, pathId }],
  };
}

export function moveSpawnPoint(draft: Draft, spawnId: number, to: TilePoint): Draft {
  return {
    ...draft,
    spawnPoints: draft.spawnPoints.map((spawn) =>
      spawn.id === spawnId ? { ...spawn, position: to } : spawn,
    ),
  };
}

export function removeSpawnPoint(draft: Draft, spawnId: number): Draft {
  if (draft.spawnPoints.length <= 1) return draft;
  return { ...draft, spawnPoints: draft.spawnPoints.filter((spawn) => spawn.id !== spawnId) };
}

export function moveCore(draft: Draft, to: TilePoint): Draft {
  return { ...draft, core: to };
}
