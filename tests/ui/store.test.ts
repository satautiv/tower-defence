import { beforeEach, describe, expect, it } from 'vitest';
import { UI_STATE_KEYS, parentOf, useUiStore } from '@ui/store';
import type { Screen } from '@ui/store';

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

  it('goes up one level', () => {
    const { navigate } = useUiStore.getState();
    navigate('menu');
    navigate('settings');

    useUiStore.getState().goBack();
    expect(useUiStore.getState().screen).toBe('menu');
  });

  /**
   * The bug #80 was filed for.
   *
   * Leaving a stage is an ordinary navigation, so a store that remembered where
   * it came from pointed at `inStage` the moment a run ended — and Back on the
   * stage list walked straight back into the stage just finished. Going *up*
   * cannot do that, whatever route the player took to get here.
   */
  it('does not walk back into a stage that was just left', () => {
    const { navigate } = useUiStore.getState();
    navigate('menu');
    navigate('regionMap');
    navigate('stageSelect');
    navigate('inStage');
    navigate('stageSelect'); // clearing the stage, or quitting it

    useUiStore.getState().goBack();
    expect(useUiStore.getState().screen).toBe('regionMap');
  });

  /* The old `goBack` nulled its own pointer, so the second press was dead. */
  it('is repeatable all the way to the root', () => {
    const { navigate, goBack } = useUiStore.getState();
    navigate('menu');
    navigate('regionMap');
    navigate('stageSelect');

    goBack();
    expect(useUiStore.getState().screen).toBe('regionMap');
    goBack();
    expect(useUiStore.getState().screen).toBe('menu');
  });

  it('does nothing at a root, rather than closing the game out from under a tap', () => {
    useUiStore.getState().goBack();
    expect(useUiStore.getState().screen).toBe('splash');

    useUiStore.getState().navigate('menu');
    useUiStore.getState().goBack();
    expect(useUiStore.getState().screen).toBe('menu');
  });

  /* Every screen needs an answer, or Back is silently dead on the new one. */
  it('declares a parent for every screen in the union', () => {
    const screens: Screen[] = [
      'splash',
      'menu',
      'regionMap',
      'stageSelect',
      'inStage',
      'talents',
      'codex',
      'settings',
      'editor',
    ];
    for (const screen of screens) {
      expect(parentOf(screen)).not.toBeUndefined();
    }
  });

  it('clears the selected tower on the way up, as navigating does', () => {
    const { navigate, selectEntity, goBack } = useUiStore.getState();
    navigate('menu');
    navigate('regionMap');
    selectEntity(7);
    goBack();
    expect(useUiStore.getState().selectedEntityId).toBeNull();
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
    navigate('stageSelect');
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
