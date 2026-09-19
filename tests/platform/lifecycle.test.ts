import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebLifecycle } from '@platform/web/lifecycle';

/**
 * Fake event targets rather than happy-dom's, because these tests are about
 * which of several overlapping browser signals fire in which order — and that
 * ordering is easier to state explicitly than to coax out of a DOM
 * implementation.
 */
function fakeTarget() {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(new Event(type));
    },
    listenerCount(): number {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
  };
}

type Fake = ReturnType<typeof fakeTarget>;

function setup(): { doc: Fake; win: Fake; lifecycle: WebLifecycle; events: string[] } {
  const doc = fakeTarget();
  const win = fakeTarget();
  const lifecycle = new WebLifecycle(doc as unknown as Document, win as unknown as Window);
  const events: string[] = [];
  lifecycle.subscribe((event) => events.push(event));
  return { doc, win, lifecycle, events };
}

describe('WebLifecycle', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('starts visible', () => {
    expect(ctx.lifecycle.visible).toBe(true);
  });

  it('emits pause when the page is hidden and resume when it returns', () => {
    ctx.doc.visibilityState = 'hidden';
    ctx.doc.dispatch('visibilitychange');
    expect(ctx.events).toEqual(['pause']);
    expect(ctx.lifecycle.visible).toBe(false);

    ctx.doc.visibilityState = 'visible';
    ctx.doc.dispatch('visibilitychange');
    expect(ctx.events).toEqual(['pause', 'resume']);
  });

  it('emits pause on pagehide, which visibilitychange does not guarantee', () => {
    ctx.win.dispatch('pagehide');
    expect(ctx.events).toEqual(['pause']);
  });

  it('emits pause on freeze, for a discarded background tab', () => {
    ctx.win.dispatch('freeze');
    expect(ctx.events).toEqual(['pause']);
  });

  /**
   * The three signals overlap. Backgrounding a mobile browser can fire all of
   * them, and without deduplication the game would write the same snapshot
   * several times at the exact moment it has least budget to spare.
   */
  it('emits pause once even when every signal fires', () => {
    ctx.doc.visibilityState = 'hidden';
    ctx.doc.dispatch('visibilitychange');
    ctx.win.dispatch('pagehide');
    ctx.win.dispatch('freeze');
    expect(ctx.events).toEqual(['pause']);
  });

  it('does not emit resume while already visible', () => {
    ctx.win.dispatch('pageshow');
    expect(ctx.events).toEqual([]);
  });

  it('emits resume from the bfcache after a pagehide', () => {
    ctx.win.dispatch('pagehide');
    ctx.win.dispatch('pageshow');
    expect(ctx.events).toEqual(['pause', 'resume']);
  });

  it('stops notifying after unsubscribe', () => {
    const seen: string[] = [];
    const off = ctx.lifecycle.subscribe((event) => seen.push(event));
    off();
    ctx.win.dispatch('pagehide');
    expect(seen).toEqual([]);
  });

  /* On a pause, one failing subscriber must not cost the player the snapshot
     another subscriber was about to write. */
  it('keeps notifying the remaining handlers when one throws', () => {
    const after = vi.fn();
    const fresh = setup();
    fresh.lifecycle.subscribe(() => {
      throw new Error('subscriber exploded');
    });
    fresh.lifecycle.subscribe(after);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fresh.win.dispatch('pagehide');
    consoleError.mockRestore();

    expect(after).toHaveBeenCalledWith('pause');
  });

  it('detaches every listener on dispose', () => {
    expect(ctx.doc.listenerCount() + ctx.win.listenerCount()).toBeGreaterThan(0);
    ctx.lifecycle.dispose();
    expect(ctx.doc.listenerCount() + ctx.win.listenerCount()).toBe(0);
  });

  it('is safe to dispose twice', () => {
    ctx.lifecycle.dispose();
    expect(() => ctx.lifecycle.dispose()).not.toThrow();
  });

  it('reports a page that was already hidden at construction', () => {
    const doc = fakeTarget();
    doc.visibilityState = 'hidden';
    const lifecycle = new WebLifecycle(
      doc as unknown as Document,
      fakeTarget() as unknown as Window,
    );
    expect(lifecycle.visible).toBe(false);
  });
});
