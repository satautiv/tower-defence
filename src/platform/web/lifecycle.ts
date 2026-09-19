import type { Lifecycle, LifecycleEvent, LifecycleHandler } from '../types.js';

/**
 * Visibility and backgrounding, from the browser's several overlapping signals.
 *
 * This is what triggers the mid-stage snapshot, and on mobile it is the last
 * code that reliably runs: a backgrounded page can be frozen or discarded
 * without further notice, so a save deferred past this point may never happen.
 *
 * Three signals feed it because no single one is sufficient.
 * `visibilitychange` covers tab switches and the home button.
 * `pagehide` covers navigation away and the bfcache, where `visibilitychange`
 * is not guaranteed. `freeze` covers Chrome discarding a background tab.
 * They overlap, so emission is deduplicated against the last state — otherwise
 * backgrounding a mobile browser would fire `pause` two or three times and
 * write the same snapshot repeatedly.
 */
export class WebLifecycle implements Lifecycle {
  private readonly handlers = new Set<LifecycleHandler>();
  private readonly target: Document;
  private readonly win: Window;
  private currentlyVisible: boolean;
  private disposed = false;

  constructor(doc: Document = document, win: Window = window) {
    this.target = doc;
    this.win = win;
    this.currentlyVisible = doc.visibilityState !== 'hidden';

    this.target.addEventListener('visibilitychange', this.onVisibilityChange);
    this.win.addEventListener('pagehide', this.onHide);
    this.win.addEventListener('freeze', this.onHide);
    this.win.addEventListener('pageshow', this.onShow);
  }

  get visible(): boolean {
    return this.currentlyVisible;
  }

  subscribe(handler: LifecycleHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.win.removeEventListener('pagehide', this.onHide);
    this.win.removeEventListener('freeze', this.onHide);
    this.win.removeEventListener('pageshow', this.onShow);
    this.handlers.clear();
  }

  private emit(event: LifecycleEvent): void {
    const nowVisible = event === 'resume';
    /* Deduplicated: the three signals overlap and would otherwise fire pause
       several times for one backgrounding. */
    if (nowVisible === this.currentlyVisible) return;
    this.currentlyVisible = nowVisible;

    /* A throwing handler must not stop the others — on a pause that would mean
       one failed subscriber costs the player their snapshot. */
    for (const handler of [...this.handlers]) {
      try {
        handler(event);
      } catch (error) {
        console.error('lifecycle handler threw', error);
      }
    }
  }

  private readonly onVisibilityChange = (): void => {
    this.emit(this.target.visibilityState === 'hidden' ? 'pause' : 'resume');
  };

  private readonly onHide = (): void => this.emit('pause');
  private readonly onShow = (): void => this.emit('resume');
}
