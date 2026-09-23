// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { createWorldForStage } from '@sim/index';
import type { World } from '@sim/index';
import { DevPanel } from '@devtools/DevPanel';

/**
 * The overlay in a DOM (#41).
 *
 * > `~` toggles the overlay.
 *
 * Driven through the real key and the real controls rather than through the
 * model underneath, because the model has its own tests and what breaks here
 * is the wiring between them — which is exactly what happened to the editor,
 * whose sixteen unit tests all passed while every click fell through to the
 * div underneath.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

afterEach(cleanup);

/* An arrow bound after the guard above, so the narrowing reaches it: a hoisted
   declaration could in principle run before `stage` was checked. */
const mount = (): { world: World } => {
  const world = createWorldForStage(registry, stage, 4);
  render(
    <DevPanel
      onReady={() => {}}
      onTeardown={() => {}}
      world={() => world}
      replayHeader={() => ({ stageId: '1-1' })}
    />,
  );
  return { world };
};

const tilde = (key = '`'): void => {
  fireEvent.keyDown(window, { key });
};

describe('the tilde toggle', () => {
  it('starts hidden, because the game is what the screen is for', () => {
    mount();
    expect(screen.queryByTestId('dev-overlay')).not.toBeInTheDocument();
  });

  it('opens and closes on the key', () => {
    mount();
    tilde();
    expect(screen.getByTestId('dev-overlay')).toBeInTheDocument();
    tilde();
    expect(screen.queryByTestId('dev-overlay')).not.toBeInTheDocument();
  });

  /* The cap says `~` and the key without Shift reports "`". A binding that
     needed Shift would be one nobody remembers. */
  it('answers to the key with and without Shift', () => {
    mount();
    tilde('~');
    expect(screen.getByTestId('dev-overlay')).toBeInTheDocument();
  });

  it('stays out of the way while something is being typed into', () => {
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: '`' });
    expect(screen.queryByTestId('dev-overlay')).not.toBeInTheDocument();
  });

  it('lets a browser shortcut through', () => {
    mount();
    fireEvent.keyDown(window, { key: '`', ctrlKey: true });
    expect(screen.queryByTestId('dev-overlay')).not.toBeInTheDocument();
  });

  it('hands the instance back so the ticker can drive it', () => {
    const world = createWorldForStage(registry, stage, 4);
    const onReady = vi.fn();
    render(
      <DevPanel
        onReady={onReady}
        onTeardown={() => {}}
        world={() => world}
        replayHeader={() => null}
      />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    /* Structurally what the stage screen's ticker calls. */
    const dev = onReady.mock.calls[0]?.[0] as { beginFrame: unknown; endFrame: unknown };
    expect(typeof dev.beginFrame).toBe('function');
    expect(typeof dev.endFrame).toBe('function');
  });

  it('lets the debug layer go when the screen does', () => {
    const world = createWorldForStage(registry, stage, 4);
    const onTeardown = vi.fn();
    const view = render(
      <DevPanel
        onReady={() => {}}
        onTeardown={onTeardown}
        world={() => world}
        replayHeader={() => null}
      />,
    );
    view.unmount();
    expect(onTeardown).toHaveBeenCalledTimes(1);
  });
});

describe('the visualisation toggles', () => {
  it('turn on and off, and say which they are', () => {
    mount();
    tilde();

    const grid = screen.getByRole('button', { name: 'spatial grid' });
    expect(grid).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(grid);
    expect(screen.getByRole('button', { name: 'spatial grid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers all five the issue asks for', () => {
    mount();
    tilde();
    for (const name of ['hitboxes', 'ranges', 'paths', 'spatial grid', 'targeting']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('the cheats', () => {
  it('give gold to the world the screen is running', () => {
    const { world } = mount();
    tilde();
    const before = world.resources.gold;
    fireEvent.click(screen.getByRole('button', { name: '+1000 gold' }));
    expect(world.resources.gold).toBe(before + 1_000);
  });

  it('set lives', () => {
    const { world } = mount();
    tilde();
    fireEvent.click(screen.getByRole('button', { name: 'lives 1' }));
    expect(world.resources.lives).toBe(1);
  });

  it('unlock the whole roster', () => {
    const { world } = mount();
    tilde();
    fireEvent.click(screen.getByRole('button', { name: 'unlock all' }));
    expect([...world.rules.towers.unlocked].every((flag) => flag === 1)).toBe(true);
  });

  /**
   * The warning is the feature.
   *
   * A cheat is a mutation with no command behind it, so nothing in a recorded
   * command list explains it and the run cannot be reproduced from its seed.
   * A replay saved from a cheated run is not a bug report, and the panel has to
   * say so where the record button is rather than in a comment nobody reads.
   */
  it('warn that a replay of a cheated run will not reproduce it', () => {
    mount();
    tilde();
    expect(screen.queryByText(/will not reproduce/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+1000 gold' }));
    expect(screen.getByText(/will not reproduce/)).toBeInTheDocument();
  });

  /* Nothing to skip before a wave is running, and a button that flashed and
     did nothing would read as broken. */
  it('say when there was nothing to skip', () => {
    mount();
    tilde();
    fireEvent.click(screen.getByRole('button', { name: 'skip wave' }));
    expect(screen.getByText('skip wave: nothing to do')).toBeInTheDocument();
  });
});

describe('the time scale', () => {
  it('offers 0.1x to 10x and remembers the choice', () => {
    mount();
    tilde();
    expect(screen.getByRole('button', { name: '0.1×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '10×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '0.1×' }));
    expect(screen.getByRole('button', { name: '0.1×' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('what it reports', () => {
  it('shows the sim and render split, and every pool', () => {
    mount();
    tilde();
    expect(screen.getByText(/^sim /)).toBeInTheDocument();
    expect(screen.getByText(/^render /)).toBeInTheDocument();
    for (const pool of ['enemies', 'towers', 'projectiles', 'soldiers', 'ground fx']) {
      expect(screen.getByText(pool)).toBeInTheDocument();
    }
    expect(screen.getByText('hash ground')).toBeInTheDocument();
    expect(screen.getByText('events')).toBeInTheDocument();
  });
});
