import type { SaveAdapter } from './types.js';

/**
 * An in-memory store.
 *
 * Two jobs. It is what the adapter tests run against as a reference, and it is
 * the fallback when no real store exists — private browsing, blocked site data,
 * a sandboxed frame.
 *
 * Falling back rather than failing is deliberate: a player in a private window
 * should still get to play, they just do not keep their progress. Refusing to
 * start because progress cannot be saved would be a worse outcome than losing
 * progress they never expected to keep. The save system (#39) surfaces this.
 */
export class MemorySaveAdapter implements SaveAdapter {
  private readonly entries = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.entries.keys()].sort());
  }

  clear(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }
}
