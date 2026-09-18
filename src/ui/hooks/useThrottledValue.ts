import { useEffect, useRef, useState } from 'react';

/**
 * Polls a value at a low, fixed rate and re-renders only when it actually
 * changes.
 *
 * The HUD shows numbers the simulation updates 60 times a second. A human
 * cannot read a number changing that fast, so rendering it that fast spends the
 * frame budget and the battery on nothing. Ten times a second looks continuous
 * and costs a sixth as much.
 *
 * The second half matters more than the first: when the polled value is
 * unchanged the updater returns the previous state, React bails out, and no
 * re-render happens at all. During a quiet moment the UI does no work
 * (docs/TECH_DESIGN.md §10).
 */

/** Fast enough to look live, slow enough to be nearly free. */
export const UI_POLL_HZ = 10;

export function useThrottledValue<T>(
  read: () => T,
  hz: number = UI_POLL_HZ,
  equals: (a: T, b: T) => boolean = Object.is,
): T {
  const readRef = useRef(read);
  const equalsRef = useRef(equals);

  /* Kept current through an effect rather than assigned during render, so this
     stays correct if React renders a component without committing it. */
  useEffect(() => {
    readRef.current = read;
    equalsRef.current = equals;
  });

  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    const interval = setInterval(() => {
      setValue((previous) => {
        const next = readRef.current();
        /* Returning the same reference is the bail-out: React skips the render. */
        return equalsRef.current(previous, next) ? previous : next;
      });
    }, 1000 / hz);
    return () => clearInterval(interval);
  }, [hz]);

  return value;
}

/**
 * One level deep. HUD models are flat bags of numbers, so this is enough to
 * avoid re-rendering on an object that was rebuilt with identical contents.
 */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;

  /* Constrained to `object` rather than Record<string, unknown> so plain
     interfaces work: an interface has no index signature, so it is not
     assignable to Record even though its keys are perfectly enumerable. */
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of keysA) if (!Object.is(left[key], right[key])) return false;
  return true;
}
