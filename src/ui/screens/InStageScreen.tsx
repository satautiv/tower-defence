import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { TILE_SIZE } from '@core/constants';
import {
  buildOptions,
  buildTower,
  callWave,
  enemyInfo,
  enemyNear,
  nextWave,
  plotInfo,
  prospectiveRange,
  sellTower,
  setSpeed,
  specialiseTower,
  towerInfo,
  undoBuild,
  undoSecondsRemaining,
  upgradeTower,
} from '@sim/index';
import type { BuildOption, EnemyInfo, TowerInfo } from '@sim/index';
import { GameSession } from '@app/session';
import type { GameView } from '@view/app';
import { BoardView } from '@view/board';
import { EffectsView } from '@view/effects';
import { EntityView } from '@view/entities';
import { indexAtlas, initAssets, loadBundle } from '@view/assets';
import type { AtlasIndex } from '@view/assets';
import { FrameMetrics } from '@view/metrics';
import { RouteView } from '@view/routes';
import { logicalToCanvas } from '@view/viewport';
import { Assets } from 'pixi.js';
import type { Spritesheet } from 'pixi.js';
import { GameCanvas } from '../GameCanvas.js';
import { Button, Panel } from '../components/index.js';
import { Hud } from '../hud/Hud.js';
import type { HudModel } from '../hud/model.js';
import { BuildMenu } from '../stage/BuildMenu.js';
import { Diagnostics } from '../stage/Diagnostics.js';
import { EnemyPanel } from '../stage/EnemyPanel.js';
import { TowerPanel } from '../stage/TowerPanel.js';
import { WavePreview } from '../stage/WavePreview.js';
import { useUiStore } from '../store.js';
import { enemyName, statusName } from '../text.js';

/**
 * The only screen that mounts the renderer, and the one that runs a stage.
 *
 * Holds the session, drives it from the Pixi ticker, and turns taps into
 * commands. Nothing here mutates the world: every action goes through
 * `session.dispatch`, which is the same route the balance simulator's scripted
 * AI takes.
 *
 * Paused, the board stays in view and answers taps — towers and enemies can be
 * inspected, and the build menu previews ranges — but nothing that would change
 * the world goes through until play resumes (docs/GAME_DESIGN.md §17.3).
 */

const ATLAS_SRC = 'assets/atlas/game.json';

/** How close a tap must land to count as hitting a plot. */
const PLOT_HIT_RADIUS = TILE_SIZE * 0.75;
/** And an enemy. Tighter than a plot: enemies crowd, and the nearest one wins. */
const ENEMY_HIT_RADIUS = TILE_SIZE * 0.5;

/** An enemy is held by slot and entity id together; the slot alone is recycled. */
interface EnemyPick {
  slot: number;
  entityId: number;
}

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
  const selectedStageId = useUiStore((state) => state.selectedStageId);
  const setResult = useUiStore((state) => state.setResult);

  const sessionRef = useRef<GameSession | null>(null);
  const boardRef = useRef<BoardView | null>(null);
  const entityRef = useRef<EntityView | null>(null);
  const effectsRef = useRef<EffectsView | null>(null);
  const viewRef = useRef<GameView | null>(null);
  /* Measured on the device rather than inferred; see Diagnostics. */
  const metricsRef = useRef(new FrameMetrics());

  const [unsupported, setUnsupported] = useState(false);
  const [selection, setSelection] = useState<Selection>(NOTHING);
  const [options, setOptions] = useState<readonly BuildOption[]>([]);
  const [tower, setTower] = useState<TowerInfo | null>(null);
  const [previewRadius, setPreviewRadius] = useState(0);
  const [undoLeft, setUndoLeft] = useState(0);
  const [atlas, setAtlas] = useState<AtlasIndex | null>(null);
  const [enemy, setEnemy] = useState<EnemyInfo | null>(null);

  const paused = openPanel === 'pause';

  /* Read by the ticker, which must not re-subscribe when React re-renders. */
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const previewRef = useRef(previewRadius);
  previewRef.current = previewRadius;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const enemyPickRef = useRef<EnemyPick | null>(null);

  /**
   * The one route into the world, so it is also the one place the pause holds.
   * The buttons show as locked too, but a keyboard shortcut or a stray handler
   * must not slip a command through either.
   */
  const dispatch = useCallback((issue: Parameters<GameSession['dispatch']>[0]) => {
    if (pausedRef.current) return;
    sessionRef.current?.dispatch(issue);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(NOTHING);
    setTower(null);
    setOptions([]);
    setPreviewRadius(0);
    enemyPickRef.current = null;
    setEnemy(null);
  }, []);

  /**
   * A tap inspects the enemy under it, opens the build menu on an empty plot,
   * selects the tower on a taken one, or dismisses whatever is open. Enemies
   * are checked first: they walk past plots, and are the smaller target.
   */
  const handleTap = useCallback(
    (logicalX: number, logicalY: number) => {
      const session = sessionRef.current;
      const view = viewRef.current;
      if (session === null || view === null) return;

      const world = view.camera.screenToWorld(logicalX, logicalY);

      const enemySlot = enemyNear(session.world, world.x, world.y, ENEMY_HIT_RADIUS);
      if (enemySlot >= 0) {
        clearSelection();
        const entityId = session.world.enemies.ids[enemySlot] as number;
        enemyPickRef.current = { slot: enemySlot, entityId };
        setEnemy(enemyInfo(session.world, enemySlot, entityId));
        return;
      }

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

      enemyPickRef.current = null;
      setEnemy(null);

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

      const routes = new RouteView(view.layers);
      routes.sync(session.world);

      const board = new BoardView(view.layers);
      boardRef.current = board;
      board.syncPlots(session.world);

      const entities = new EntityView(view.layers);
      entityRef.current = entities;
      const effects = new EffectsView(view.layers);
      effectsRef.current = effects;

      /* Atlas first, so entities never appear as blank textures that pop in
         a frame later. */
      void (async () => {
        await initAssets({
          bundles: [{ name: 'core', assets: [{ alias: 'game', src: ATLAS_SRC }] }],
        });
        await loadBundle('core');
        const sheet = Assets.get<Spritesheet>('game');
        if (sheet !== undefined) {
          entities.bindAtlas(sheet, session.world);
          /* The same image, cut up for the interface's icons. */
          setAtlas(indexAtlas(sheet.data, ATLAS_SRC));
        }
      })();

      view.camera.setWorldSize(
        session.world.config.widthTiles * TILE_SIZE,
        session.world.config.heightTiles * TILE_SIZE,
      );
      view.camera.centreOnWorld();

      let started = false;
      /* The board's own clock, for arrows and pulses. It stops with the pause,
         so a paused board is a still frame rather than a map that keeps
         moving under a frozen fight. */
      let boardMs = 0;
      let lastNow = -1;
      view.app.ticker.add(() => {
        const now = performance.now();
        if (!started) {
          session.start(now);
          started = true;
        }
        if (lastNow >= 0 && !pausedRef.current) boardMs += now - lastNow;
        lastNow = now;

        metricsRef.current.record(now);
        const alpha = session.update(now, () => entities.captureForInterpolation());

        entities.sync(session.world);
        effects.consume(session.world);
        /* Both consumers have read the buffer, so it can be dropped. */
        session.clearEvents();

        routes.render(session.world, boardMs);
        board.render(
          session.world,
          selectionRef.current.plotId,
          previewRef.current,
          selectionRef.current.towerSlot,
        );

        /* Ringed only while the slot still holds the enemy that was picked;
           the panel closes on the next poll once it does not. */
        const pick = enemyPickRef.current;
        const enemies = session.world.enemies;
        const ringed =
          pick !== null &&
          enemies.isAlive(pick.slot) &&
          (enemies.ids[pick.slot] as number) === pick.entityId
            ? pick.slot
            : -1;
        entities.render(session.world, alpha, ringed);

        /* Death puffs count down per frame; skipping them holds them mid-fade. */
        if (!pausedRef.current) effects.render();
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

      const pick = enemyPickRef.current;
      if (pick !== null) {
        const info = enemyInfo(session.world, pick.slot, pick.entityId);
        /* Dead or through: the panel goes with it. */
        if (info === null) enemyPickRef.current = null;
        setEnemy(info);
      }

      if (session.world.finished) {
        /* Captured before navigating: the session is torn down with this
           screen, and the results screen has nothing to read otherwise. */
        setResult(session.result());
        navigate('results');
      }
    }, 100);
    return () => clearInterval(id);
  }, [navigate, setResult]);

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
      /* Paused, keys that would act do nothing — including picking a build
         option, which would otherwise close the menu as if it had built. */
      if (pausedRef.current) return;
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

  const readNextWave = useCallback(() => {
    const session = sessionRef.current;
    return session === null ? null : nextWave(session.world);
  }, []);

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
    sessionRef.current?.setPaused(paused);
  }, [paused]);

  const restart = useCallback(() => {
    sessionRef.current?.restart();
    closePanel();
    clearSelection();
  }, [closePanel, clearSelection]);

  return (
    <div
      className={`ui-screen ui-screen--stage${paused ? ' ui-screen--paused' : ''}`}
      data-testid="screen-in-stage"
    >
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
          <Hud
            source={hudSource}
            onSpeed={(speed) => dispatch((q) => setSpeed(q, speed))}
            onRestart={restart}
            onQuit={() => navigate('stageSelect')}
          />

          <WavePreview
            read={readNextWave}
            atlas={atlas}
            nameOf={enemyName}
            onCall={() => dispatch(callWave)}
            locked={paused}
          />

          <Diagnostics
            read={() => metricsRef.current.stats()}
            timeToFirstFrameMs={() => metricsRef.current.timeToFirstFrameMs}
            enemies={() => sessionRef.current?.world.enemies.count ?? 0}
          />

          {selection.plotId >= 0 && selection.towerSlot < 0 && options.length > 0 && (
            <BuildMenu
              options={options}
              at={selection.screen}
              onBuild={build}
              onCancel={clearSelection}
              locked={paused}
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
              locked={paused}
            />
          )}

          {enemy !== null && (
            <EnemyPanel
              enemy={enemy}
              atlas={atlas}
              nameOf={enemyName}
              statusOf={statusName}
              onClose={clearSelection}
            />
          )}
        </>
      )}
    </div>
  );
}
