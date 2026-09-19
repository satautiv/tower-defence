import { clear, createStore, del, get, keys, set } from 'idb-keyval';
import type { UseStore } from 'idb-keyval';
import { SaveError } from '../types.js';
import type { SaveAdapter } from '../types.js';

/**
 * IndexedDB, for anything too large for localStorage.
 *
 * A serialised world snapshot is hundreds of kilobytes; localStorage caps
 * around 5MB across the whole origin and blocks the main thread while writing.
 * IndexedDB is asynchronous and has real capacity, which is what a snapshot
 * written during backgrounding needs.
 */
export class IndexedDbAdapter implements SaveAdapter {
  private readonly store: UseStore;

  /**
   * The store can be supplied directly, which is how the failure paths below
   * get tested: a real IndexedDB is hard to make fail on demand, and mapping a
   * raw DOMException onto the right SaveError reason is exactly what the save
   * system branches on to decide what to tell the player.
   */
  constructor(store: UseStore);
  constructor(databaseName?: string, storeName?: string);
  constructor(databaseNameOrStore: UseStore | string = 'aetherfall', storeName = 'saves') {
    this.store =
      typeof databaseNameOrStore === 'function'
        ? databaseNameOrStore
        : createStore(databaseNameOrStore, storeName);
  }

  /** IndexedDB is absent in some sandboxed and private contexts. */
  static isAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return (await get<string>(key, this.store)) ?? null;
    } catch (error) {
      throw new SaveError('failed', `could not read "${key}"`, key, error);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await set(key, value, this.store);
    } catch (error) {
      throw new SaveError(
        error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : 'failed',
        `could not write "${key}"`,
        key,
        error,
      );
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await del(key, this.store);
    } catch (error) {
      throw new SaveError('failed', `could not remove "${key}"`, key, error);
    }
  }

  async keys(): Promise<string[]> {
    try {
      return (await keys<string>(this.store)).map(String).sort();
    } catch (error) {
      throw new SaveError('failed', 'could not list keys', undefined, error);
    }
  }

  async clear(): Promise<void> {
    try {
      await clear(this.store);
    } catch (error) {
      throw new SaveError('failed', 'could not clear the store', undefined, error);
    }
  }
}
