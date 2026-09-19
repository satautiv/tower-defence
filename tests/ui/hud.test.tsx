// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hud } from '@ui/hud/Hud';
import type { HudModel } from '@ui/hud/model';
import { UI_POLL_HZ } from '@ui/hooks/useThrottledValue';

/**
 * The speed control (#28). The simulation owns the speed: a press is a
 * command applied at the next tick, so the control must show what the world
 * says, not what was last pressed.
 */

afterEach(cleanup);

const MODEL: HudModel = {
  lives: 20,
  gold: 600,
  aether: 0,
  wave: 1,
  totalWaves: 10,
  speed: 1,
  paused: false,
};

const pressed = (): string[] =>
  screen
    .getAllByRole('button', { pressed: true })
    .map((button) => button.getAttribute('aria-label') ?? '');

describe('the speed control', () => {
  it('offers every speed, with the current one pressed', () => {
    render(<Hud source={() => ({ ...MODEL, speed: 2 })} onSpeed={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Game speed' });

    expect(group.querySelectorAll('button')).toHaveLength(3);
    expect(pressed()).toEqual(['2× speed']);
  });

  it('asks for the speed pressed', () => {
    const onSpeed = vi.fn();
    render(<Hud source={() => MODEL} onSpeed={onSpeed} />);

    fireEvent.click(screen.getByRole('button', { name: '3× speed' }));
    expect(onSpeed).toHaveBeenCalledWith(3);
  });

  it('is left out where nothing can act on it', () => {
    render(<Hud source={() => MODEL} />);
    expect(screen.queryByRole('group', { name: 'Game speed' })).toBeNull();
  });
});

describe('following the simulation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('moves the highlight when the world changes speed, not when pressed', () => {
    let model = MODEL;
    render(<Hud source={() => model} onSpeed={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '3× speed' }));
    act(() => vi.advanceTimersByTime(1000 / UI_POLL_HZ));
    expect(pressed()).toEqual(['1× speed']);

    model = { ...MODEL, speed: 3 };
    act(() => vi.advanceTimersByTime(1000 / UI_POLL_HZ));
    expect(pressed()).toEqual(['3× speed']);
  });
});
