import { SaveError } from '../types.js';
import type { SaveAdapter } from '../types.js';

/**
 * localStorage, namespaced.
 *
 * Suited to the profile: small, synchronous underneath, and written on every
 * star and talent change. Not suited to world snapshots, which go to IndexedDB.
 *
 * Every key is prefixed so `keys()` and `clear()` touch only ours. Without that,
 * clearing save data would also wipe anything else stored on the same origin —
 * which on GitHub Pages is every other project published there.
 */
export const DEFAULT_PREFIX = 'aetherfall:';

export class LocalStorageAdapter implements SaveAdapter {
  private readonly storage: Storage;
  private readonly prefix: string;

  constructor(storage: Storage, prefix = DEFAULT_PREFIX) {
    this.storage = storage;
    this.prefix = prefix;
  }

  /**
   * Probes with a real write, because presence is not availability: Safari in
   * private mode exposes localStorage and then throws on every set.
   */
  static isAvailable(storage: Storage | undefined): storage is Storage {
    if (storage === undefined) return false;
    const probe = `${DEFAULT_PREFIX}__probe__`;
    try {
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }

  private full(key: string): string {
    return this.prefix + key;
  }

  get(key: string): Promise<string | null> {
    try {
      return Promise.resolve(this.storage.getItem(this.full(key)));
    } catch (error) {
      return Promise.reject(new SaveError('failed', `could not read "${key}"`, key, error));
    }
  }

  set(key: string, value: string): Promise<void> {
    try {
      this.storage.setItem(this.full(key), value);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        new SaveError(
          isQuotaError(error) ? 'quota' : 'failed',
          `could not write "${key}"`,
          key,
          error,
        ),
      );
    }
  }

  remove(key: string): Promise<void> {
    try {
      this.storage.removeItem(this.full(key));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(new SaveError('failed', `could not remove "${key}"`, key, error));
    }
  }

  keys(): Promise<string[]> {
    const found: string[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key !== null && key.startsWith(this.prefix)) found.push(key.slice(this.prefix.length));
      }
    } catch (error) {
      return Promise.reject(new SaveError('failed', 'could not list keys', undefined, error));
    }
    return Promise.resolve(found.sort());
  }

  async clear(): Promise<void> {
    for (const key of await this.keys()) await this.remove(key);
  }
}

/**
 * Quota errors are worth telling apart from other failures: the player can act
 * on a full store by deleting a save, but not on an opaque one. Browsers
 * disagree about how to report it, hence the three checks.
 */
function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22
  );
}
