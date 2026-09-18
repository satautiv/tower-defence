/// <reference types="vite/client" />
import { buildRegistry } from './loader.js';
import type { ContentRegistry, RawFile } from './loader.js';

/**
 * Loads content in the browser.
 *
 * Vite inlines these globs at build time, so the JSON ships in the bundle and
 * there is no runtime fetch to fail. The Node tooling reads the same files from
 * disk (tools/content/io.ts) and hands the identical shape to buildRegistry —
 * so what content-lint validates is what the game loads.
 *
 * Patterns must be literals; Vite resolves them statically.
 */

function filesFrom(modules: Record<string, unknown>): RawFile[] {
  return Object.entries(modules)
    .map(([path, data]) => ({ path, data }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function singleFile(modules: Record<string, unknown>, expected: string): RawFile {
  const entries = filesFrom(modules);
  const file = entries[0];
  if (file === undefined) throw new Error(`content: ${expected} is missing`);
  return file;
}

let cached: ContentRegistry | undefined;

/** Validates on first call and caches. Throws ContentValidationError listing every problem. */
export function loadContent(): ContentRegistry {
  if (cached !== undefined) return cached;

  const opts = { eager: true, import: 'default' } as const;
  cached = buildRegistry({
    statuses: singleFile(import.meta.glob('./data/statuses.json', opts), 'statuses.json'),
    reactions: singleFile(import.meta.glob('./data/reactions.json', opts), 'reactions.json'),
    towers: filesFrom(import.meta.glob('./data/towers/*.json', opts)),
    enemies: filesFrom(import.meta.glob('./data/enemies/*.json', opts)),
    stages: filesFrom(import.meta.glob('./data/stages/*.json', opts)),
    powers: filesFrom(import.meta.glob('./data/powers/*.json', opts)),
    heroes: filesFrom(import.meta.glob('./data/heroes/*.json', opts)),
    talents: filesFrom(import.meta.glob('./data/talents/*.json', opts)),
  });
  return cached;
}

/** Test seam: forces the next loadContent() to revalidate. */
export function resetContentCache(): void {
  cached = undefined;
}
