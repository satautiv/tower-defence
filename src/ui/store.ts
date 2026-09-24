import { create } from 'zustand';

/**
 * UI state, and nothing else.
 *
 * What belongs here: which screen is showing, which panel is open, which tower
 * the player has selected. What does not: gold, lives, enemy positions, wave
 * number — anything the simulation owns.
 *
 * The reason is performance, not tidiness. Zustand notifies subscribers on every
 * change; mirroring simulation state here would re-render React at 60Hz and
 * spend the frame budget on a number nobody can read that fast. The HUD instead
 * polls the simulation through useThrottledValue at ~10Hz
 * (docs/TECH_DESIGN.md §10).
 *
 * `UI_STATE_KEYS` below pins this down, and a test fails if the shape grows.
 */

/**
 * `editor` is reachable only in a dev build (#34). It is in the union because
 * the store is typed, not because a player can get there — `Router` refuses it
 * in production and the screen itself is never bundled.
 */
export type Screen =
  | 'splash'
  | 'menu'
  | 'regionMap'
  | 'stageSelect'
  | 'inStage'
  | 'talents'
  | 'codex'
  | 'settings'
  | 'editor';

/**
 * Panels that sit over the board.
 *
 * `codex` is here rather than being a screen of its own *while a stage is
 * running*, and that is #38's second acceptance criterion: "accessible while
 * paused during a stage, without leaving the board". Navigating would unmount
 * the renderer, and coming back would rebuild the whole Pixi application over
 * a run the player had merely wanted to look something up in.
 */
export type PanelId = 'towerInfo' | 'wavePreview' | 'buildMenu' | 'pause' | 'codex';

/**
 * Panels that hold the board still.
 *
 * The Codex opens *as* a panel, which means it replaces the pause panel — and
 * if "paused" meant only `pause`, a player who tapped Codex to look up a
 * Nullifier would have the wave start moving again behind the page they opened
 * to understand it. Stated here rather than in the stage screen because which
 * panels pause is a fact about panels, and a test should not have to mount
 * Pixi to ask.
 */
const PAUSING_PANELS: readonly PanelId[] = ['pause', 'codex'];

export function isPaused(panel: PanelId | null): boolean {
  return panel !== null && PAUSING_PANELS.includes(panel);
}

/**
 * Where Back goes from each screen. Declared, never remembered.
 *
 * The store used to keep a `previousScreen` — the last screen navigated away
 * from — which answers *where was I* rather than *where is up*. Those two agree
 * only while the player is moving down the tree, and leaving a stage is itself
 * an ordinary navigation: after a run it pointed at `inStage`, so Back on the
 * stage list walked straight back into the stage just finished (#80).
 *
 * A declared parent cannot be poisoned by how the player arrived, and it makes
 * Back repeatable — the old `goBack` nulled its own pointer, so a second press
 * did nothing at all.
 *
 * `splash` and `menu` are roots: Back from either is a no-op rather than an
 * exit, because nothing in a game should close itself out from under a tap.
 */
const PARENT: Readonly<Record<Screen, Screen | null>> = {
  splash: null,
  menu: null,
  regionMap: 'menu',
  stageSelect: 'regionMap',
  inStage: 'stageSelect',
  talents: 'menu',
  codex: 'menu',
  settings: 'menu',
  editor: 'menu',
};

/** Which screen sits above this one, or null at a root. */
export function parentOf(screen: Screen): Screen | null {
  return PARENT[screen];
}

export interface UiState {
  screen: Screen;
  selectedStageId: string | null;
  /**
   * Which way the selected stage is being played (#48).
   *
   * Null until a mode is chosen, which is what makes a challenge impossible to
   * enter by accident: tapping a stage opens its modes, and nothing starts
   * until one of them is tapped too.
   */
  selectedModeId: string | null;
  /** Simulation entity id of the selected tower. An id, never the entity. */
  selectedEntityId: number | null;
  openPanel: PanelId | null;

  navigate: (screen: Screen) => void;
  goBack: () => void;
  selectStage: (stageId: string | null) => void;
  selectMode: (modeId: string | null) => void;
  selectEntity: (entityId: number | null) => void;
  openPanelById: (panel: PanelId) => void;
  closePanel: () => void;
  reset: () => void;
}

/**
 * The complete, intended shape. Adding simulation state to the store means
 * adding a key here, which fails tests/ui/store.test.ts — a deliberate speed
 * bump in front of the easiest performance mistake available in this codebase.
 */
export const UI_STATE_KEYS = [
  'screen',
  'selectedStageId',
  'selectedModeId',
  'selectedEntityId',
  'openPanel',
  'navigate',
  'goBack',
  'selectStage',
  'selectMode',
  'selectEntity',
  'openPanelById',
  'closePanel',
  'reset',
] as const;

const INITIAL = {
  screen: 'splash' as Screen,
  selectedStageId: null,
  selectedModeId: null,
  selectedEntityId: null,
  openPanel: null,
};

export const useUiStore = create<UiState>((set) => ({
  ...INITIAL,

  navigate: (screen) =>
    set((state) =>
      state.screen === screen
        ? state
        : {
            screen,
            /* Leaving a screen closes whatever it had open; a panel surviving a
               navigation would reappear over an unrelated screen. */
            openPanel: null,
            selectedEntityId: null,
          },
    ),

  /* Up one level, not back one step. `PARENT` says which, and why. */
  goBack: () =>
    set((state) => {
      const up = PARENT[state.screen];
      return up === null ? state : { screen: up, openPanel: null, selectedEntityId: null };
    }),

  /* Choosing a stage forgets the last mode, so the picker opens on nothing
     chosen rather than on whatever the previous stage was played as. */
  selectStage: (selectedStageId) => set({ selectedStageId, selectedModeId: null }),

  selectMode: (selectedModeId) => set({ selectedModeId }),

  selectEntity: (selectedEntityId) =>
    set((state) => (state.selectedEntityId === selectedEntityId ? state : { selectedEntityId })),

  openPanelById: (openPanel) =>
    set((state) => (state.openPanel === openPanel ? state : { openPanel })),

  closePanel: () => set((state) => (state.openPanel === null ? state : { openPanel: null })),

  reset: () => set({ ...INITIAL }),
}));
