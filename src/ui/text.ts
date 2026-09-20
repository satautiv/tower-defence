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

export function statusName(statusId: string): string {
  const key = loadContent().statuses.get(statusId)?.nameKey;
  return key === undefined ? statusId : text(key);
}

export function powerName(powerId: string): string {
  const key = loadContent().powers.get(powerId)?.nameKey;
  return key === undefined ? powerId : text(key);
}

export function towerName(towerId: string): string {
  const key = loadContent().towers.get(towerId)?.nameKey;
  return key === undefined ? towerId : text(key);
}

export function heroName(heroId: string): string {
  const key = loadContent().heroes.get(heroId)?.nameKey;
  return key === undefined ? heroId : text(key);
}

export function heroAbilityName(heroId: string, abilityId: string): string {
  const ability = loadContent()
    .heroes.get(heroId)
    ?.abilities.find((candidate) => candidate.id === abilityId);
  return ability === undefined ? abilityId : text(ability.nameKey);
}

export function reactionName(reactionId: string): string {
  const key = loadContent().reactions.get(reactionId)?.nameKey;
  return key === undefined ? reactionId : text(key);
}
