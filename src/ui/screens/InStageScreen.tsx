import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { TILE_SIZE } from '@core/constants';
import type { GameSpeed } from '@core/constants';
import {
  buildOptions,
  buildTower,
  callWave,
  enemyInfo,
  enemyNear,
  bossInfo,
  nextWave,
  plotInfo,
  prospectiveRange,
  sellTower,
  setRally,
  setTargetMode,
  castHeroAbility,
  castPower,
  heroInfo,
  powerOptions,
  setSpeed,
  SimEventKind,
  specialiseTower,
  towerInfo,
  undoBuild,
  undoSecondsRemaining,
  upgradeTower,
} from '@sim/index';
import type {
  BuildOption,
  EnemyInfo,
  HeroInfo,
  PowerOption,
  StageResult,
  TowerInfo,
  World,
} from '@sim/index';
import { GameSession } from '@app/session';
import { useProfile } from '@app/profile';
import {
  clearSession,
  readSession,
  resumeInto,
  sessionMatches,
  writeSession,
} from '@app/sessionSnapshot';
import type { SavedSession } from '@app/sessionSnapshot';
import { platform } from '@platform/index';
import type { GameView } from '@view/app';
import { BoardView } from '@view/board';
import { EffectsView } from '@view/effects';
import { BehavioursView } from '@view/behaviours';
import { ReactionsView } from '@view/reactions';
import { AudioDirector } from '@audio/index';
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
import { StageResults } from '../stage/StageResults.js';
import { HeroBar } from '../stage/HeroBar.js';
import { PowerBar } from '../stage/PowerBar.js';
import { TowerPanel } from '../stage/TowerPanel.js';
import { WavePreview } from '../stage/WavePreview.js';
import { BossBar } from '../stage/BossBar.js';
import { useUiStore } from '../store.js';
import { focusOf, keyAction, nextSpeed } from '../keys.js';
import type { KeyAction } from '../keys.js';
import { useSettings } from '../settings.js';
import {
  enemyName,
  text,
  heroAbilityName,
  heroName,
  powerName,
  towerName,
  reactionName,
  statusName,
} from '../text.js';

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

/**
 * Starts a stage at the speed the player last chose (docs/GAME_DESIGN.md
 * §15.3: speed persists across stages). A command like any other, applied at
 * the first tick, so a replay records it and nothing reaches into the world.
 */
function applyPreferredSpeed(session: GameSession): void {
  const speed = useSettings.getState().speed;
  if (speed !== session.world.speed) session.dispatch((queue) => setSpeed(queue, speed));
}

export function InStageScreen(): ReactElement {
  const recordResult = useProfile((state) => state.recordResult);
  const navigate = useUiStore((state) => state.navigate);
  const openPanel = useUiStore((state) => state.openPanel);
  const closePanel = useUiStore((state) => state.closePanel);
  const openPanelById = useUiStore((state) => state.openPanelById);
  const selectedStageId = useUiStore((state) => state.selectedStageId);

  const sessionRef = useRef<GameSession | null>(null);
  const boardRef = useRef<BoardView | null>(null);
  const entityRef = useRef<EntityView | null>(null);
  const effectsRef = useRef<EffectsView | null>(null);
  const reactionsRef = useRef<ReactionsView | null>(null);
  const behavioursRef = useRef<BehavioursView | null>(null);
  const audioRef = useRef<AudioDirector | null>(null);
  /* Subscribed rather than read once: the toggle has to re-render its label. */
  const muted = useSettings((state) => state.muted);
  /**
   * Tower whose rally flag the next board tap will move, or -1.
   *
   * Tap-to-place rather than a true drag: the flag is a world position and the
   * board already turns a tap into one, so a drag would be a second input path
   * doing the same job — and on a phone a drag across the board is a pan.
   */
  const [rallyFor, setRallyFor] = useState(-1);
  const rallyForRef = useRef(-1);
  rallyForRef.current = rallyFor;

  /**
   * Power awaiting a target tap, or -1.
   *
   * Armed from the bar and cast by the next tap on the board, the same shape
   * the rally flag uses — a power is a point, and the board already turns a
   * tap into one.
   */
  const [armedPower, setArmedPower] = useState(-1);
  const armedPowerRef = useRef(-1);
  armedPowerRef.current = armedPower;
  const [powers, setPowers] = useState<PowerOption[]>([]);
  const [hero, setHero] = useState<HeroInfo | null>(null);

  /**
   * Hero ability awaiting a target tap, or -1.
   *
   * A third thing that can be waiting for the same click, so arming any one of
   * them clears the other two — the board must never have to guess which of a
   * power, a rally flag and an ability a tap was meant for.
   */
  const [armedAbility, setArmedAbility] = useState(-1);
  const armedAbilityRef = useRef(-1);
  armedAbilityRef.current = armedAbility;
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
  /* Set once the stage ends; the results sit over the board it ended on. */
  const [result, setResult] = useState<StageResult | null>(null);

  const paused = openPanel === 'pause';

  /* Read by the ticker, which must not re-subscribe when React re-renders. */
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const previewRef = useRef(previewRadius);
  previewRef.current = previewRadius;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /* The poll below is set up once, so anything it reads has to come through a
     ref rather than be captured from this render. */
  /* One record per run. Cleared by Retry, which begins a new one. */
  /**
   * The saved run, or null for none. `undefined` while it is still being read.
   *
   * The canvas is not mounted until this settles, because the session is built
   * inside `onReady` and needs the saved run's seed to be resumable at all.
   * Reading a key out of IndexedDB is fast; a frame or two of empty board is
   * cheaper than a resume that cannot work.
   */
  const [savedRun, setSavedRun] = useState<SavedSession | null | undefined>(undefined);
  const savedRunRef = useRef<SavedSession | null>(null);
  savedRunRef.current = savedRun ?? null;

  const recordedRef = useRef(false);
  const stageIdRef = useRef(selectedStageId);
  stageIdRef.current = selectedStageId;

  const finishedRef = useRef(result !== null);
  finishedRef.current = result !== null;
  const enemyPickRef = useRef<EnemyPick | null>(null);

  useEffect(() => {
    let live = true;
    void readSession().then((saved) => {
      if (live) setSavedRun(saved);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * The last reliable moment to write.
   *
   * A backgrounded page on a phone may never run code again, so `pause` is
   * where the run is saved — not a timer, and not the results screen. The
   * write is fire-and-forget because there may be no time to await it.
   */
  useEffect(() => {
    const lifecycle = platform().lifecycle;
    return lifecycle.subscribe((event) => {
      const session = sessionRef.current;
      const stageId = stageIdRef.current;
      if (event !== 'pause' || session === null || stageId === null) return;
      /* A finished stage has nothing worth resuming, and saving one would put
         the player back on a results screen they had already dismissed. */
      if (session.world.finished) {
        void clearSession();
        return;
      }
      void writeSession(session.world, stageId, Date.now()).catch((error: unknown) =>
        console.warn('Could not save the run in progress.', error),
      );
      openPanelById('pause');
    });
  }, [openPanelById]);

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
    setRallyFor(-1);
    setArmedPower(-1);
    setArmedAbility(-1);
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

      /* The browser will only start audio from inside a real gesture, and this
         is the first one every player makes. Cheap and idempotent after that. */
      audioRef.current?.unlock();

      /* Armed from the hero bar: this tap is where the ability lands. */
      const ability = armedAbilityRef.current;
      if (ability >= 0) {
        const target = view.camera.screenToWorld(logicalX, logicalY);
        session.dispatch((queue) => castHeroAbility(queue, ability, target.x, target.y));
        setArmedAbility(-1);
        return;
      }

      /* Armed from the power bar: this tap is where the power lands. Checked
         before the rally, because a player who armed a power last meant that. */
      const power = armedPowerRef.current;
      if (power >= 0) {
        const target = view.camera.screenToWorld(logicalX, logicalY);
        session.dispatch((queue) => castPower(queue, power, target.x, target.y));
        setArmedPower(-1);
        return;
      }

      /* Armed by the tower panel: this tap is the flag's new home, not a
         selection. The simulation clamps it to the tower's rally range. */
      const armed = rallyForRef.current;
      if (armed >= 0) {
        const target = view.camera.screenToWorld(logicalX, logicalY);
        session.dispatch((queue) => setRally(queue, armed, target.x, target.y));
        setRallyFor(-1);
        return;
      }

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
      setOptions(buildOptions(session.world, nearest.id));
      setTower(null);
    },
    [clearSelection],
  );

  const handleReady = useCallback(
    (view: GameView) => {
      viewRef.current = view;

      const stageId = selectedStageId ?? '1-1';
      /**
       * A run interrupted by a backgrounding is rebuilt from its own seed.
       *
       * This has to happen before the session exists, not after: `forStage`
       * mints a seed from the clock, so a world built first and restored into
       * second would carry a seed the snapshot does not match — and the
       * snapshot's own guard would refuse it, correctly. Found by resuming a
       * run in a browser and reading the refusal.
       */
      const saved = savedRunRef.current;
      const resuming = saved !== null && sessionMatches(saved, stageId) ? saved : null;

      const session = GameSession.forStage(stageId, resuming?.snapshot.seed);
      if (session === null) return;
      sessionRef.current = session;
      applyPreferredSpeed(session);

      if (resuming !== null) {
        if (resumeInto(session.world, resuming, stageId)) {
          /* Held on the pause menu rather than dropped straight back into a
             wave that was halfway to the core when the phone rang
             (docs/TECH_DESIGN.md §14). */
          openPanelById('pause');
        } else {
          void clearSession();
        }
      }

      const routes = new RouteView(view.layers);
      routes.sync(session.world);

      const board = new BoardView(view.layers);
      boardRef.current = board;
      board.syncPlots(session.world);

      const entities = new EntityView(view.layers);
      entityRef.current = entities;
      const effects = new EffectsView(view.layers);
      effectsRef.current = effects;
      const reactions = new ReactionsView(view.layers);
      reactionsRef.current = reactions;
      const behaviours = new BehavioursView(view.layers);
      behavioursRef.current = behaviours;

      /* Created here, but silent until a gesture unlocks it: every mobile
         browser refuses to start audio otherwise, and a context opened too
         early is born suspended and stays that way. */
      const audio = audioRef.current ?? new AudioDirector();
      audioRef.current = audio;
      const settings = useSettings.getState();
      audio.setVolume(settings.volume);
      audio.setMuted(settings.muted);

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
        reactions.consume(session.world, reactionName);
        audio.consume(session.world, now);
        /* A boss going down stops the board dead and then runs it slowly
           (#33, §17.2). Read from the event buffer here rather than decided
           inside the simulation, which has no business knowing what the
           presentation does about a death it reported. */
        if (killedABoss(session.world)) session.playDefeatSequence(now);
        /* Every consumer has read the buffer, so it can be dropped. */
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

        /* Death puffs and reaction bursts count down per frame; skipping them
           holds them mid-fade rather than finishing while nothing moves. */
        if (!pausedRef.current) {
          effects.render();
          reactions.render();
          /* Fed from the world rather than only from events, because a
             standing aura is a state and has to keep being drawn (#29). */
          behaviours.render(session.world);
        }
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

      /* Aether and cooldowns both move continuously, so the bar is polled with
         everything else rather than pushed at. */
      setPowers(powerOptions(session.world));
      setHero(heroInfo(session.world));

      /* Kept in the stage rather than routed to a screen of its own: leaving
         would tear the renderer down, and Retry would have to build it again. */
      if (session.world.finished && !recordedRef.current) {
        /* Guarded by a ref rather than by `result`, and recorded out here
           rather than inside the updater below. A state updater must be pure —
           StrictMode double-invokes it in development — and a run recorded
           from inside one is counted twice. Found by playing a stage in a
           browser and reading back a profile that said two attempts. */
        recordedRef.current = true;
        const finished = session.result();
        /* Nothing left to resume. */
        void clearSession();
        /* Recorded on the tick the stage ends rather than when the player
           dismisses the results, so closing the tab on the victory screen
           still keeps the run. */
        if (stageIdRef.current !== null) recordResult(stageIdRef.current, finished);
        setResult((shown) => shown ?? finished);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  /**
   * Builds, then applies whatever mode this tower type was last set to.
   *
   * Two commands rather than a parameter on the first: the build has to land
   * before there is a slot to address, and both go through the queue so the
   * balance simulator sees exactly what a player does.
   */
  const build = useCallback(
    (typeIdx: number) => {
      const plotId = selectionRef.current.plotId;
      if (plotId < 0) return;
      const session = sessionRef.current;
      if (session === null) return;

      const towerId = session.world.rules.towers.ids[typeIdx];
      const preferred =
        towerId === undefined ? undefined : useSettings.getState().targetModes[towerId];

      dispatch((queue) => buildTower(queue, plotId, typeIdx, preferred ?? 0));
      clearSelection();
    },
    [dispatch, clearSelection],
  );

  const readNextWave = useCallback(() => {
    const session = sessionRef.current;
    return session === null ? null : nextWave(session.world);
  }, []);

  const readBoss = useCallback(() => {
    const session = sessionRef.current;
    return session === null ? null : bossInfo(session.world);
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

  /**
   * The one restart, from the pause menu and from the results alike (§17.3:
   * one tap, no confirmation, no loading). The world resets in place — no new
   * renderer, no reload — so it is as fast as a frame.
   */
  const restart = useCallback(() => {
    const session = sessionRef.current;
    session?.restart();
    /* The world resets to 1x; the player's chosen speed is theirs, not the
       run's, so it comes straight back. */
    if (session !== null) applyPreferredSpeed(session);
    effectsRef.current?.reset();
    /* Including the record of which reactions have been named: for the player
       the restarted run's first Thermal Shock is a first Thermal Shock. */
    reactionsRef.current?.reset();
    behavioursRef.current?.feed.clear();
    audioRef.current?.reset();
    closePanel();
    clearSelection();
    /* A new run is a new thing to record. */
    recordedRef.current = false;
    setResult(null);
  }, [closePanel, clearSelection]);

  /** The one place a speed change is asked for, by button or by key. */
  const changeSpeed = useCallback(
    (speed: GameSpeed) => {
      dispatch((q) => setSpeed(q, speed));
      useSettings.getState().setSpeed(speed);
    },
    [dispatch],
  );

  /**
   * Keyboard is an accelerator on desktop; every action has a touch route too.
   * What a key means is decided in keys.ts from the stage's state; this only
   * carries it out, through the same routes the buttons use.
   */
  const perform = useCallback(
    (action: KeyAction) => {
      const session = sessionRef.current;
      if (session === null) return;
      const slot = selectionRef.current.towerSlot;

      switch (action.kind) {
        case 'callWave':
          return dispatch(callWave);
        case 'togglePause':
          return pausedRef.current ? closePanel() : openPanelById('pause');
        case 'cycleSpeed':
          /* From the speed last asked for rather than the world's, so two
             quick presses inside one frame still step twice. */
          return changeSpeed(nextSpeed(useSettings.getState().speed));
        case 'build': {
          const option = buildOptions(session.world)[action.option];
          if (option !== undefined) build(option.typeIdx);
          return;
        }
        case 'upgrade':
          return dispatch((q) => upgradeTower(q, slot));
        case 'sell':
          dispatch((q) => sellTower(q, slot));
          return clearSelection();
        case 'undo':
          dispatch(undoBuild);
          return clearSelection();
        case 'restart':
          return restart();
        case 'deselect':
          return clearSelection();
      }
    },
    [dispatch, closePanel, openPanelById, changeSpeed, build, clearSelection, restart],
  );

  useEffect(() => {
    /* How focus last moved: by Tab, or by a pointer. See focusOf. */
    let tabbedHere = false;
    const onPointer = (): void => {
      tabbedHere = false;
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') tabbedHere = true;
      const session = sessionRef.current;
      if (session === null) return;
      const selected = selectionRef.current;

      const action = keyAction(
        {
          key: event.key,
          repeat: event.repeat,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          ...focusOf(event.target, tabbedHere),
        },
        {
          paused: pausedRef.current,
          finished: finishedRef.current,
          buildOptions:
            selected.plotId >= 0 && selected.towerSlot < 0 ? buildOptions(session.world).length : 0,
          towerSelected: selected.towerSlot >= 0,
          somethingSelected: selected.plotId >= 0 || enemyPickRef.current !== null,
        },
      );
      if (action === null) return;
      /* Handled: Space must not also scroll, nor Backspace navigate back. */
      event.preventDefault();
      perform(action);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [perform]);

  /* Closes the audio context when the stage screen goes away. Left open, a
     suspended context survives the navigation and the next stage opens a
     second one — browsers cap how many a page may hold. */
  useEffect(() => {
    return () => {
      audioRef.current?.destroy();
      audioRef.current = null;
    };
  }, []);

  return (
    <div
      className={`ui-screen ui-screen--stage${paused ? ' ui-screen--paused' : ''}`}
      data-testid="screen-in-stage"
    >
      {!unsupported && savedRun !== undefined && (
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
          {result === null && (
            <HeroBar
              hero={hero}
              armed={armedAbility}
              locked={paused}
              name={heroName}
              abilityName={heroAbilityName}
              onArm={(index) => {
                setRallyFor(-1);
                setArmedPower(-1);
                setArmedAbility((current) => (current === index ? -1 : index));
              }}
            />
          )}

          {result === null && (
            <PowerBar
              powers={powers}
              armed={armedPower}
              locked={paused}
              name={powerName}
              onArm={(index) => {
                /* Arming a power drops any other pending tap, so nothing is
                   ever waiting for the same click as something else. */
                setRallyFor(-1);
                setArmedAbility(-1);
                setArmedPower((current) => (current === index ? -1 : index));
              }}
            />
          )}

          <Hud
            source={hudSource}
            onSpeed={changeSpeed}
            onRestart={restart}
            onQuit={() => navigate('stageSelect')}
            muted={muted}
            onMute={(next) => {
              useSettings.getState().setMuted(next);
              audioRef.current?.setMuted(next);
              /* A player who unmutes from the pause menu has just made a
                 gesture, which is the browser's price of admission. */
              if (!next) audioRef.current?.unlock();
            }}
          />

          {/* Above the wave preview and below the top bar: the one number a
              player must never lose track of while a boss is alive, and
              nothing at all when none is (#33). */}
          {result === null && <BossBar read={readBoss} nameOf={enemyName} />}

          {/* Nothing is coming once the stage is over; "final wave" would be
              a wrong thing to say over a board lost at wave six. */}
          {result === null && (
            <WavePreview
              read={readNextWave}
              atlas={atlas}
              nameOf={enemyName}
              onCall={() => dispatch(callWave)}
              locked={paused}
            />
          )}

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
              name={towerName}
            />
          )}

          {tower !== null && (
            <TowerPanel
              onTargetMode={(mode) => {
                if (tower === null) return;
                dispatch((queue) => setTargetMode(queue, tower.slot, mode));
                /* Remembered for the type, so the next mortar opens the way
                   this one was set. A small thing players notice immediately. */
                useSettings.getState().setTargetMode(tower.id, mode);
              }}
              onRally={
                tower !== null && tower.rallyRangeTiles > 0
                  ? () => setRallyFor((armed) => (armed === tower.slot ? -1 : tower.slot))
                  : undefined
              }
              rallyArmed={tower !== null && rallyFor === tower.slot}
              text={text}
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

          {result !== null && (
            <StageResults
              result={result}
              onRetry={restart}
              onLeave={() => navigate('stageSelect')}
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

/**
 * Whether a boss died this frame.
 *
 * The flag rides on the event because the slot is already freed by the time
 * anything drains the buffer — there is nothing left to ask.
 */
function killedABoss(world: World): boolean {
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.EnemyDied && event.e === 1) return true;
  }
  return false;
}
