import { Assets } from 'pixi.js';
import type { SpritesheetData } from 'pixi.js';

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

/** A frame's rectangle in atlas pixels. */
export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where each sprite sits in the atlas image, for drawing it outside the canvas.
 *
 * The interface shows enemies in the wave preview with the same art the board
 * uses, as CSS sprites cut from the one image the game already loaded — so an
 * icon can never disagree with the sprite it stands for, and art from #42
 * reaches both at once.
 */
export interface AtlasIndex {
  /** URL of the atlas image. */
  image: string;
  width: number;
  height: number;
  frames: ReadonlyMap<string, AtlasFrame>;
}

/**
 * Builds the index from a loaded spritesheet's data. `atlasUrl` is the JSON's
 * URL; the image is resolved beside it, as the loader itself resolves it.
 *
 * Rotated and trimmed frames are left out: a CSS sprite cannot unrotate, and a
 * trimmed one would be drawn off-centre. The caller falls back to a plain mark.
 */
export function indexAtlas(data: SpritesheetData, atlasUrl: string): AtlasIndex {
  const frames = new Map<string, AtlasFrame>();
  for (const [name, entry] of Object.entries(data.frames)) {
    if (entry.rotated === true || entry.trimmed === true) continue;
    const { x, y, w, h } = entry.frame;
    frames.set(name, { x, y, w, h });
  }

  const image = atlasUrl.replace(/[^/]*$/, data.meta.image ?? '');
  return { image, width: data.meta.size?.w ?? 0, height: data.meta.size?.h ?? 0, frames };
}
