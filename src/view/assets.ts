import { Assets } from 'pixi.js';

/**
 * Asset loading with progress reporting.
 *
 * Progress is surfaced because the first thing a player sees must not be a
 * frozen screen. The 15-second launch-to-playing target (docs/GAME_DESIGN.md
 * §22) is measured from the player's perspective, and a bar that moves is the
 * difference between "loading" and "broken".
 *
 * Bundles are per-stage so only what a stage needs is fetched, which is what
 * keeps the initial payload inside its budget.
 */

export interface LoadProgress {
  fraction: number;
  bundle: string;
}

export type ProgressHandler = (progress: LoadProgress) => void;

export interface AssetManifest {
  bundles: Array<{
    name: string;
    assets: Array<{ alias: string; src: string }>;
  }>;
}

let initialised = false;

export async function initAssets(manifest: AssetManifest): Promise<void> {
  if (initialised) return;
  await Assets.init({ manifest });
  initialised = true;
}

/** Loads one bundle, reporting progress as it goes. Resolves when it is usable. */
export async function loadBundle(name: string, onProgress?: ProgressHandler): Promise<void> {
  await Assets.loadBundle(name, (fraction: number) => {
    onProgress?.({ fraction, bundle: name });
  });
}

/** Frees a bundle's GPU memory. Called when leaving a stage. */
export async function unloadBundle(name: string): Promise<void> {
  await Assets.unloadBundle(name);
}

/** Test seam: lets the loader be re-initialised between suites. */
export function resetAssetsForTest(): void {
  initialised = false;
}
