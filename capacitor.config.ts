import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor packaging.
 *
 * The Android app is the same web build in a WebView, which is why the game
 * code carries no Capacitor dependency: `src/platform/detect.ts` reads the
 * global Capacitor injects rather than importing the package (ADR-0002 and #9).
 *
 * This is the smoke-build configuration (#20). The plugins — Preferences,
 * Haptics, App lifecycle, StatusBar — arrive with #54.
 */
const config: CapacitorConfig = {
  appId: 'lt.aetherfall.game',
  appName: 'Aetherfall',
  webDir: 'dist',

  android: {
    /* The game draws its own background; letting the WebView paint white first
       produces a flash on every launch. */
    backgroundColor: '#0b0d14',
    /* Mixed content stays off: everything ships in the bundle, so there is
       nothing legitimate to load over plain HTTP. */
    allowMixedContent: false,
  },

  server: {
    /* Served from the app's own files. `npx cap run android --livereload`
       overrides this during development without changing the file. */
    androidScheme: 'https',
  },
};

export default config;
