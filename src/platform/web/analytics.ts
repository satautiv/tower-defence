import type { Analytics } from '../types.js';

/**
 * A no-op analytics sink.
 *
 * Disabled until the player opts in, and even when enabled this implementation
 * only records events in memory — there is no endpoint. Real collection lands
 * with #59, where it buys the ability to compare the balance simulator's
 * predictions against what players actually do.
 *
 * Starting disabled is the point. The game has to work identically with
 * analytics off (docs/GAME_DESIGN.md §19), and a default of "on until refused"
 * would make that untested in practice.
 */
export interface RecordedEvent {
  event: string;
  properties: Readonly<Record<string, unknown>>;
  /** Tick-free wall clock; diagnostics only, never simulation input. */
  at: number;
}

export class NoopAnalytics implements Analytics {
  private on: boolean;
  private readonly recorded: RecordedEvent[] = [];
  private readonly limit: number;

  constructor(enabled = false, limit = 200) {
    this.on = enabled;
    this.limit = limit;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(enabled: boolean): void {
    this.on = enabled;
    if (!enabled) this.recorded.length = 0;
  }

  track(event: string, properties: Readonly<Record<string, unknown>> = {}): void {
    if (!this.on) return;
    /* Bounded, so a long session cannot grow this without limit. */
    if (this.recorded.length >= this.limit) this.recorded.shift();
    this.recorded.push({ event, properties, at: Date.now() });
  }

  /** Test and dev-overlay seam. Not part of the Analytics contract. */
  get events(): readonly RecordedEvent[] {
    return this.recorded;
  }
}
