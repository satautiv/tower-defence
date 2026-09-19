import { WebHaptics } from '../web/haptics.js';
import { WebLifecycle } from '../web/lifecycle.js';
import type { Haptics, Lifecycle, SaveAdapter } from '../types.js';

/**
 * Native implementations, pending #54.
 *
 * Deliberately not importing @capacitor/core: the package is not installed, and
 * the web build should never carry it. When #54 adds the Android project these
 * function bodies are replaced with Preferences, Haptics and App plugin calls,
 * and nothing outside this directory changes.
 *
 * Until then they delegate to the web implementations, which do work inside a
 * WebView — localStorage, IndexedDB and visibilitychange all function there.
 * What is missing is quality, not correctness: native haptics feel better than
 * `navigator.vibrate`, Preferences survives a WebView data clear, and the App
 * plugin reports backgrounding more reliably than page visibility.
 */

export function createCapacitorLifecycle(): Lifecycle {
  return new WebLifecycle();
}

export function createCapacitorHaptics(): Haptics {
  return new WebHaptics();
}

/** Replaced by the Preferences plugin in #54. */
export function createCapacitorProfileStore(fallback: SaveAdapter): SaveAdapter {
  return fallback;
}
