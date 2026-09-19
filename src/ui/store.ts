import { create } from 'zustand';
import type { StageResult } from '@sim/index';

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

export type Screen =
  'splash' | 'menu' | 'regionMap' | 'stageSelect' | 'inStage' | 'results' | 'settings';

export type PanelId = 'towerInfo' | 'wavePreview' | 'buildMenu' | 'pause';

export interface UiState {
  screen: Screen;
  /** Where `goBack` returns to. One level; the router is a shallow tree. */
  previousScreen: Screen | null;
  selectedStageId: string | null;
  /** Simulation entity id of the selected tower. An id, never the entity. */
  selectedEntityId: number | null;
  openPanel: PanelId | null;
  /**
   * The outcome of the run just finished.
   *
   * Simulation state does not belong here, and this is not an exception: it is
   * an immutable value describing a run that has already ended, captured once
   * so the results screen can read it after the stage has been torn down.
   * Nothing updates it at 60Hz, and nothing reads it to decide what happens
   * next in the world.
   */
  lastResult: StageResult | null;

  navigate: (screen: Screen) => void;
  goBack: () => void;
  selectStage: (stageId: string | null) => void;
  selectEntity: (entityId: number | null) => void;
  setResult: (result: StageResult | null) => void;
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
  'previousScreen',
  'selectedStageId',
  'selectedEntityId',
  'openPanel',
  'lastResult',
  'navigate',
  'goBack',
  'selectStage',
  'selectEntity',
  'setResult',
  'openPanelById',
  'closePanel',
  'reset',
] as const;

const INITIAL = {
  screen: 'splash' as Screen,
  previousScreen: null,
  selectedStageId: null,
  selectedEntityId: null,
  openPanel: null,
  lastResult: null,
};

export const useUiStore = create<UiState>((set) => ({
  ...INITIAL,

  navigate: (screen) =>
    set((state) =>
      state.screen === screen
        ? state
        : {
            screen,
            previousScreen: state.screen,
            /* Leaving a screen closes whatever it had open; a panel surviving a
               navigation would reappear over an unrelated screen. */
            openPanel: null,
            selectedEntityId: null,
          },
    ),

  goBack: () =>
    set((state) =>
      state.previousScreen === null
        ? state
        : { screen: state.previousScreen, previousScreen: null, openPanel: null },
    ),

  selectStage: (selectedStageId) => set({ selectedStageId }),

  setResult: (lastResult) => set({ lastResult }),

  selectEntity: (selectedEntityId) =>
    set((state) => (state.selectedEntityId === selectedEntityId ? state : { selectedEntityId })),

  openPanelById: (openPanel) =>
    set((state) => (state.openPanel === openPanel ? state : { openPanel })),

  closePanel: () => set((state) => (state.openPanel === null ? state : { openPanel: null })),

  reset: () => set({ ...INITIAL }),
}));
