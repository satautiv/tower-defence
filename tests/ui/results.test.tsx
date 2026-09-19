// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StageResult } from '@sim/index';
import { INTERACTIVE } from '@ui/components/index';
import { StageResults } from '@ui/stage/StageResults';

/**
 * The results, shown over the board the stage ended on (#28). Retry is the
 * instant restart; the reset itself is proven in tests/determinism/restart.
 */

afterEach(cleanup);

const LOSS: StageResult = {
  won: false,
  stars: 0,
  livesRemaining: 0,
  startingLives: 20,
  durationSeconds: 115.1,
  wavesCleared: 3,
  totalWaves: 10,
  enemiesKilled: 12,
  enemiesLeaked: 20,
  goldEarned: 88,
  towersBuilt: 2,
  reactionsTriggered: 0,
};

const WIN: StageResult = { ...LOSS, won: true, stars: 3, livesRemaining: 20, wavesCleared: 10 };

describe('the results', () => {
  it('reports a defeat with its figures', () => {
    render(<StageResults result={LOSS} onRetry={vi.fn()} onLeave={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Defeat' });

    expect(dialog).toHaveTextContent('Lives0 / 20');
    expect(dialog).toHaveTextContent('Waves3 / 10');
    expect(dialog).toHaveTextContent('Time1:55');
    expect(screen.getByLabelText('0 of 3 stars')).toBeInTheDocument();
  });

  it('reports a clear with its stars', () => {
    render(<StageResults result={WIN} onRetry={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Stage cleared' })).toBeInTheDocument();
    expect(screen.getByLabelText('3 of 3 stars')).toBeInTheDocument();
  });

  /* §17.3: one tap, no confirmation. */
  it('retries on a single tap', () => {
    const onRetry = vi.fn();
    render(<StageResults result={LOSS} onRetry={onRetry} onLeave={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('puts Retry under the thumb, focused, so a key press also retries', () => {
    render(<StageResults result={LOSS} onRetry={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
  });

  it('leaves for stage select', () => {
    const onLeave = vi.fn();
    render(<StageResults result={LOSS} onRetry={vi.fn()} onLeave={onLeave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stage select' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  /* The stage is over; taps must not reach the frozen board underneath. */
  it('takes every tap, so none reaches the board behind it', () => {
    render(<StageResults result={LOSS} onRetry={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.getByTestId('stage-results')).toHaveClass(INTERACTIVE);
  });
});
