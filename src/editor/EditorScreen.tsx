import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { loadContent } from '@content/load';
import { LEY_NODE_TYPES } from '@content/schema/common';
import {
  addPlot,
  addSpawnPoint,
  addWaypoint,
  emptyDraft,
  moveCore,
  movePlot,
  moveSpawnPoint,
  moveWaypoint,
  removePlot,
  removeSpawnPoint,
  removeWaypoint,
  setLeyNode,
} from './draft.js';
import type { Draft, TilePoint } from './draft.js';
import { coverageOf } from './coverage.js';
import { exportStage, fileNameFor, importStage } from './io.js';
import { validateDraft } from './validate.js';
import { allWaveTotals, stageFloorSeconds } from './waves.js';
import { StageCanvas } from './StageCanvas.jsx';
import type { Selection, Tool } from './StageCanvas.jsx';
import { WaveComposer } from './WaveComposer.jsx';
import './editor.css';

/**
 * The stage editor (#34).
 *
 * Dev-only, and reached from the menu only in a dev build. Every panel here is
 * a thin view over the pure model in this directory — `draft.ts` owns the
 * edits, `validate.ts` runs the rules CI runs, `coverage.ts` finds the holes —
 * so the logic worth testing is tested without a renderer, and this file is
 * the part that would be tedious rather than subtle to get wrong.
 *
 * History is a stack of whole drafts. A stage is a few kilobytes and an edit
 * happens when a human clicks, so the naive thing is also the right thing, and
 * it makes undo exact rather than approximately reversible.
 */

const MAX_HISTORY = 100;

/** Reaches of the towers an author is most likely to be checking against. */
const REACHES: { label: string; tiles: number }[] = [
  { label: 'Short (5)', tiles: 5 },
  { label: 'Typical (7)', tiles: 7 },
  { label: 'Long (9)', tiles: 9 },
  { label: 'Sniper (14)', tiles: 14 },
];

export function EditorScreen(): ReactElement {
  const registry = useMemo(() => loadContent(), []);
  const localeKeys = useMemo(() => new Set<string>(), []);

  const [history, setHistory] = useState<Draft[]>(() => [emptyDraft('9-9', 'stage.9_9.name')]);
  const [at, setAt] = useState(0);
  const [tool, setTool] = useState<Tool>('plot');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [scale, setScale] = useState(28);
  const [reach, setReach] = useState(7);
  const [pathId, setPathId] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const draft = history[at] as Draft;

  const commit = useCallback(
    (next: Draft) => {
      if (next === draft) return;
      setHistory((past) => {
        const kept = [...past.slice(0, at + 1), next];
        return kept.length > MAX_HISTORY ? kept.slice(kept.length - MAX_HISTORY) : kept;
      });
      setAt((index) => Math.min(index + 1, MAX_HISTORY - 1));
    },
    [at, draft],
  );

  const replace = useCallback((next: Draft) => {
    setHistory([next]);
    setAt(0);
    setSelection(null);
  }, []);

  const validation = useMemo(
    () => validateDraft(draft, registry, localeKeys),
    [draft, registry, localeKeys],
  );
  const coverage = useMemo(() => coverageOf(draft, pathId, reach), [draft, pathId, reach]);
  const totals = useMemo(() => allWaveTotals(draft, registry), [draft, registry]);
  const floor = useMemo(() => stageFloorSeconds(draft, registry), [draft, registry]);

  const place = (at2: TilePoint): void => {
    if (tool === 'path') commit(addWaypoint(draft, pathId, at2));
    else if (tool === 'plot') commit(addPlot(draft, at2));
    else if (tool === 'spawn') commit(addSpawnPoint(draft, at2, pathId));
    else commit(moveCore(draft, at2));
  };

  /* Moving the selection with the keyboard, because placing by click and
     nudging by arrow is how every map editor works and a drag on an SVG at
     tile precision is not the tool for a half-tile correction. */
  const nudge = (dx: number, dy: number): void => {
    if (selection === null) return;
    if (selection.kind === 'plot') {
      const plot = draft.plots.find((candidate) => candidate.id === selection.id);
      if (plot !== undefined) {
        commit(movePlot(draft, plot.id, { x: plot.position.x + dx, y: plot.position.y + dy }));
      }
    } else if (selection.kind === 'spawn') {
      const spawn = draft.spawnPoints.find((candidate) => candidate.id === selection.id);
      if (spawn !== undefined) {
        commit(
          moveSpawnPoint(draft, spawn.id, { x: spawn.position.x + dx, y: spawn.position.y + dy }),
        );
      }
    } else if (selection.index !== undefined) {
      const path = draft.paths.find((candidate) => candidate.id === selection.id);
      const point = path?.points[selection.index];
      if (point !== undefined) {
        commit(
          moveWaypoint(draft, selection.id, selection.index, { x: point.x + dx, y: point.y + dy }),
        );
      }
    }
  };

  const removeSelected = (): void => {
    if (selection === null) return;
    if (selection.kind === 'plot') commit(removePlot(draft, selection.id));
    else if (selection.kind === 'spawn') commit(removeSpawnPoint(draft, selection.id));
    else if (selection.index !== undefined) {
      commit(removeWaypoint(draft, selection.id, selection.index));
    }
    setSelection(null);
  };

  const download = (): void => {
    const blob = new Blob([exportStage(draft)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameFor(draft);
    link.click();
    URL.revokeObjectURL(url);
    setNote(`Exported ${fileNameFor(draft)} — drop it in src/content/data/stages/`);
  };

  const upload = (file: File): void => {
    void file.text().then((text) => {
      const result = importStage(text);
      if (result.draft === null) setNote(`Could not read it — ${result.errors[0] ?? 'unknown'}`);
      else {
        replace(result.draft);
        setNote(`Loaded ${result.draft.id}`);
      }
    });
  };

  const selectedPlot =
    selection?.kind === 'plot' ? draft.plots.find((plot) => plot.id === selection.id) : undefined;

  return (
    <div
      className="ed"
      data-testid="screen-editor"
      tabIndex={-1}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 1 : 0.5;
        if (event.key === 'ArrowLeft') nudge(-step, 0);
        else if (event.key === 'ArrowRight') nudge(step, 0);
        else if (event.key === 'ArrowUp') nudge(0, -step);
        else if (event.key === 'ArrowDown') nudge(0, step);
        else if (event.key === 'Delete' || event.key === 'Backspace') removeSelected();
        else return;
        event.preventDefault();
      }}
    >
      <header className="ed__bar">
        <strong>Stage editor</strong>
        <input
          className="ed__id"
          aria-label="Stage id"
          value={draft.id}
          onChange={(event) => {
            const id = event.target.value;
            /* The name key tracks the id while it still matches the one the id
               implies. An author who has written their own is left alone —
               guessing over a deliberate choice is worse than not guessing. */
            const implied = `stage.${draft.id.replace('-', '_')}.name`;
            commit({
              ...draft,
              id: id as Draft['id'],
              nameKey:
                draft.nameKey === implied
                  ? (`stage.${id.replace('-', '_')}.name` as Draft['nameKey'])
                  : draft.nameKey,
            });
          }}
        />
        <input
          className="ed__key"
          aria-label="Stage name key"
          value={draft.nameKey}
          onChange={(event) =>
            commit({ ...draft, nameKey: event.target.value as Draft['nameKey'] })
          }
        />
        <div className="ed__tools" role="radiogroup" aria-label="Tool">
          {(['path', 'plot', 'spawn', 'core'] as Tool[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={tool === option}
              className={`ed__tool${tool === option ? ' ed__tool--on' : ''}`}
              onClick={() => setTool(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0}>
          Undo
        </button>
        <button
          type="button"
          onClick={() => setAt((i) => Math.min(history.length - 1, i + 1))}
          disabled={at >= history.length - 1}
        >
          Redo
        </button>
        <label className="ed__file">
          Import
          <input
            type="file"
            accept="application/json"
            aria-label="Import stage"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) upload(file);
            }}
          />
        </label>
        <button type="button" onClick={download}>
          Export
        </button>
      </header>

      {note !== null && (
        <p className="ed__note" role="status">
          {note}
        </p>
      )}

      <div className="ed__body">
        <main className="ed__map">
          <StageCanvas
            draft={draft}
            tool={tool}
            scale={scale}
            coverage={coverage}
            selection={selection}
            onPick={place}
            onSelect={setSelection}
          />
          <div className="ed__mapbar">
            <label>
              Zoom
              <input
                type="range"
                min={12}
                max={48}
                value={scale}
                aria-label="Zoom"
                onChange={(event) => setScale(Number(event.target.value))}
              />
            </label>
            <label>
              Coverage for
              <select
                aria-label="Coverage reach"
                value={reach}
                onChange={(event) => setReach(Number(event.target.value))}
              >
                {REACHES.map((option) => (
                  <option key={option.tiles} value={option.tiles}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Path
              <select
                aria-label="Path"
                value={pathId}
                onChange={(event) => setPathId(Number(event.target.value))}
              >
                {draft.paths.map((path) => (
                  <option key={path.id} value={path.id}>
                    {path.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </main>

        <aside className="ed__side">
          <section className="ed__panel" data-testid="coverage-panel">
            <h2>Coverage</h2>
            <p>
              {Math.round(coverage.covered * 100)}% of path {pathId} is covered, up to{' '}
              {coverage.maxPlots} deep.
            </p>
            {coverage.gaps.length === 0 ? (
              <p className="ed__ok">No gaps at this reach.</p>
            ) : (
              <ul className="ed__bad" data-testid="coverage-gaps">
                {/* A gap can be a single sample — the road's last point, most
                    often — and "29.0–29.0 tiles" reads as a glitch rather than
                    a finding. The analysis is exact either way; this is what
                    it says out loud. */}
                {coverage.gaps.map((gap) => (
                  <li key={gap.fromTiles}>
                    {gap.toTiles - gap.fromTiles < 0.05
                      ? `Nothing covers tile ${gap.fromTiles.toFixed(1)}`
                      : `Nothing covers ${gap.fromTiles.toFixed(1)}–${gap.toTiles.toFixed(1)} tiles`}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selectedPlot !== undefined && (
            <section className="ed__panel">
              <h2>Plot {selectedPlot.id}</h2>
              <label>
                Ley node
                <select
                  aria-label="Ley node"
                  value={selectedPlot.leyNode ?? ''}
                  onChange={(event) =>
                    commit(
                      setLeyNode(
                        draft,
                        selectedPlot.id,
                        event.target.value === '' ? undefined : event.target.value,
                      ),
                    )
                  }
                >
                  <option value="">none</option>
                  {LEY_NODE_TYPES.map((node) => (
                    <option key={node} value={node}>
                      {node}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          )}

          <section className="ed__panel" data-testid="validation-panel">
            <h2>Validation</h2>
            {validation.valid && validation.schema.length === 0 ? (
              <p className="ed__ok">Passes content-lint.</p>
            ) : (
              <ul className="ed__bad">
                {validation.schema.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
                {validation.lint.map((problem) => (
                  <li key={`${problem.rule}:${problem.message}`}>
                    <code>{problem.rule}</code> {problem.message}
                  </li>
                ))}
              </ul>
            )}
            {validation.missingLocaleKeys.length > 0 && (
              <p className="ed__warn">
                Locale file still needs: {validation.missingLocaleKeys.join(', ')}
              </p>
            )}
          </section>
        </aside>
      </div>

      <WaveComposer
        draft={draft}
        totals={totals}
        floorSeconds={floor}
        enemyIds={[...registry.enemies.keys()].sort()}
        onChange={commit}
      />
    </div>
  );
}
