import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { RawContent, RawFile } from '../../src/content/loader.js';

/**
 * Reads content from disk for the Node tooling.
 *
 * The browser gets the same files through Vite's glob import. Both hand the
 * identical shape to buildRegistry, so content-lint validates exactly what the
 * game loads rather than a parallel implementation that can drift.
 */

export const CONTENT_ROOT = 'src/content/data';

function jsonFilesIn(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...jsonFilesIn(full));
    else if (full.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

function read(path: string): RawFile {
  try {
    return { path: relative(process.cwd(), path), data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${relative(process.cwd(), path)}: not valid JSON — ${reason}`, {
      cause: error,
    });
  }
}

function readDir(root: string, sub: string): RawFile[] {
  return jsonFilesIn(join(root, sub)).map(read);
}

export function readContentFromDisk(root = CONTENT_ROOT): RawContent {
  return {
    statuses: read(join(root, 'statuses.json')),
    reactions: read(join(root, 'reactions.json')),
    towers: readDir(root, 'towers'),
    enemies: readDir(root, 'enemies'),
    stages: readDir(root, 'stages'),
    powers: readDir(root, 'powers'),
    heroes: readDir(root, 'heroes'),
    talents: readDir(root, 'talents'),
  };
}

/** Localisation keys defined in a locale file, for the missing-key rule. */
export function readLocaleKeys(path = 'src/i18n/en.json'): Set<string> {
  try {
    return new Set(Object.keys(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>));
  } catch {
    return new Set();
  }
}
