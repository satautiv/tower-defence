import {
  createCapacitorHaptics,
  createCapacitorLifecycle,
  createCapacitorProfileStore,
} from './capacitor/index.js';
import { isNativePlatform } from './detect.js';
import { MemorySaveAdapter } from './memory.js';
import { NoopAnalytics } from './web/analytics.js';
import { WebHaptics } from './web/haptics.js';
import { IndexedDbAdapter } from './web/indexedDb.js';
import { LocalStorageAdapter } from './web/localStorage.js';
import { WebLifecycle } from './web/lifecycle.js';
import type { Platform, PlatformName, SaveAdapter } from './types.js';

/**
 * Assembles the platform.
 *
 * This file and `detect.ts` are the only places that know which platform the
 * game is running on. Everything else takes a `Platform` and cannot tell the
 * difference, which is what makes the Android port (#54) a matter of supplying
 * new implementations rather than threading conditionals through the codebase.
 */

export interface CreatePlatformOptions {
  /** Injected by tests. Defaults to the real globals. */
  localStorage?: Storage | undefined;
  indexedDbAvailable?: boolean;
  native?: boolean;
  analyticsEnabled?: boolean;
}

/**
 * Picks the best available store, degrading rather than failing.
 *
 * A player in a private window, or one who has blocked site data, still gets to
 * play — they simply do not keep progress. Refusing to start because progress
 * cannot be saved would be the worse outcome, and the save system (#39) is
 * responsible for telling them.
 */
function chooseProfileStore(storage: Storage | undefined): SaveAdapter {
  return LocalStorageAdapter.isAvailable(storage)
    ? new LocalStorageAdapter(storage)
    : new MemorySaveAdapter();
}

/**
 * Snapshots are large, so IndexedDB first. localStorage is a poor second — it
 * caps around 5MB per origin and blocks the main thread — but it is better than
 * losing a run to an interrupted stage.
 */
function chooseSessionStore(
  storage: Storage | undefined,
  indexedDbAvailable: boolean,
): SaveAdapter {
  if (indexedDbAvailable) return new IndexedDbAdapter();
  if (LocalStorageAdapter.isAvailable(storage))
    return new LocalStorageAdapter(storage, 'aetherfall:session:');
  return new MemorySaveAdapter();
}

export function createPlatform(options: CreatePlatformOptions = {}): Platform {
  const {
    localStorage: storage = safeLocalStorage(),
    indexedDbAvailable = IndexedDbAdapter.isAvailable(),
    native = isNativePlatform(),
    analyticsEnabled = false,
  } = options;

  const name: PlatformName = native ? 'capacitor' : 'web';

  const profileFallback = chooseProfileStore(storage);
  const profile = native ? createCapacitorProfileStore(profileFallback) : profileFallback;
  const session = chooseSessionStore(storage, indexedDbAvailable);
  const lifecycle = native ? createCapacitorLifecycle() : new WebLifecycle();
  const haptics = native ? createCapacitorHaptics() : new WebHaptics();
  const analytics = new NoopAnalytics(analyticsEnabled);

  return {
    name,
    profile,
    session,
    lifecycle,
    haptics,
    analytics,
    dispose() {
      lifecycle.dispose();
    },
  };
}

/** Accessing localStorage throws outright in a sandboxed frame. */
function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

let current: Platform | undefined;

/** The process-wide platform. Created on first use. */
export function platform(): Platform {
  current ??= createPlatform();
  return current;
}

/** Test seam: drops the singleton so the next call rebuilds it. */
export function resetPlatform(): void {
  current?.dispose();
  current = undefined;
}

export * from './types.js';
export { MemorySaveAdapter } from './memory.js';
export { LocalStorageAdapter, DEFAULT_PREFIX } from './web/localStorage.js';
export { IndexedDbAdapter } from './web/indexedDb.js';
export { WebLifecycle } from './web/lifecycle.js';
export { WebHaptics } from './web/haptics.js';
export { NoopAnalytics } from './web/analytics.js';
export type { RecordedEvent } from './web/analytics.js';
export { isNativePlatform, nativePlatformName } from './detect.js';
