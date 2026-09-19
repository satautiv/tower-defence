/**
 * The only place in the codebase that asks what platform this is.
 *
 * Deliberately does not import @capacitor/core. Capacitor injects a global into
 * the WebView, and reading that global means the web build carries no Capacitor
 * dependency at all — the Android project (#54) can add the package without
 * this file changing.
 *
 * `tests/platform/no-conditionals.test.ts` fails if a platform check appears
 * anywhere outside this directory.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativePlatform(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 'android', 'ios' or 'web'. Only for diagnostics and analytics dimensions. */
export function nativePlatformName(): string {
  try {
    return capacitor()?.getPlatform?.() ?? 'web';
  } catch {
    return 'web';
  }
}
