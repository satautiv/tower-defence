/**
 * The class that re-enables pointer events.
 *
 * The overlay disables them wholesale so clicks reach the canvas; anything
 * meant to be clicked has to opt back in. Every primitive applies this, and a
 * test asserts they all do — forgetting it produces a control that silently
 * cannot be clicked, which is hard to spot and easy to introduce.
 */
export const INTERACTIVE = 'ui-interactive';

/** Joins class names, dropping anything falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
