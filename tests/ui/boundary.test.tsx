// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/* The canvas host has to mount inside a real Overlay for the structural test
   below, and creating a Pixi application needs a GPU that no test runner has. */
vi.mock('@view/app', () => ({
  createGameView: vi.fn(async () => Promise.resolve(null)),
}));

const {
  Button,
  GameCanvas,
  INTERACTIVE,
  Interactive,
  Modal,
  Overlay,
  Panel,
  Slider,
  Toggle,
  Tooltip,
} = await import('@ui/index');

/**
 * The canvas/DOM boundary.
 *
 * The overlay covers the entire board, so if it absorbed clicks the player
 * could not select a build plot — the game would be unplayable while looking
 * completely normal. Pointer events are therefore off on the overlay and
 * re-enabled per control.
 *
 * Tested from both ends: the stylesheet really declares the rules, and every
 * primitive really carries the class. Neither alone is enough — happy-dom does
 * no layout, so actual hit-testing belongs to the Playwright pass in #53.
 *
 * The board is covered last, and separately, because it is the one element the
 * overlay sits on top of rather than one of the controls inside it.
 */

const TOKENS_CSS = readFileSync('src/ui/tokens.css', 'utf8');
const UI_CSS = readFileSync('src/ui/ui.css', 'utf8');

/* Vitest globals are off, so Testing Library's automatic cleanup does not
   register itself. Without this, renders stack across tests and queries match
   elements from a previous one. */
afterEach(cleanup);

/** Extracts a declaration from a rule block, whitespace-insensitively. */
function declaration(css: string, selector: string, property: string): string | undefined {
  const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  const value =
    block === undefined ? undefined : new RegExp(`${property}\\s*:\\s*([^;]+)`).exec(block)?.[1];
  return value?.trim();
}

describe('the stylesheet declares the boundary', () => {
  it('turns pointer events off on the overlay', () => {
    expect(declaration(TOKENS_CSS, '.ui-overlay', 'pointer-events')).toBe('none');
  });

  it('turns them back on for interactive elements', () => {
    expect(declaration(TOKENS_CSS, '.ui-interactive', 'pointer-events')).toBe('auto');
  });

  it('stretches the overlay over the whole canvas', () => {
    expect(declaration(TOKENS_CSS, '.ui-overlay', 'position')).toBe('absolute');
    expect(declaration(TOKENS_CSS, '.ui-overlay', 'inset')).toBe('0');
  });
});

describe('the overlay does not absorb clicks', () => {
  it('carries the class that disables pointer events', () => {
    render(
      <Overlay>
        <p>content</p>
      </Overlay>,
    );
    expect(screen.getByTestId('ui-overlay')).toHaveClass('ui-overlay');
  });

  it('leaves plain content non-interactive, so it cannot block the board', () => {
    render(
      <Overlay>
        <p data-testid="plain">decoration</p>
      </Overlay>,
    );
    expect(screen.getByTestId('plain')).not.toHaveClass(INTERACTIVE);
  });
});

describe('every primitive opts back into pointer events', () => {
  /* Forgetting this produces a control that silently cannot be clicked — easy
     to introduce, hard to notice, and impossible to diagnose from a screenshot. */
  const cases: Array<[string, () => HTMLElement]> = [
    [
      'Button',
      () => {
        render(<Button data-testid="it">Go</Button>);
        return screen.getByTestId('it');
      },
    ],
    [
      'Panel',
      () => {
        render(
          <Panel data-testid="it" title="Info">
            body
          </Panel>,
        );
        return screen.getByTestId('it');
      },
    ],
    [
      'Modal backdrop',
      () => {
        render(
          <Modal open title="Paused" onClose={() => undefined}>
            body
          </Modal>,
        );
        return screen.getByTestId('modal-backdrop');
      },
    ],
    [
      'Slider',
      () => {
        render(<Slider label="Music" value={0.5} onChange={() => undefined} />);
        return screen.getByText('Music').closest('label') as HTMLElement;
      },
    ],
    [
      'Toggle',
      () => {
        render(<Toggle label="Shake" checked onChange={() => undefined} />);
        return screen.getByText('Shake').closest('label') as HTMLElement;
      },
    ],
    [
      'Tooltip',
      () => {
        render(
          <Tooltip content="hint">
            <span>anchor</span>
          </Tooltip>,
        );
        return screen.getByText('anchor').parentElement as HTMLElement;
      },
    ],
    [
      'Interactive',
      () => {
        render(<Interactive data-testid="it">region</Interactive>);
        return screen.getByTestId('it');
      },
    ],
  ];

  it.each(cases)('%s is clickable', (_name, mount) => {
    expect(mount()).toHaveClass(INTERACTIVE);
  });
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} title="Paused" onClose={() => undefined}>
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is announced as a modal dialog', () => {
    render(
      <Modal open title="Paused" onClose={() => undefined}>
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Paused');
  });
});

/**
 * The board is the one thing under the overlay, and it was the one thing that
 * never opted back in.
 *
 * `pointer-events` is inherited, so `.ui-overlay { pointer-events: none }`
 * propagated straight into the canvas host nested inside it and from there into
 * the Pixi canvas that CameraController listens on. Every tap, drag and pinch
 * was discarded before it reached the board: no panning, no zooming and no way
 * to build a tower — while every button still worked, so the game looked
 * completely normal and behaved as though the player had simply missed.
 *
 * The suite above checks that each primitive opts in. That is the same rule and
 * it missed this, because the canvas is not a primitive and was never listed.
 */
describe('the board itself accepts clicks', () => {
  it('re-enables pointer events on the canvas host', () => {
    expect(declaration(UI_CSS, '.game-canvas-host', 'pointer-events')).toBe('auto');
  });

  it('renders the host with the class the stylesheet re-enables', async () => {
    render(<GameCanvas />);
    await act(async () => {
      await Promise.resolve();
    });

    /* Asserted by class rather than by test id: the class is what the CSS rule
       above selects, so a rename that breaks the rule fails here too. */
    expect(screen.getByTestId('game-canvas-host')).toHaveClass('game-canvas-host');
  });

  it('mounts the host inside the overlay, which is why it must opt back in', async () => {
    render(
      <Overlay>
        <GameCanvas />
      </Overlay>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    const host = screen.getByTestId('game-canvas-host');
    expect(host.closest('.ui-overlay')).not.toBeNull();
  });
});
