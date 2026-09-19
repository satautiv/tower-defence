// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '@ui/components/index';
import { BINDINGS, focusOf, keyAction, nextSpeed } from '@ui/keys';
import type { KeyPress, StageKeyState } from '@ui/keys';

/**
 * Desktop shortcuts (#28). The rules that matter most are the ones that keep
 * keys from doing harm: a browser's own shortcut, a held key, a stray R in the
 * middle of a wave, a Space meant for the button the keyboard is on.
 */

afterEach(cleanup);

const press = (key: string, extra: Partial<KeyPress> = {}): KeyPress => ({
  key,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  typing: false,
  onFocusedControl: false,
  ...extra,
});

const PLAYING: StageKeyState = {
  paused: false,
  finished: false,
  buildOptions: 0,
  towerSelected: false,
  somethingSelected: false,
};

describe('while playing', () => {
  it.each([
    [' ', 'callWave'],
    ['p', 'togglePause'],
    ['P', 'togglePause'],
    ['f', 'cycleSpeed'],
    ['u', 'undo'],
  ])('%j does %s', (key, kind) => {
    expect(keyAction(press(key), PLAYING)).toEqual({ kind });
  });

  it('builds the numbered option only while the build menu is open', () => {
    expect(keyAction(press('2'), PLAYING)).toBeNull();
    const menu = { ...PLAYING, buildOptions: 3, somethingSelected: true };
    expect(keyAction(press('2'), menu)).toEqual({ kind: 'build', option: 1 });
    expect(keyAction(press('4'), menu)).toBeNull();
  });

  it('upgrades and sells only with a tower selected', () => {
    expect(keyAction(press('e'), PLAYING)).toBeNull();
    expect(keyAction(press('Delete'), PLAYING)).toBeNull();

    const tower = { ...PLAYING, towerSelected: true, somethingSelected: true };
    expect(keyAction(press('e'), tower)).toEqual({ kind: 'upgrade' });
    expect(keyAction(press('Delete'), tower)).toEqual({ kind: 'sell' });
    expect(keyAction(press('Backspace'), tower)).toEqual({ kind: 'sell' });
  });

  it('closes what is open on Escape, and pauses once nothing is', () => {
    expect(keyAction(press('Escape'), { ...PLAYING, somethingSelected: true })).toEqual({
      kind: 'deselect',
    });
    expect(keyAction(press('Escape'), PLAYING)).toEqual({ kind: 'togglePause' });
  });

  /* A stray key must not throw a run away mid-wave. */
  it('ignores R', () => {
    expect(keyAction(press('r'), PLAYING)).toBeNull();
  });
});

describe('while paused', () => {
  const PAUSED = { ...PLAYING, paused: true };

  it('resumes on P and on Escape', () => {
    expect(keyAction(press('p'), PAUSED)).toEqual({ kind: 'togglePause' });
    expect(keyAction(press('Escape'), PAUSED)).toEqual({ kind: 'togglePause' });
  });

  it('restarts on R, as the pause menu offers', () => {
    expect(keyAction(press('r'), PAUSED)).toEqual({ kind: 'restart' });
  });

  /* The board can be read, not changed. */
  it('lets nothing act on the world', () => {
    const everything = { ...PAUSED, buildOptions: 3, towerSelected: true };
    for (const key of [' ', 'f', 'u', 'e', 'Delete', '1']) {
      expect(keyAction(press(key), everything), key).toBeNull();
    }
  });
});

describe('once the stage is over', () => {
  const FINISHED = { ...PLAYING, finished: true };

  it('retries on R, and does nothing else', () => {
    expect(keyAction(press('r'), FINISHED)).toEqual({ kind: 'restart' });
    for (const key of [' ', 'p', 'Escape', 'f']) {
      expect(keyAction(press(key), FINISHED), key).toBeNull();
    }
  });
});

describe('keys that are not ours', () => {
  it.each([
    ['Ctrl+R, which reloads', press('r', { ctrlKey: true })],
    ['Cmd+P, which prints', press('p', { metaKey: true })],
    ['Alt+F, which opens a menu', press('f', { altKey: true })],
  ])('leaves %s to the browser', (_label, key) => {
    expect(keyAction(key, { ...PLAYING, paused: true })).toBeNull();
  });

  /* A held Space would otherwise call every wave there is. */
  it('ignores a key held down', () => {
    expect(keyAction(press(' ', { repeat: true }), PLAYING)).toBeNull();
  });

  it('ignores keys typed into a field', () => {
    expect(keyAction(press('p', { typing: true }), PLAYING)).toBeNull();
  });

  /* A player tabbing through the interface gets the control they are on. */
  it('leaves Space and Enter to a button the keyboard focused', () => {
    expect(keyAction(press(' ', { onFocusedControl: true }), PLAYING)).toBeNull();
    expect(keyAction(press('Enter', { onFocusedControl: true }), PLAYING)).toBeNull();
    expect(keyAction(press('p', { onFocusedControl: true }), PLAYING)).toEqual({
      kind: 'togglePause',
    });
  });
});

describe('stepping the speed', () => {
  it('goes up one step at a time and wraps back to 1x', () => {
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(3);
    expect(nextSpeed(3)).toBe(1);
  });
});

describe('where focus is', () => {
  it('recognises a text field', () => {
    render(<input data-testid="field" />);
    expect(focusOf(screen.getByTestId('field'), false).typing).toBe(true);
  });

  /* A clicked button keeps focus; only one tabbed to belongs to the keyboard. */
  it("counts a focused control as the keyboard player's only if they tabbed there", () => {
    render(<button type="button">Go</button>);
    const button = screen.getByRole('button');
    button.focus();

    expect(focusOf(button, false).onFocusedControl).toBe(false);
    expect(focusOf(button, true).onFocusedControl).toBe(true);
  });

  it('handles a key with no element behind it', () => {
    expect(focusOf(null, true)).toEqual({ typing: false, onFocusedControl: false });
  });
});

describe('what the buttons say', () => {
  it('draws the key and announces it', () => {
    render(<Button shortcut={BINDINGS.callWave}>Call now</Button>);
    const button = screen.getByRole('button', { name: /Call now/ });

    expect(button).toHaveAttribute('aria-keyshortcuts', 'Space');
    expect(button.querySelector('kbd')).toHaveTextContent('Space');
  });

  it('draws nothing for a button without one', () => {
    render(<Button>Close</Button>);
    expect(screen.getByRole('button').querySelector('kbd')).toBeNull();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-keyshortcuts');
  });
});
