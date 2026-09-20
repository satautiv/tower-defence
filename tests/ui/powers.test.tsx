// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { PowerBar } from '@ui/stage/PowerBar';
import type { PowerOption } from '@sim/index';

/**
 * The ability bar (#26).
 *
 * Every power is shown whether or not it can be cast: the bar is how a player
 * learns what they have and what it costs, and a player who has never seen
 * Aether Siphon will never save fifty Aether for it.
 */

afterEach(cleanup);

const power = (over: Partial<PowerOption> = {}): PowerOption => ({
  index: 0,
  id: 'riftfall',
  cost: 40,
  ready: true,
  affordable: true,
  cooldownRemaining: 0,
  radius: 160,
  ...over,
});

const bar = (powers: PowerOption[], props: Record<string, unknown> = {}) =>
  render(
    <PowerBar
      powers={powers}
      armed={-1}
      onArm={vi.fn()}
      name={(id) => id.replace(/_/g, ' ')}
      {...props}
    />,
  );

describe('the power bar', () => {
  it('shows nothing at all when there are no powers', () => {
    bar([]);
    expect(screen.queryByTestId('power-bar')).toBeNull();
  });

  it('shows a power that cannot be afforded, rather than hiding it', () => {
    bar([power({ ready: false, affordable: false })]);
    expect(screen.getByRole('button', { name: /riftfall/i })).toBeInTheDocument();
  });

  it('names its price, on the face rather than in a tooltip', () => {
    bar([power()]);
    expect(screen.getByText('40 ae')).toBeInTheDocument();
  });

  /* While it cools, what the player needs to know has changed: the countdown
     replaces the price rather than sitting beside it. */
  it('counts down instead of pricing while it cools', () => {
    bar([power({ ready: false, cooldownRemaining: 7 })]);
    expect(screen.getByText('7s')).toBeInTheDocument();
    expect(screen.queryByText('40 ae')).toBeNull();
  });

  it('arms a power that is ready', () => {
    const onArm = vi.fn();
    bar([power()], { onArm });

    fireEvent.click(screen.getByRole('button', { name: /riftfall/i }));
    expect(onArm).toHaveBeenCalledWith(0);
  });

  it('will not arm one that is not', () => {
    const onArm = vi.fn();
    bar([power({ ready: false, affordable: false })], { onArm });

    fireEvent.click(screen.getByRole('button', { name: /riftfall/i }));
    expect(onArm).not.toHaveBeenCalled();
  });

  it('says which one is waiting for a target', () => {
    bar([power()], { armed: 0 });
    expect(screen.getByRole('button', { name: /riftfall/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('will not cast while the game is paused', () => {
    const onArm = vi.fn();
    bar([power()], { onArm, locked: true });

    fireEvent.click(screen.getByRole('button', { name: /riftfall/i }));
    expect(onArm).not.toHaveBeenCalled();
  });

  it('lists every power it is given', () => {
    bar([
      power(),
      power({ index: 1, id: 'aether_siphon', cost: 50 }),
      power({ index: 2, id: 'rift_seal', cost: 60 }),
    ]);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
