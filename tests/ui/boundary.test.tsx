// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Button,
  INTERACTIVE,
  Interactive,
  Modal,
  Overlay,
  Panel,
  Slider,
  Toggle,
  Tooltip,
} from '@ui/index';

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
 */

const TOKENS_CSS = readFileSync('src/ui/tokens.css', 'utf8');

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
