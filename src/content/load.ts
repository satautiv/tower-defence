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
 * Both the pattern and the options object must be written inline at each call.
 * Vite parses these statically, and hoisting the options into a shared const
 * makes the glob unresolvable — the bundler happens to tolerate it, but the dev
 * and test transforms reject it outright.
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

  cached = buildRegistry({
    statuses: singleFile(
      import.meta.glob('./data/statuses.json', { eager: true, import: 'default' }),
      'statuses.json',
    ),
    reactions: singleFile(
      import.meta.glob('./data/reactions.json', { eager: true, import: 'default' }),
      'reactions.json',
    ),
    towers: filesFrom(import.meta.glob('./data/towers/*.json', { eager: true, import: 'default' })),
    enemies: filesFrom(
      import.meta.glob('./data/enemies/*.json', { eager: true, import: 'default' }),
    ),
    stages: filesFrom(import.meta.glob('./data/stages/*.json', { eager: true, import: 'default' })),
    powers: filesFrom(import.meta.glob('./data/powers/*.json', { eager: true, import: 'default' })),
    heroes: filesFrom(import.meta.glob('./data/heroes/*.json', { eager: true, import: 'default' })),
    talents: filesFrom(
      import.meta.glob('./data/talents/*.json', { eager: true, import: 'default' }),
    ),
  });
  return cached;
}

/** Test seam: forces the next loadContent() to revalidate. */
export function resetContentCache(): void {
  cached = undefined;
}
