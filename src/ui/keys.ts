import { GAME_SPEEDS } from '@core/constants';
import type { GameSpeed } from '@core/constants';

/**
 * Keyboard shortcuts for the stage (#28; docs/GAME_DESIGN.md P6: "keyboard and
 * mouse get hotkeys").
 *
 * The bindings are data, read both by the handler and by the key hints drawn
 * on the buttons, so what a button says and what the key does cannot drift
 * apart — and rebinding (#47) becomes editing this table rather than finding
 * every hard-coded key.
 *
 * Deciding what a key does is a pure function of the key and the stage's
 * state, kept apart from carrying it out, so every rule here is tested without
 * a DOM or a running stage.
 */

export type ShortcutId = 'callWave' | 'pause' | 'speed' | 'upgrade' | 'sell' | 'undo' | 'restart';

export interface Binding {
  /** `KeyboardEvent.key` values, lower-cased for letters. */
  keys: readonly string[];
  /** Shown on the button. */
  label: string;
  /** For `aria-keyshortcuts`, in its own vocabulary. */
  aria: string;
}

export const BINDINGS: Readonly<Record<ShortcutId, Binding>> = {
  callWave: { keys: [' '], label: 'Space', aria: 'Space' },
  pause: { keys: ['p'], label: 'P', aria: 'P' },
  speed: { keys: ['f'], label: 'F', aria: 'F' },
  upgrade: { keys: ['e'], label: 'E', aria: 'E' },
  sell: { keys: ['delete', 'backspace'], label: 'Del', aria: 'Delete' },
  undo: { keys: ['u'], label: 'U', aria: 'U' },
  restart: { keys: ['r'], label: 'R', aria: 'R' },
};

export type KeyAction =
  | { kind: 'callWave' }
  | { kind: 'togglePause' }
  | { kind: 'cycleSpeed' }
  | { kind: 'build'; option: number }
  | { kind: 'upgrade' }
  | { kind: 'sell' }
  | { kind: 'undo' }
  | { kind: 'restart' }
  | { kind: 'deselect' };

/** The parts of a key press that decide what it means. */
export interface KeyPress {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Focus is in a text field, where every key is typing. */
  typing: boolean;
  /** Focus is on a control reached by keyboard, which Space and Enter press natively. */
  onFocusedControl: boolean;
}

export interface StageKeyState {
  paused: boolean;
  /** The results are up; the stage is over. */
  finished: boolean;
  /** Options in the open build menu, or 0 when it is closed. */
  buildOptions: number;
  towerSelected: boolean;
  /** Anything open that Escape should close: build menu, tower or enemy panel. */
  somethingSelected: boolean;
}

const is = (id: ShortcutId, key: string): boolean => BINDINGS[id].keys.includes(key);

export function keyAction(press: KeyPress, stage: StageKeyState): KeyAction | null {
  /* Never a browser's own shortcut — Ctrl+R must still reload — and never a
     key held down: a held Space would otherwise call every wave there is. */
  if (press.ctrlKey || press.metaKey || press.altKey || press.repeat || press.typing) return null;
  const key = press.key.toLowerCase();

  /* Space and Enter on a keyboard-focused button press that button. A player
     tabbing through the interface must get the control they are on. */
  if (press.onFocusedControl && (key === ' ' || key === 'enter')) return null;

  if (stage.finished) return is('restart', key) ? { kind: 'restart' } : null;

  if (key === 'escape')
    return stage.somethingSelected ? { kind: 'deselect' } : { kind: 'togglePause' };
  if (is('pause', key)) return { kind: 'togglePause' };

  /* Paused, the board can be read but not changed; restarting is the one
     action the pause menu itself offers. Mid-wave, R does nothing, so a stray
     key cannot throw a run away. */
  if (stage.paused) return is('restart', key) ? { kind: 'restart' } : null;

  if (is('callWave', key)) return { kind: 'callWave' };
  if (is('speed', key)) return { kind: 'cycleSpeed' };
  if (is('undo', key)) return { kind: 'undo' };

  if (stage.towerSelected) {
    if (is('upgrade', key)) return { kind: 'upgrade' };
    if (is('sell', key)) return { kind: 'sell' };
  }

  if (stage.buildOptions > 0 && /^[1-9]$/.test(key)) {
    const option = Number(key) - 1;
    return option < stage.buildOptions ? { kind: 'build', option } : null;
  }
  return null;
}

/** The next speed up, wrapping from the fastest back to 1x. */
export function nextSpeed(current: number): GameSpeed {
  const index = GAME_SPEEDS.indexOf(current as GameSpeed);
  return GAME_SPEEDS[(index + 1) % GAME_SPEEDS.length] as GameSpeed;
}

/**
 * Whether focus sits somewhere keys are typing, or on a control the player
 * reached with the keyboard.
 *
 * A button clicked with the mouse keeps focus too, and Space would press it
 * again instead of calling the wave — so focus only counts as a keyboard
 * player's when they got there by tabbing. `:focus-visible` cannot tell the
 * difference: browsers switch it on for the focused element as soon as any key
 * is pressed, which is exactly the moment this is asked.
 */
export function focusOf(
  target: EventTarget | null,
  tabbedHere: boolean,
): Pick<KeyPress, 'typing' | 'onFocusedControl'> {
  if (!(target instanceof Element)) return { typing: false, onFocusedControl: false };
  const typing =
    target.matches('input, textarea, select') ||
    (target instanceof HTMLElement && target.isContentEditable);
  const control = target.matches('button, [role="button"], a[href]');
  return { typing, onFocusedControl: control && tabbedHere };
}
