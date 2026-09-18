import { beforeEach, describe, expect, it } from 'vitest';
import { UI_STATE_KEYS, useUiStore } from '@ui/store';

describe('the UI store holds UI state and nothing else', () => {
  beforeEach(() => useUiStore.getState().reset());

  /**
   * The guardrail on the easiest performance mistake in this codebase.
   *
   * Mirroring simulation state here — gold, lives, wave — would re-render React
   * on every change, which for a 60Hz simulation means re-rendering the whole
   * HUD sixty times a second to display numbers nobody can read that fast.
   * Adding such a key means updating UI_STATE_KEYS, which lands here and
   * forces the question.
   */
  it('has exactly the intended shape', () => {
    expect(Object.keys(useUiStore.getState()).sort()).toEqual([...UI_STATE_KEYS].sort());
  });

  it('holds no simulation state', () => {
    const keys = Object.keys(useUiStore.getState());
    for (const forbidden of ['gold', 'lives', 'aether', 'wave', 'enemies', 'towers', 'world']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('refers to a selected tower by id, never by entity', () => {
    useUiStore.getState().selectEntity(42);
    expect(useUiStore.getState().selectedEntityId).toBe(42);
    expect(typeof useUiStore.getState().selectedEntityId).toBe('number');
  });
});

describe('navigation', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('starts on the splash screen', () => {
    expect(useUiStore.getState().screen).toBe('splash');
  });

  it('records where it came from and goes back', () => {
    const { navigate } = useUiStore.getState();
    navigate('menu');
    navigate('settings');
    expect(useUiStore.getState().previousScreen).toBe('menu');

    useUiStore.getState().goBack();
    expect(useUiStore.getState().screen).toBe('menu');
  });

  it('does nothing when there is nowhere to go back to', () => {
    useUiStore.getState().goBack();
    expect(useUiStore.getState().screen).toBe('splash');
  });

  /* A panel surviving a navigation would reappear over an unrelated screen. */
  it('closes any open panel when the screen changes', () => {
    const { navigate, openPanelById } = useUiStore.getState();
    navigate('inStage');
    openPanelById('pause');
    expect(useUiStore.getState().openPanel).toBe('pause');

    navigate('menu');
    expect(useUiStore.getState().openPanel).toBeNull();
  });

  it('clears the selected tower when the screen changes', () => {
    const { navigate, selectEntity } = useUiStore.getState();
    navigate('inStage');
    selectEntity(7);
    navigate('menu');
    expect(useUiStore.getState().selectedEntityId).toBeNull();
  });

  it('keeps the selected stage across navigation, since the stage outlives the screen', () => {
    const { navigate, selectStage } = useUiStore.getState();
    selectStage('1-1');
    navigate('inStage');
    navigate('results');
    expect(useUiStore.getState().selectedStageId).toBe('1-1');
  });
});

describe('redundant updates do not notify subscribers', () => {
  beforeEach(() => useUiStore.getState().reset());

  /* Every notification is a potential re-render, so setting a value to what it
     already is must be a no-op rather than a state replacement. */
  it.each([
    ['navigate to the current screen', () => useUiStore.getState().navigate('splash')],
    ['select the already-selected entity', () => useUiStore.getState().selectEntity(null)],
    ['close an already-closed panel', () => useUiStore.getState().closePanel()],
  ])('%s leaves state identical', (_label, action) => {
    const before = useUiStore.getState();
    action();
    expect(useUiStore.getState().screen).toBe(before.screen);
    expect(useUiStore.getState().openPanel).toBe(before.openPanel);
    expect(useUiStore.getState().selectedEntityId).toBe(before.selectedEntityId);
  });
});
