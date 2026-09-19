import { loadContent } from '@content/load';
import strings from '../i18n/en.json';

/**
 * Display text for content, until the localisation framework (#48) replaces it.
 *
 * Content carries locale keys rather than prose, so names are looked up the way
 * #48 will look them up — only always in English. A missing key shows the key
 * itself, which is loud enough to be noticed and fixed.
 */

const table: Readonly<Record<string, string>> = strings;

export function text(key: string): string {
  return table[key] ?? key;
}

export function enemyName(enemyId: string): string {
  const key = loadContent().enemies.get(enemyId)?.nameKey;
  return key === undefined ? enemyId : text(key);
}
