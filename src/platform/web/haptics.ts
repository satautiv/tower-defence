import type { HapticIntensity, Haptics } from '../types.js';

/**
 * Vibration, where the browser offers it.
 *
 * Android Chrome supports `navigator.vibrate`; desktop browsers and iOS Safari
 * do not, so this degrades to doing nothing. Capacitor's native haptics (#54)
 * feel considerably better and replace this on Android.
 *
 * Durations are short on purpose. Haptics are punctuation for an action the
 * player just took — a long buzz reads as an error, and on a phone held for a
 * six-minute stage it becomes irritating quickly.
 */
const DURATION_MS: Readonly<Record<HapticIntensity, number>> = {
  light: 10,
  medium: 20,
  heavy: 40,
};

export class WebHaptics implements Haptics {
  private on: boolean;
  private readonly vibrate: ((pattern: number) => boolean) | undefined;

  constructor(nav: Navigator | undefined = globalThis.navigator, enabled = true) {
    this.on = enabled;
    const fn = nav?.vibrate;
    this.vibrate = typeof fn === 'function' ? fn.bind(nav) : undefined;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(enabled: boolean): void {
    this.on = enabled;
  }

  get supported(): boolean {
    return this.vibrate !== undefined;
  }

  impact(intensity: HapticIntensity): void {
    if (!this.on || this.vibrate === undefined) return;
    try {
      this.vibrate(DURATION_MS[intensity]);
    } catch {
      /* Blocked by a permissions policy or an inactive document. Haptics are a
         garnish; never let them interrupt what the player was doing. */
    }
  }
}
