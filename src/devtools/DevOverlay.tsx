import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { giveGold, setLives, skipWave, unlockEverything } from '@sim/cheats';
import type { ReplayHeader, World } from '@sim/index';
import { TIME_SCALES } from './overlay.js';
import type { StageDevtools } from './overlay.js';
import type { DebugToggles } from './debugDraw.js';
import type { DevStats } from './stats.js';
import type { SplitStats } from './timing.js';
import type { DamageLog } from './damageLog.js';
import './devtools.css';

/**
 * The panel behind `~` (#41).
 *
 * Reads; it does not measure. Everything on it is computed inside the frame by
 * `StageDevtools`, which is the only thing that can be — the event buffer is
 * cleared once its consumers have drained it, and a panel polling the world at
 * 10Hz would report a game where nothing ever happened.
 *
 * 10Hz, because this is the same trap the HUD exists to avoid: a dev panel
 * re-rendering React sixty times a second would cost more than the frame it is
 * there to explain, and would make its own numbers worse the longer you looked
 * at them.
 */

const GRAPH_WIDTH = 240;
const GRAPH_HEIGHT = 48;
/** The frame budget, drawn as a line: everything is read against it. */
const BUDGET_MS = 16.6;
const SAMPLE_CAPACITY = 120;

const TOGGLE_LABELS: ReadonlyArray<[keyof DebugToggles, string]> = [
  ['hitboxes', 'hitboxes'],
  ['ranges', 'ranges'],
  ['paths', 'paths'],
  ['grid', 'spatial grid'],
  ['targeting', 'targeting'],
];

export interface DevOverlayProps {
  dev: StageDevtools;
  /** The live world, or null before a stage has built one. */
  world: () => World | null;
  /** What the world was built from, for a replay's header. */
  replayHeader: () => ReplayHeader | null;
}

interface Readings {
  frame: SplitStats;
  stats: DevStats | null;
  log: DamageLog;
}

export function DevOverlay({ dev, world, replayHeader }: DevOverlayProps): ReactElement | null {
  const state = useSyncExternalStore(dev.subscribe, dev.getState);
  const [readings, setReadings] = useState<Readings | null>(null);
  const [note, setNote] = useState('');

  const buffers = useMemo(
    () => ({ sim: new Float32Array(SAMPLE_CAPACITY), render: new Float32Array(SAMPLE_CAPACITY) }),
    [],
  );
  const graphRef = useRef<{ sim: string; render: string; ceiling: number }>({
    sim: '',
    render: '',
    ceiling: BUDGET_MS,
  });

  useEffect(() => {
    if (!state.visible) return;
    const poll = (): void => {
      const live = world();
      const count = dev.graph(buffers.sim, buffers.render);
      /* Scaled to the worst sample rather than to a fixed ceiling, so a spike
         is legible instead of clipped — but never below the budget, so the
         budget line stays on the chart and the trace is always read against
         it. */
      const ceiling = Math.max(BUDGET_MS, peak(buffers.sim, count), peak(buffers.render, count));
      graphRef.current = {
        ceiling,
        sim: polyline(buffers.sim, count, ceiling),
        render: polyline(buffers.render, count, ceiling),
      };
      setReadings({
        frame: dev.frameStats(),
        stats: live === null ? null : dev.worldStats(live),
        log: dev.damageLog(),
      });
    };
    poll();
    const id = setInterval(poll, 100);
    return () => clearInterval(id);
  }, [state.visible, dev, world, buffers]);

  if (!state.visible) return null;

  const cheat = (label: string, run: (live: World) => boolean | void): void => {
    const live = world();
    if (live === null) return;
    const ran = run(live);
    dev.markCheated();
    setNote(ran === false ? `${label}: nothing to do` : label);
  };

  const frame = readings?.frame;

  return (
    <div className="dev-overlay" data-testid="dev-overlay">
      <header className="dev-overlay__head">
        <strong>dev overlay</strong>
        <span className="dev-overlay__dim">~ to hide</span>
      </header>

      <section className="dev-overlay__section">
        <div className="dev-overlay__row">
          <span>{(frame?.fps ?? 0).toFixed(0)} fps</span>
          <span className={over(frame?.simMs, 4)}>sim {fmt(frame?.simMs)}</span>
          <span className={over(frame?.renderMs, 8)}>render {fmt(frame?.renderMs)}</span>
        </div>
        <svg
          className="dev-overlay__graph"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          role="img"
          aria-label="Frame time, simulation against rendering"
        >
          <line
            x1={0}
            x2={GRAPH_WIDTH}
            y1={GRAPH_HEIGHT - (BUDGET_MS / graphRef.current.ceiling) * GRAPH_HEIGHT}
            y2={GRAPH_HEIGHT - (BUDGET_MS / graphRef.current.ceiling) * GRAPH_HEIGHT}
            className="dev-overlay__budget"
          />
          <polyline points={graphRef.current.render} className="dev-overlay__render" />
          <polyline points={graphRef.current.sim} className="dev-overlay__sim" />
        </svg>
        <div className="dev-overlay__row dev-overlay__dim">
          <span>frame {fmt(frame?.frameMs)}</span>
          <span>worst {fmt(Math.max(frame?.worstSimMs ?? 0, frame?.worstRenderMs ?? 0))}</span>
          <span>
            {frame?.ticks ?? 0} {frame?.ticks === 1 ? 'tick' : 'ticks'}/frame
          </span>
        </div>
      </section>

      {readings?.stats != null && (
        <section className="dev-overlay__section">
          <table className="dev-overlay__table">
            <tbody>
              {readings.stats.pools.map((pool) => (
                <tr key={pool.name} className={pool.full ? 'dev-overlay__bad' : undefined}>
                  <td>{pool.name}</td>
                  <td>{pool.live}</td>
                  <td className="dev-overlay__dim">hw {pool.watermark}</td>
                  <td className="dev-overlay__dim">/ {pool.capacity}</td>
                </tr>
              ))}
              {readings.stats.hashes.map((hash) => (
                <tr key={hash.name} className={hash.overflowed ? 'dev-overlay__bad' : undefined}>
                  <td>hash {hash.name}</td>
                  <td>{hash.size}</td>
                  <td className="dev-overlay__dim">
                    {hash.occupied}/{hash.cells} cells
                  </td>
                  <td className="dev-overlay__dim">max {hash.largestCell}</td>
                </tr>
              ))}
              {readings.stats.buffers.map((buffer) => (
                <tr
                  key={buffer.name}
                  className={buffer.dropped > 0 ? 'dev-overlay__bad' : undefined}
                >
                  <td>{buffer.name}</td>
                  <td>{buffer.count}</td>
                  <td className="dev-overlay__dim">peak {buffer.peak}</td>
                  <td className="dev-overlay__dim">
                    / {buffer.capacity}
                    {buffer.dropped > 0 ? ` · ${buffer.dropped} dropped` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dev-overlay__dim">
            tick {readings.stats.tick} · wave {readings.stats.wave + 1}
          </div>
        </section>
      )}

      <section className="dev-overlay__section">
        <div className="dev-overlay__label">draw</div>
        <div className="dev-overlay__chips">
          {TOGGLE_LABELS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                state.toggles[key] ? 'dev-overlay__chip dev-overlay__chip--on' : 'dev-overlay__chip'
              }
              aria-pressed={state.toggles[key]}
              onClick={() => dev.setToggle(key, !state.toggles[key])}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="dev-overlay__section">
        <div className="dev-overlay__label">time</div>
        <div className="dev-overlay__chips">
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={
                state.timeScale === scale
                  ? 'dev-overlay__chip dev-overlay__chip--on'
                  : 'dev-overlay__chip'
              }
              aria-pressed={state.timeScale === scale}
              onClick={() => dev.setTimeScale(scale)}
            >
              {scale}×
            </button>
          ))}
        </div>
      </section>

      <section className="dev-overlay__section">
        <div className="dev-overlay__label">cheats</div>
        <div className="dev-overlay__chips">
          <button
            type="button"
            className="dev-overlay__chip"
            onClick={() => cheat('+1000 gold', (live) => giveGold(live, 1000))}
          >
            +1000 gold
          </button>
          <button
            type="button"
            className="dev-overlay__chip"
            onClick={() => cheat('skip wave', (live) => skipWave(live))}
          >
            skip wave
          </button>
          <button
            type="button"
            className="dev-overlay__chip"
            onClick={() => cheat('lives 1', (live) => setLives(live, 1))}
          >
            lives 1
          </button>
          <button
            type="button"
            className="dev-overlay__chip"
            onClick={() => cheat('lives 99', (live) => setLives(live, 99))}
          >
            lives 99
          </button>
          <button
            type="button"
            className="dev-overlay__chip"
            onClick={() => cheat('unlock all', (live) => unlockEverything(live))}
          >
            unlock all
          </button>
        </div>
        {note !== '' && <div className="dev-overlay__dim">{note}</div>}
      </section>

      <section className="dev-overlay__section">
        <div className="dev-overlay__label">replay</div>
        <div className="dev-overlay__chips">
          {state.recording ? (
            <button
              type="button"
              className="dev-overlay__chip dev-overlay__chip--on"
              onClick={() => {
                const live = world();
                const header = replayHeader();
                if (live === null || header === null) return;
                const replay = dev.stopRecording(header, live.config.seed);
                if (replay !== null) download(`replay-${header.stageId}.json`, replay);
                setNote(`saved ${replay?.commands.length ?? 0} commands`);
              }}
            >
              stop &amp; save
            </button>
          ) : (
            <button
              type="button"
              className="dev-overlay__chip"
              onClick={() => {
                dev.startRecording();
                setNote('recording');
              }}
            >
              record
            </button>
          )}
        </div>
        {/* A cheat is a mutation with no command behind it, so nothing in the
            command list explains it and the run cannot be reproduced. */}
        {state.cheated && (
          <div className="dev-overlay__bad">
            cheated — a replay of this run will not reproduce it
          </div>
        )}
      </section>

      <section className="dev-overlay__section">
        <div className="dev-overlay__label">
          damage {state.watching < 0 ? '— tap an enemy' : `#${state.watching}`}
        </div>
        {readings != null && readings.log.entries.length > 0 && (
          <table className="dev-overlay__table">
            <tbody>
              {readings.log.entries.map((entry) => (
                <tr key={`${entry.source}:${entry.damageType}:${String(entry.absorbed)}`}>
                  <td>
                    {entry.source < 0
                      ? entry.fromReaction
                        ? 'reaction'
                        : 'other'
                      : `tower ${entry.source}`}
                  </td>
                  <td>{entry.damageType}</td>
                  <td>{entry.total.toFixed(0)}</td>
                  <td className="dev-overlay__dim">
                    {entry.hits} hits{entry.absorbed ? ' · shielded' : ''}
                  </td>
                </tr>
              ))}
              <tr>
                <td>to health</td>
                <td colSpan={3}>
                  {readings.log.toHealth.toFixed(0)}
                  {readings.log.absorbed > 0
                    ? ` (+${readings.log.absorbed.toFixed(0)} absorbed)`
                    : ''}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function fmt(ms: number | undefined): string {
  return `${(ms ?? 0).toFixed(1)}ms`;
}

/** Red past a budget, because the budgets are the whole reason for the split. */
function over(ms: number | undefined, budget: number): string | undefined {
  return ms !== undefined && ms > budget ? 'dev-overlay__bad' : undefined;
}

function peak(values: Float32Array, count: number): number {
  let worst = 0;
  for (let i = 0; i < count; i++) {
    const value = values[i] as number;
    if (value > worst) worst = value;
  }
  return worst;
}

function polyline(values: Float32Array, count: number, ceiling: number): string {
  if (count === 0) return '';
  const step = GRAPH_WIDTH / Math.max(1, count - 1);
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = GRAPH_HEIGHT - Math.min(1, (values[i] as number) / ceiling) * GRAPH_HEIGHT;
    out += `${(i * step).toFixed(1)},${y.toFixed(1)} `;
  }
  return out.trim();
}

/**
 * Hands the replay to the browser.
 *
 * A replay is how a bug report becomes a test, which means it has to leave the
 * machine it was recorded on.
 */
function download(name: string, payload: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
