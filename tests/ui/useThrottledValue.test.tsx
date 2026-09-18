// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_POLL_HZ, shallowEqual, useThrottledValue } from '@ui/hooks/useThrottledValue';

/**
 * The acceptance criterion this file exists for: the UI must do no work while
 * nothing is changing. A HUD that re-renders on a timer regardless of whether
 * its numbers moved spends frame budget and battery on nothing.
 */

interface ProbeProps<T> {
  read: () => T;
  onRender: () => void;
  equals?: (a: T, b: T) => boolean;
}

function Probe<T>({ read, onRender, equals }: ProbeProps<T>): ReactElement {
  const value = useThrottledValue(read, UI_POLL_HZ, equals);
  onRender();
  return <span data-testid="value">{JSON.stringify(value)}</span>;
}

describe('useThrottledValue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not re-render while the value is unchanged', async () => {
    const onRender = vi.fn();
    render(<Probe read={() => 42} onRender={onRender} />);
    const initialRenders = onRender.mock.calls.length;

    /* Five seconds — fifty polls at 10Hz. */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(onRender.mock.calls.length).toBe(initialRenders);
  });

  it('re-renders when the value changes', async () => {
    let current = 1;
    const onRender = vi.fn();
    render(<Probe read={() => current} onRender={onRender} />);
    const before = onRender.mock.calls.length;

    current = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onRender.mock.calls.length).toBeGreaterThan(before);
  });

  it('re-renders once per change, not once per poll', async () => {
    let current = 1;
    const onRender = vi.fn();
    render(<Probe read={() => current} onRender={onRender} />);
    const before = onRender.mock.calls.length;

    current = 2;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    /* One change, twenty polls. StrictMode is off here, so this is one render. */
    expect(onRender.mock.calls.length - before).toBe(1);
  });

  it('polls at roughly the configured rate', async () => {
    const read = vi.fn(() => 0);
    render(<Probe read={read} onRender={() => undefined} />);
    const initial = read.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const polls = read.mock.calls.length - initial;
    expect(polls).toBeGreaterThanOrEqual(UI_POLL_HZ - 1);
    expect(polls).toBeLessThanOrEqual(UI_POLL_HZ + 1);
  });

  it('does not re-render for an object rebuilt with identical contents', async () => {
    const onRender = vi.fn();
    render(
      <Probe read={() => ({ gold: 600, lives: 20 })} onRender={onRender} equals={shallowEqual} />,
    );
    const before = onRender.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    /* Object.is would see a new reference every poll and re-render twenty times. */
    expect(onRender.mock.calls.length).toBe(before);
  });

  it('stops polling once unmounted', async () => {
    const read = vi.fn(() => 0);
    const { unmount } = render(<Probe read={read} onRender={() => undefined} />);
    unmount();
    const afterUnmount = read.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(read.mock.calls.length).toBe(afterUnmount);
  });
});

describe('shallowEqual', () => {
  it('compares one level deep', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it('is false when the key sets differ', () => {
    expect(shallowEqual({ a: 1 } as Record<string, number>, { a: 1, b: 2 })).toBe(false);
  });

  it('does not recurse, so a nested rebuild counts as a change', () => {
    expect(shallowEqual({ nested: { x: 1 } }, { nested: { x: 1 } })).toBe(false);
  });

  it('short-circuits on identity', () => {
    const shared = { a: 1 };
    expect(shallowEqual(shared, shared)).toBe(true);
  });
});
