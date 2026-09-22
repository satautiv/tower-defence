import type { ReactElement } from 'react';
import type { Draft, TilePoint } from './draft.js';
import type { Coverage } from './coverage.js';

/**
 * The map, as SVG (#34).
 *
 * SVG rather than the game's Pixi stack, deliberately. An editor does not need
 * sixty frames a second, and reusing `view/` would mean building a `World` for
 * a stage that is not valid yet — the exact moments an author most needs to
 * see it. SVG also keeps the editor testable in happy-dom like the rest of the
 * interface, and keeps the whole tool clear of the render stack, which is what
 * lets it be dropped from the production build in one `import.meta.env.DEV`.
 *
 * Everything is drawn in tiles and scaled by one transform, so a click maps
 * back to a tile with one division rather than a chain of offsets.
 */

export type Tool = 'path' | 'plot' | 'spawn' | 'core';

export interface Selection {
  kind: 'waypoint' | 'plot' | 'spawn';
  /** Path id for a waypoint, entity id otherwise. */
  id: number;
  /** Index within the path, for a waypoint. */
  index?: number;
}

export interface StageCanvasProps {
  draft: Draft;
  tool: Tool;
  /** Pixels per tile. The editor's zoom. */
  scale: number;
  coverage: Coverage | null;
  selection: Selection | null;
  onPick: (at: TilePoint) => void;
  onSelect: (selection: Selection | null) => void;
}

/** Snaps to half a tile: fine enough to place a plot, coarse enough to align. */
export function snap(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * How a coverage depth is coloured.
 *
 * Zero is the only value that matters at a glance — it is a hole every enemy
 * walks through — so it gets the alarm colour and everything else is a ramp.
 * Deep cover is worth seeing too, because it is where a stage is trivial, but
 * it is not an error and must not read as one.
 */
export function coverageColour(plots: number, max: number): string {
  if (plots === 0) return 'var(--c-danger)';
  const depth = max <= 1 ? 1 : (plots - 1) / (max - 1);
  return `hsl(${Math.round(190 - depth * 150)} 80% 55%)`;
}

export function StageCanvas({
  draft,
  tool,
  scale,
  coverage,
  selection,
  onPick,
  onSelect,
}: StageCanvasProps): ReactElement {
  const width = draft.widthTiles * scale;
  const height = draft.heightTiles * scale;

  const pick = (event: React.MouseEvent<SVGSVGElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    onPick({
      x: snap((event.clientX - box.left) / scale),
      y: snap((event.clientY - box.top) / scale),
    });
  };

  const isSelected = (kind: Selection['kind'], id: number, index?: number): boolean =>
    selection?.kind === kind && selection.id === id && selection.index === index;

  return (
    <svg
      className="ed-canvas"
      data-testid="editor-canvas"
      data-tool={tool}
      width={width}
      height={height}
      viewBox={`0 0 ${draft.widthTiles} ${draft.heightTiles}`}
      onClick={pick}
    >
      <defs>
        <pattern id="ed-grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--c-border)" strokeWidth={0.02} />
        </pattern>
      </defs>
      <rect width={draft.widthTiles} height={draft.heightTiles} fill="url(#ed-grid)" />

      {/* Roads under everything, so a plot never hides behind one. */}
      {draft.paths.map((path) => (
        <polyline
          key={path.id}
          className="ed-path"
          points={path.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          strokeWidth={0.5}
        />
      ))}

      {/* The heatmap sits on the road it describes: coverage is a property of
          the road, and drawn anywhere else it would be a second map to read. */}
      {coverage?.samples.map((sample) => (
        <circle
          key={sample.atTiles}
          className="ed-coverage"
          cx={sample.x}
          cy={sample.y}
          r={0.22}
          fill={coverageColour(sample.plots, coverage.maxPlots)}
        />
      ))}

      {draft.paths.flatMap((path) =>
        path.points.map((point, index) => (
          <rect
            key={`${path.id}:${index}`}
            className={`ed-waypoint${isSelected('waypoint', path.id, index) ? ' ed-selected' : ''}`}
            x={point.x - 0.25}
            y={point.y - 0.25}
            width={0.5}
            height={0.5}
            data-testid={`waypoint-${path.id}-${index}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ kind: 'waypoint', id: path.id, index });
            }}
          />
        )),
      )}

      {draft.plots.map((plot) => (
        <g key={plot.id}>
          <rect
            className={`ed-plot${plot.leyNode === undefined ? '' : ' ed-plot--ley'}${
              isSelected('plot', plot.id) ? ' ed-selected' : ''
            }`}
            x={plot.position.x - 0.4}
            y={plot.position.y - 0.4}
            width={0.8}
            height={0.8}
            data-testid={`plot-${plot.id}`}
            data-ley={plot.leyNode ?? ''}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ kind: 'plot', id: plot.id });
            }}
          />
        </g>
      ))}

      {draft.spawnPoints.map((spawn) => (
        <circle
          key={spawn.id}
          className={`ed-spawn${isSelected('spawn', spawn.id) ? ' ed-selected' : ''}`}
          cx={spawn.position.x}
          cy={spawn.position.y}
          r={0.45}
          data-testid={`spawn-${spawn.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ kind: 'spawn', id: spawn.id });
          }}
        />
      ))}

      <circle className="ed-core" cx={draft.core.x} cy={draft.core.y} r={0.6} data-testid="core" />
    </svg>
  );
}
