import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { TILE_SIZE } from '@core/constants';
import {
  buildOptions,
  buildTower,
  callWave,
  plotInfo,
  prospectiveRange,
  sellTower,
  specialiseTower,
  towerInfo,
  undoBuild,
  undoSecondsRemaining,
  upgradeTower,
} from '@sim/index';
import type { BuildOption, TowerInfo } from '@sim/index';
import { GameSession } from '@app/session';
import type { GameView } from '@view/app';
import { BoardView } from '@view/board';
import { logicalToCanvas } from '@view/viewport';
import { GameCanvas } from '../GameCanvas.js';
import { Button, Modal, Panel } from '../components/index.js';
import { Hud } from '../hud/Hud.js';
import type { HudModel } from '../hud/model.js';
import { BuildMenu } from '../stage/BuildMenu.js';
import { TowerPanel } from '../stage/TowerPanel.js';
import { useUiStore } from '../store.js';

/**
 * The only screen that mounts the renderer, and the one that runs a stage.
 *
 * Holds the session, drives it from the Pixi ticker, and turns taps into
 * commands. Nothing here mutates the world: every action goes through
 * `session.dispatch`, which is the same route the balance simulator's scripted
 * AI takes.
 */

/** How close a tap must land to count as hitting a plot. */
const PLOT_HIT_RADIUS = TILE_SIZE * 0.75;

interface Selection {
  plotId: number;
  towerSlot: number;
  screen: { x: number; y: number };
}

const NOTHING: Selection = { plotId: -1, towerSlot: -1, screen: { x: 0, y: 0 } };

export function InStageScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);
  const openPanel = useUiStore((state) => state.openPanel);
  const closePanel = useUiStore((state) => state.closePanel);
  const openPanelById = useUiStore((state) => state.openPanelById);
  const selectedStageId = useUiStore((state) => state.selectedStageId);

  const sessionRef = useRef<GameSession | null>(null);
  const boardRef = useRef<BoardView | null>(null);
  const viewRef = useRef<GameView | null>(null);

  const [unsupported, setUnsupported] = useState(false);
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [options, setOptions] = useState<readonly BuildOption[]>([]);
  const [tower, setTower] = useState<TowerInfo | null>(null);
  const [previewRadius, setPreviewRadius] = useState(0);
  const [undoLeft, setUndoLeft] = useState(0);

  /* Read by the ticker, which must not re-subscribe when React re-renders. */
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const previewRef = useRef(previewRadius);
  previewRef.current = previewRadius;

  const dispatch = useCallback((issue: Parameters<GameSession['dispatch']>[0]) => {
    sessionRef.current?.dispatch(issue);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(NOTHING);
    setTower(null);
    setOptions([]);
    setPreviewRadius(0);
  }, []);

  /**
   * A tap either opens the build menu on an empty plot, selects the tower on a
   * taken one, or dismisses whatever is open.
   */
  const handleTap = useCallback(
    (logicalX: number, logicalY: number) => {
      const session = sessionRef.current;
      const view = viewRef.current;
      if (session === null || view === null) return;

      const world = view.camera.screenToWorld(logicalX, logicalY);
      const plots = plotInfo(session.world);

      let nearest = null;
      let nearestDistance = PLOT_HIT_RADIUS;
      for (const plot of plots) {
        const distance = Math.hypot(plot.x - world.x, plot.y - world.y);
        if (distance <= nearestDistance) {
          nearest = plot;
          nearestDistance = distance;
        }
      }
      if (nearest === null) {
        clearSelection();
        return;
      }

      const onScreen = view.camera.worldToScreen(nearest.x, nearest.y);
      const canvas = logicalToCanvas(view.viewport, onScreen.x, onScreen.y);

      if (nearest.occupiedBy >= 0) {
        setSelection({ plotId: nearest.id, towerSlot: nearest.occupiedBy, screen: canvas });
        setOptions([]);
        return;
      }

      setSelection({ plotId: nearest.id, towerSlot: -1, screen: canvas });
      setOptions(buildOptions(session.world));
      setTower(null);
    },
    [clearSelection],
  );

  const handleReady = useCallback(
    (view: GameView) => {
      viewRef.current = view;

      const session = GameSession.forStage(selectedStageId ?? '1-1');
      if (session === null) return;
      sessionRef.current = session;

      const board = new BoardView(view.layers);
      boardRef.current = board;
      board.syncPlots(session.world);

      view.camera.setWorldSize(
        session.world.config.widthTiles * TILE_SIZE,
        session.world.config.heightTiles * TILE_SIZE,
      );
      view.camera.centreOnWorld();

      let started = false;
      view.app.ticker.add(() => {
        const now = performance.now();
        if (!started) {
          session.start(now);
          started = true;
        }
        session.update(now);
        board.render(
          session.world,
          selectionRef.current.plotId,
          previewRef.current,
          selectionRef.current.towerSlot,
        );
      });
    },
    [selectedStageId],
  );

  /* The panel and the undo clock poll at ten times a second. Reading them per
     frame would re-render React sixty times a second to show numbers nobody
     can read that fast. */
  useEffect(() => {
    const id = setInterval(() => {
      const session = sessionRef.current;
      if (session === null) return;

      const slot = selectionRef.current.towerSlot;
      setTower(slot >= 0 ? towerInfo(session.world, slot) : null);
      setUndoLeft(undoSecondsRemaining(session.world));

      if (session.world.finished) navigate('results');
    }, 100);
    return () => clearInterval(id);
  }, [navigate]);

  const build = useCallback(
    (typeIdx: number) => {
      const plotId = selectionRef.current.plotId;
      if (plotId < 0) return;
      dispatch((queue) => buildTower(queue, plotId, typeIdx));
      clearSelection();
    },
    [dispatch, clearSelection],
  );

  /** Keyboard is an accelerator on desktop; every action has a touch route too. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const session = sessionRef.current;
      if (session === null) return;

      if (event.key === 'Escape') return clearSelection();
      if (event.key === ' ') {
        event.preventDefault();
        return dispatch(callWave);
      }
      if (event.key.toLowerCase() === 'u') return dispatch(undoBuild);

      const slot = selectionRef.current.towerSlot;
      if (slot >= 0) {
        if (event.key.toLowerCase() === 'e') return dispatch((q) => upgradeTower(q, slot));
        if (event.key === 'Delete' || event.key === 'Backspace') {
          return dispatch((q) => sellTower(q, slot));
        }
      }

      const digit = Number.parseInt(event.key, 10);
      if (Number.isInteger(digit) && digit >= 1 && selectionRef.current.plotId >= 0) {
        const available = buildOptions(session.world);
        const option = available[digit - 1];
        if (option !== undefined) build(option.typeIdx);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, clearSelection, build]);

  const hudSource = useCallback((): HudModel => {
    const session = sessionRef.current;
    if (session === null) {
      return { lives: 0, gold: 0, aether: 0, wave: 0, totalWaves: 0, speed: 1, paused: false };
    }
    const world = session.world;
    return {
      lives: world.resources.lives,
      gold: world.resources.gold,
      aether: Math.floor(world.resources.aether),
      wave: world.wave.index + 1,
      totalWaves: world.config.totalWaves,
      speed: world.speed,
      paused: session.isPaused,
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.setPaused(openPanel === 'pause');
  }, [openPanel]);

  return (
    <div className="ui-screen ui-screen--stage" data-testid="screen-in-stage">
      {!unsupported && (
        <GameCanvas
          onReady={handleReady}
          onUnsupported={() => setUnsupported(true)}
          onTap={handleTap}
        />
      )}

      {unsupported ? (
        <Panel title="Cannot render">
          <p className="ui-muted">This device cannot run the game board.</p>
          <Button onClick={() => navigate('menu')}>Back to menu</Button>
        </Panel>
      ) : (
        <>
          <Hud source={hudSource} />

          {selection.plotId >= 0 && selection.towerSlot < 0 && options.length > 0 && (
            <BuildMenu
              options={options}
              at={selection.screen}
              onBuild={build}
              onCancel={clearSelection}
              onHover={(typeIdx) =>
                setPreviewRadius(
                  sessionRef.current === null
                    ? 0
                    : prospectiveRange(sessionRef.current.world, typeIdx),
                )
              }
            />
          )}

          {tower !== null && (
            <TowerPanel
              tower={tower}
              undoSeconds={undoLeft}
              onUpgrade={() => dispatch((q) => upgradeTower(q, tower.slot))}
              onSpecialise={(branch) => dispatch((q) => specialiseTower(q, tower.slot, branch))}
              onSell={() => {
                dispatch((q) => sellTower(q, tower.slot));
                clearSelection();
              }}
              onUndo={() => {
                dispatch(undoBuild);
                clearSelection();
              }}
              onClose={clearSelection}
            />
          )}
        </>
      )}

      <Modal open={openPanel === 'pause'} title="Paused" onClose={closePanel}>
        <Button variant="primary" onClick={closePanel}>
          Resume
        </Button>
        <Button
          onClick={() => {
            sessionRef.current?.restart();
            closePanel();
            clearSelection();
          }}
        >
          Restart
        </Button>
        <Button variant="danger" onClick={() => navigate('stageSelect')}>
          Quit to stage select
        </Button>
      </Modal>

      <div className="ui-stage__call">
        <Button variant="primary" onClick={() => dispatch(callWave)}>
          Call wave
        </Button>
        <Button variant="ghost" onClick={() => openPanelById('pause')} aria-label="Pause">
          II
        </Button>
      </div>
    </div>
  );
}
