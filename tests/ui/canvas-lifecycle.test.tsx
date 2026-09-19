// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Renderer lifetime across navigation.
 *
 * A Pixi application left alive behind a menu holds a WebGL context, its
 * textures and a running ticker for a screen nobody is looking at. Browsers cap
 * how many WebGL contexts a page may hold, so leaking one per stage entry
 * eventually kills the canvas outright — and the symptom appears many
 * navigations later, nowhere near the cause.
 */

const mocks = vi.hoisted(() => {
  const destroy = vi.fn();
  /* Typed loosely on purpose: individual tests substitute a null return (an
     unsupported device) and a manually-resolved promise, neither of which fits
     a signature inferred from the happy path. */
  const createGameView = vi.fn<(options?: unknown) => Promise<unknown>>(async () =>
    Promise.resolve({
      destroy,
      camera: {
        centreOnWorld: vi.fn(),
        setWorldSize: vi.fn(),
        screenToWorld: vi.fn(),
        worldToScreen: vi.fn(),
      },
      layers: { plots: { addChild: vi.fn() }, entities: { addChild: vi.fn() } },
      app: { ticker: { add: vi.fn(), remove: vi.fn() } },
      viewport: { scale: 1, offsetX: 0, offsetY: 0, width: 1920, height: 1080, resolution: 1 },
    }),
  );
  return { destroy, createGameView };
});

vi.mock('@view/app', () => ({ createGameView: mocks.createGameView }));

/* This file is about renderer lifetime, not gameplay. The board and the
   session are stubbed so a mounted stage screen does not drag the whole
   simulation into a test that only counts create and destroy calls. */
vi.mock('@view/board', () => ({
  BoardView: class {
    syncPlots = vi.fn();
    render = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('@app/session', () => ({
  GameSession: {
    forStage: vi.fn(() => null),
  },
}));

const { GameCanvas } = await import('@ui/GameCanvas');
const { Router } = await import('@ui/Router');
const { useUiStore } = await import('@ui/store');

/** Lets the async createGameView promise settle inside React's act scope. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  mocks.createGameView.mockClear();
  mocks.destroy.mockClear();
  useUiStore.getState().reset();
});
afterEach(cleanup);

describe('GameCanvas', () => {
  it('creates a renderer once on mount', async () => {
    render(<GameCanvas />);
    await settle();
    expect(mocks.createGameView).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it('destroys the renderer on unmount', async () => {
    const { unmount } = render(<GameCanvas />);
    await settle();
    unmount();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('hands the created view to onReady', async () => {
    const onReady = vi.fn();
    render(<GameCanvas onReady={onReady} />);
    await settle();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  /**
   * StrictMode mounts every effect twice in development precisely to expose
   * setup that is not undone by its cleanup. If this leaks, it leaks in real
   * navigation too.
   */
  it('leaves no renderer behind under StrictMode double-mounting', async () => {
    const { unmount } = render(
      <StrictMode>
        <GameCanvas />
      </StrictMode>,
    );
    await settle();
    unmount();
    await settle();

    expect(mocks.destroy.mock.calls.length).toBe(mocks.createGameView.mock.calls.length);
  });

  it('destroys a renderer that finishes initialising after unmount', async () => {
    let resolveView: ((view: unknown) => void) | undefined;
    mocks.createGameView.mockImplementationOnce(
      () => new Promise((resolve) => (resolveView = resolve)),
    );

    const { unmount } = render(<GameCanvas />);
    unmount();

    /* The renderer arrives with no component left to own it; without the
       cancelled flag it would simply leak. */
    await act(async () => {
      resolveView?.({ destroy: mocks.destroy });
      await Promise.resolve();
    });

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('reports an unsupported device instead of calling onReady', async () => {
    mocks.createGameView.mockImplementationOnce(async () => Promise.resolve(null));
    const onReady = vi.fn();
    const onUnsupported = vi.fn();

    render(<GameCanvas onReady={onReady} onUnsupported={onUnsupported} />);
    await settle();

    expect(onUnsupported).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('the router mounts the renderer on exactly one screen', () => {
  it('shows no canvas on the menu', async () => {
    useUiStore.getState().navigate('menu');
    render(<Router />);
    await settle();

    expect(screen.queryByTestId('game-canvas-host')).toBeNull();
    expect(mocks.createGameView).not.toHaveBeenCalled();
  });

  it('creates the canvas when entering a stage', async () => {
    useUiStore.getState().navigate('inStage');
    render(<Router />);
    await settle();

    expect(screen.getByTestId('game-canvas-host')).toBeInTheDocument();
    expect(mocks.createGameView).toHaveBeenCalledTimes(1);
  });

  it('tears the canvas down when leaving the stage, and rebuilds it on return', async () => {
    useUiStore.getState().navigate('inStage');
    render(<Router />);
    await settle();
    expect(mocks.createGameView).toHaveBeenCalledTimes(1);

    await act(async () => {
      useUiStore.getState().navigate('menu');
      await Promise.resolve();
    });
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('game-canvas-host')).toBeNull();

    await act(async () => {
      useUiStore.getState().navigate('inStage');
      await Promise.resolve();
    });
    await settle();

    expect(mocks.createGameView).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('game-canvas-host')).toBeInTheDocument();
  });

  it('does not leak a renderer across repeated entries and exits', async () => {
    render(<Router />);
    for (let visit = 0; visit < 5; visit++) {
      await act(async () => {
        useUiStore.getState().navigate('inStage');
        await Promise.resolve();
      });
      await settle();
      await act(async () => {
        useUiStore.getState().navigate('menu');
        await Promise.resolve();
      });
    }

    expect(mocks.destroy.mock.calls.length).toBe(mocks.createGameView.mock.calls.length);
  });

  it.each([
    ['splash', 'screen-splash'],
    ['menu', 'screen-menu'],
    ['regionMap', 'screen-region-map'],
    ['stageSelect', 'screen-stage-select'],
    ['results', 'screen-results'],
    ['settings', 'screen-settings'],
  ])('renders the %s screen', async (screenName, testId) => {
    useUiStore.getState().navigate(screenName as never);
    render(<Router />);
    await settle();
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});
