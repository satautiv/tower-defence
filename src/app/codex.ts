import { loadContent } from '@content/load';
import { DAMAGE_TYPES, STATUS_BY_DAMAGE_TYPE } from '@content/schema/common';
import type { DamageType } from '@content/schema/common';
import type { ContentRegistry } from '@content/loader';
import type { EnemyDefinition } from '@content/schema/enemy';
import type { ReactionDefinition } from '@content/schema/reaction';
import type { StatusDefinition } from '@content/schema/status';
import type { TowerDefinition } from '@content/schema/tower';
import { SimEventKind } from '@sim/index';
import type { World } from '@sim/index';
import type { Profile } from './profile.js';

/**
 * The Codex, in-game and auto-populated by play (#38, docs/GAME_DESIGN.md §15).
 *
 * The anti-wiki feature: success criterion #6 is that a player never has to
 * open a browser tab to understand a mechanic, which means everything the
 * simulation actually computes has to be *readable* somewhere inside the game.
 *
 * Pure, and it reads content rather than restating it. That is the load-bearing
 * decision: a Codex that held its own copy of a reaction's numbers would be a
 * second source of truth for the thing the whole game is built on, and it would
 * be wrong the first time `reactions.json` was retuned. Everything below is
 * derived from the same files `buildRuleset` resolves, so "with its exact
 * formula" is true by construction rather than by diligence.
 */

export type CodexSection = 'towers' | 'enemies' | 'reactions' | 'statuses' | 'damage';

/** Sections whose entries have to be found by playing. */
const DISCOVERED_SECTIONS: readonly CodexSection[] = ['towers', 'enemies', 'reactions'];

/**
 * One line of an entry: a label and a value.
 *
 * Rows rather than a rendered string, so the screen decides the layout and this
 * stays testable without a DOM.
 */
export interface CodexRow {
  readonly label: string;
  readonly value: string;
}

export interface CodexEntry {
  readonly id: string;
  readonly section: CodexSection;
  /** Locale key. Never a display string — every player-facing word goes through i18n. */
  readonly nameKey: string;
  /** Locale key for the description, where the content authors one. */
  readonly descriptionKey?: string;
  /** Locale key for the counter-play hint. Enemies only. */
  readonly counterKey?: string;
  readonly rows: readonly CodexRow[];
  /**
   * Whether this entry has to be discovered.
   *
   * Statuses and damage types are reference material: a player meeting Scorch
   * for the first time needs to be able to look it up, and hiding the rules of
   * the game behind having already met them is the opposite of the point.
   */
  readonly discoverable: boolean;
  /** Words a search matches against, beyond the name. Ids and trait names. */
  readonly terms: readonly string[];
}

/* ------------------------------------------------------------- formatting */

/** Trims a float to at most two decimals without printing "12.00". */
function num(value: number): string {
  return String(Number(value.toFixed(2)));
}

function seconds(value: number): string {
  return `${num(value)}s`;
}

function percent(fraction: number): string {
  return `${num(fraction * 100)}%`;
}

/* ------------------------------------------------------------------ rows */

/**
 * A tower at every rung it has.
 *
 * Tiers one to three are the base path; each specialisation adds two more. The
 * §38 scope asks for "full stats at every tier and specialisation", so the rows
 * are per rung rather than a summary of the first.
 */
function towerRows(tower: TowerDefinition): CodexRow[] {
  const rows: CodexRow[] = [];

  const tierRows = (label: string, tiers: TowerDefinition['tiers'][number][]): void => {
    tiers.forEach((tier, i) => {
      const parts = [
        `${num(tier.damage)} ${tier.damageType}`,
        `${num(tier.fireRate)}/s`,
        `${num(tier.rangeTiles)} tiles`,
        `${tier.cost}g`,
      ];
      if (tier.splashRadiusTiles > 0) parts.push(`splash ${num(tier.splashRadiusTiles)}`);
      if (tier.chainTargets > 0) parts.push(`chains ${tier.chainTargets}`);
      if (tier.armourPierce > 0) parts.push(`pierces ${num(tier.armourPierce)} armour`);
      if (tier.targets !== 'both') parts.push(`${tier.targets} only`);
      if (tier.statusApplied !== undefined) {
        parts.push(`${tier.statusApplied.stacks} ${tier.statusApplied.status}`);
      }
      if (tier.garrison !== undefined) parts.push(`${tier.garrison.count} soldiers`);
      rows.push({ label: `${label} ${i + 1}`, value: parts.join(' · ') });
    });
  };

  tierRows('Tier', [...tower.tiers]);
  for (const branch of tower.specialisations) {
    tierRows(`— ${branch.id}`, [...branch.tiers]);
    rows.push({ label: `— ${branch.id} ability`, value: branch.ability.id });
  }
  return rows;
}

function enemyRows(enemy: EnemyDefinition): CodexRow[] {
  const rows: CodexRow[] = [
    { label: 'Health', value: num(enemy.hp) },
    { label: 'Speed', value: `${num(enemy.speed)} tiles/s` },
  ];
  if (enemy.armour > 0) rows.push({ label: 'Armour', value: num(enemy.armour) });
  if (enemy.ward > 0) rows.push({ label: 'Ward', value: num(enemy.ward) });
  rows.push({ label: 'Bounty', value: `${enemy.bounty}g` });
  if (enemy.livesCost !== 1)
    rows.push({ label: 'Lives if it leaks', value: String(enemy.livesCost) });
  if (enemy.traits.length > 0) rows.push({ label: 'Traits', value: enemy.traits.join(', ') });
  if (enemy.phases.length > 0) {
    rows.push({
      label: 'Phases',
      value: enemy.phases.map((phase) => `below ${percent(phase.belowHealthFraction)}`).join(', '),
    });
  }
  return rows;
}

/**
 * A reaction's exact formula, which is the criterion this file answers to.
 *
 * > Every reaction the player triggers is recorded with correct maths.
 *
 * Written the way `reactions.ts` computes it — `base + perStack × stacks of a`,
 * read *before* the statuses are consumed — rather than as a rounded example,
 * and the multipliers that apply afterwards are named rather than folded in,
 * because a Surge node or a talent changes the number a player sees and a
 * formula that pretended otherwise would be the wiki this feature exists to
 * replace.
 */
export function reactionFormula(reaction: ReactionDefinition, maxStacks: number): string {
  const per =
    reaction.damagePerStack > 0
      ? ` + ${num(reaction.damagePerStack)} per stack of ${reaction.a}`
      : '';
  const cap =
    reaction.damagePerStack > 0
      ? ` (up to ${num(reaction.baseDamage + reaction.damagePerStack * maxStacks)} at ${maxStacks})`
      : '';
  return `${num(reaction.baseDamage)}${per}${cap}`;
}

/** What the reaction deals against the stacks it is triggered on. */
export function reactionDamage(reaction: ReactionDefinition, stacks: number): number {
  return reaction.baseDamage + reaction.damagePerStack * stacks;
}

function reactionRows(reaction: ReactionDefinition, registry: ContentRegistry): CodexRow[] {
  const maxStacks = registry.statuses.get(reaction.a)?.maxStacks ?? 1;
  const rows: CodexRow[] = [
    { label: 'Ingredients', value: `${reaction.a} + ${reaction.b}` },
    { label: 'Damage', value: `${reactionFormula(reaction, maxStacks)}, arcane` },
    { label: 'Lockout', value: `${seconds(reaction.cooldownSeconds)} per enemy` },
    { label: 'Consumes them', value: reaction.consumes ? 'yes' : 'no' },
  ];
  if (reaction.radiusTiles > 0) {
    rows.push({ label: 'Blast', value: `${num(reaction.radiusTiles)} tiles` });
  }
  if (reaction.jumps > 0) rows.push({ label: 'Arcs to', value: `${reaction.jumps} more` });
  if (reaction.damageOverSeconds > 0) {
    rows.push({ label: 'Burns over', value: seconds(reaction.damageOverSeconds) });
  }
  if (reaction.defenceMultiplier !== 1) {
    rows.push({
      label: 'Armour and ward',
      value: `×${num(reaction.defenceMultiplier)} for ${seconds(reaction.defenceSeconds)}`,
    });
  }
  if (reaction.appliesStatus !== undefined) {
    rows.push({
      label: 'Leaves behind',
      value: `${reaction.appliesStatus.stacks} ${reaction.appliesStatus.status}`,
    });
  }
  if (reaction.bonusStacks > 0) {
    rows.push({ label: 'Adds stacks', value: `+${reaction.bonusStacks} to the status it matched` });
  }
  if (reaction.durationMultiplier !== 1) {
    rows.push({ label: 'Duration', value: `×${num(reaction.durationMultiplier)}` });
  }
  rows.push({
    label: 'Then multiplied by',
    value: 'Surge ley nodes and Conduction talents',
  });
  return rows;
}

function statusRows(status: StatusDefinition): CodexRow[] {
  const rows: CodexRow[] = [
    { label: 'Stacks', value: `up to ${status.maxStacks}` },
    { label: 'Lasts', value: seconds(status.durationSeconds) },
  ];
  if (status.damagePerSecondPerStack > 0) {
    rows.push({
      label: 'Burns',
      value: `${num(status.damagePerSecondPerStack)}/s per stack — ${num(
        status.damagePerSecondPerStack * status.maxStacks,
      )}/s at ${status.maxStacks}`,
    });
  }
  if (status.slowPerStack > 0) {
    rows.push({ label: 'Slows', value: `${percent(status.slowPerStack)} per stack` });
  }
  if (status.defenceReductionPerStack > 0) {
    rows.push({
      label: 'Strips',
      value: `${num(status.defenceReductionPerStack)} armour and ward per stack`,
    });
  }
  if (status.vulnerabilityPerStack > 0) {
    rows.push({
      label: 'Damage taken',
      value: `+${percent(status.vulnerabilityPerStack)} per stack`,
    });
  }
  if (status.chainTargetsPerStack > 0) {
    rows.push({
      label: 'Chain targets',
      value: `+${num(status.chainTargetsPerStack)} per stack`,
    });
  }
  if (status.escalatesTo !== undefined) {
    rows.push({
      label: 'At full stacks',
      value: `becomes ${status.escalatesTo}, leaving ${status.stacksAfterEscalation}`,
    });
  }
  rows.push({ label: 'Reacts', value: status.reactive ? 'yes' : 'no — it never detonates' });
  return rows;
}

/**
 * Damage types, and the one status each is allowed to apply.
 *
 * Read from `STATUS_BY_DAMAGE_TYPE`, the table `content:lint` already checks a
 * tower against, so the Codex cannot claim a pairing the content would refuse.
 */
function damageRows(type: DamageType, registry: ContentRegistry): CodexRow[] {
  const applies = STATUS_BY_DAMAGE_TYPE[type];
  const rows: CodexRow[] = [
    {
      label: 'Reduced by',
      value: type === 'kinetic' ? 'Armour' : type === 'true' ? 'nothing' : 'Ward',
    },
    { label: 'Applies', value: applies ?? 'no status' },
  ];
  if (applies !== undefined) {
    const reacts = [...registry.reactions.values()].filter(
      (reaction) => reaction.a === applies || reaction.b === applies || reaction.b === 'any',
    );
    rows.push({
      label: 'Feeds',
      value: reacts.length === 0 ? 'no reaction' : reacts.map((r) => r.id).join(', '),
    });
  }
  return rows;
}

/* --------------------------------------------------------------- entries */

/** Every entry the Codex can show, in the order a reader should meet them. */
export function codexEntries(registry: ContentRegistry = loadContent()): CodexEntry[] {
  const entries: CodexEntry[] = [];

  for (const tower of registry.towers.values()) {
    entries.push({
      id: tower.id,
      section: 'towers',
      nameKey: tower.nameKey,
      descriptionKey: tower.descriptionKey,
      rows: towerRows(tower),
      discoverable: true,
      terms: [tower.id, tower.family, ...tower.tiers.map((tier) => tier.damageType)],
    });
  }

  for (const enemy of registry.enemies.values()) {
    entries.push({
      id: enemy.id,
      section: 'enemies',
      nameKey: enemy.nameKey,
      ...(enemy.counterKey === undefined ? {} : { counterKey: enemy.counterKey }),
      rows: enemyRows(enemy),
      discoverable: true,
      terms: [enemy.id, ...enemy.traits],
    });
  }

  for (const reaction of registry.reactions.values()) {
    entries.push({
      id: reaction.id,
      section: 'reactions',
      nameKey: reaction.nameKey,
      descriptionKey: reaction.descriptionKey,
      rows: reactionRows(reaction, registry),
      discoverable: true,
      terms: [reaction.id, reaction.a, reaction.b],
    });
  }

  for (const status of registry.statuses.values()) {
    entries.push({
      id: status.id,
      section: 'statuses',
      nameKey: status.nameKey,
      descriptionKey: status.descriptionKey,
      rows: statusRows(status),
      discoverable: false,
      terms: [status.id],
    });
  }

  for (const type of DAMAGE_TYPES) {
    entries.push({
      id: type,
      section: 'damage',
      nameKey: `damage.${type}.name`,
      descriptionKey: `damage.${type}.desc`,
      rows: damageRows(type, registry),
      discoverable: false,
      terms: [type],
    });
  }

  return entries;
}

/* ------------------------------------------------------------- discovery */

/** What the player has met, by section. */
export function discoveredIn(profile: Profile, section: CodexSection): ReadonlySet<string> {
  switch (section) {
    case 'towers':
      return new Set(profile.codexTowers);
    case 'enemies':
      return new Set(profile.codexEnemies);
    case 'reactions':
      return new Set(profile.codexReactions);
    default:
      /* Reference material, always open. */
      return new Set();
  }
}

export function isDiscovered(profile: Profile, entry: CodexEntry): boolean {
  return !entry.discoverable || discoveredIn(profile, entry.section).has(entry.id);
}

/** What one run met, to be folded into the profile when it ends. */
export interface CodexFindings {
  readonly towers: readonly string[];
  readonly enemies: readonly string[];
  readonly reactions: readonly string[];
}

export const NOTHING_FOUND: CodexFindings = { towers: [], enemies: [], reactions: [] };

function merge(known: readonly string[], found: readonly string[]): string[] | null {
  const novel = found.filter((id) => !known.includes(id));
  if (novel.length === 0) return null;
  return [...known, ...novel].sort();
}

/**
 * Folds a run's discoveries into the profile.
 *
 * Returns the profile unchanged when nothing is new, so a caller can persist on
 * identity and a run that met nothing costs no write. That matters more than it
 * looks: this is called at the end of every stage, and the profile is
 * localStorage.
 */
export function recordFindings(profile: Profile, found: CodexFindings): Profile {
  const towers = merge(profile.codexTowers, found.towers);
  const enemies = merge(profile.codexEnemies, found.enemies);
  const reactions = merge(profile.codexReactions, found.reactions);
  if (towers === null && enemies === null && reactions === null) return profile;

  return {
    ...profile,
    codexTowers: towers ?? profile.codexTowers,
    codexEnemies: enemies ?? profile.codexEnemies,
    codexReactions: reactions ?? profile.codexReactions,
  };
}

export interface CodexProgress {
  readonly found: number;
  readonly total: number;
  /** 0-100, rounded down so it only reads 100 when everything really is found. */
  readonly percent: number;
}

/**
 * How much of the Codex has been filled in.
 *
 * Counts only what has to be discovered. Statuses and damage types are open
 * from the first run, and including them would start a new player at forty
 * percent of a thing they have not done.
 */
export function codexProgress(
  profile: Profile,
  entries: readonly CodexEntry[] = codexEntries(),
): CodexProgress {
  let found = 0;
  let total = 0;
  for (const entry of entries) {
    if (!entry.discoverable) continue;
    total++;
    if (isDiscovered(profile, entry)) found++;
  }
  return { found, total, percent: total === 0 ? 0 : Math.floor((found / total) * 100) };
}

export { DISCOVERED_SECTIONS };

/**
 * Entries matching a search, within one section or across all of them.
 *
 * Matching happens on ids and trait names as well as on the resolved name,
 * which the caller supplies: `app/` does not reach into the interface for
 * words, and "golem" should find the Bulwark Golem whichever of the two a
 * player types. An undiscovered entry is still returned — the screen draws it
 * as a locked row, because a Codex that hid the *shape* of what is left would
 * not tell a player there is anything to look for.
 */
export function matchingEntries(
  entries: readonly CodexEntry[],
  query: string,
  section: CodexSection | null,
  nameOf: (key: string) => string,
): CodexEntry[] {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (section !== null && entry.section !== section) return false;
    if (needle === '') return true;
    if (nameOf(entry.nameKey).toLowerCase().includes(needle)) return true;
    return entry.terms.some((term) => term.toLowerCase().includes(needle));
  });
}

/* ------------------------------------------------------------ recording */

/**
 * Watches one run and remembers what it met (#38).
 *
 * Reads the event buffer, exactly as the view and audio layers do, so the
 * simulation stays unaware the Codex exists.
 *
 * The awkward part is enemies, and it is worth saying why. `EnemyDied` carries
 * the *entity* id and not the type: all five of its payload slots are spoken
 * for, and by the time anything drains the buffer the slot has been freed, so
 * there is nothing left to ask. Growing the event record for a feature outside
 * the tick loop would be the wrong trade, so this keeps its own map from
 * entity to enemy, filled on spawn and emptied on death or leak. It is bounded
 * by the number of enemies alive, which the pools already cap.
 */
export class CodexScout {
  private readonly towers = new Set<string>();
  private readonly enemies = new Set<string>();
  private readonly reactions = new Set<string>();
  private readonly living = new Map<number, string>();

  /**
   * Adopts the enemies already on the board.
   *
   * A resumed run did not see its spawns — they happened before the snapshot —
   * so without this, killing something that was already walking would discover
   * nothing.
   */
  seed(world: World): void {
    const pool = world.enemies;
    for (let slot = 0; slot < pool.watermark; slot++) {
      if (!pool.isAlive(slot)) continue;
      const id = this.enemyIdAt(world, pool.typeIdx[slot] as number);
      if (id !== null) this.living.set(pool.ids[slot] as number, id);
    }
  }

  consume(world: World): void {
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      switch (event.kind) {
        case SimEventKind.EnemySpawned: {
          const id = this.enemyIdAt(world, event.b);
          if (id !== null) this.living.set(event.a, id);
          break;
        }
        case SimEventKind.EnemyDied: {
          const id = this.living.get(event.a);
          if (id !== undefined) this.enemies.add(id);
          this.living.delete(event.a);
          break;
        }
        /* Not a discovery: something that walked past is not something the
           player has learned to kill. The entry is dropped so the map does not
           outlive the run. */
        case SimEventKind.EnemyLeaked:
          this.living.delete(event.a);
          break;
        case SimEventKind.ReactionTriggered: {
          const id = world.rules.reactions.ids[event.a];
          if (id !== undefined) this.reactions.add(id);
          break;
        }
        case SimEventKind.TowerBuilt: {
          const id = world.rules.towers.ids[event.b];
          if (id !== undefined) this.towers.add(id);
          break;
        }
        default:
          break;
      }
    }
  }

  get findings(): CodexFindings {
    return {
      towers: [...this.towers],
      enemies: [...this.enemies],
      reactions: [...this.reactions],
    };
  }

  reset(): void {
    this.towers.clear();
    this.enemies.clear();
    this.reactions.clear();
    this.living.clear();
  }

  /**
   * The content id behind a row of the enemy table.
   *
   * A boss's later phases are extra rows named `grendrix#2`, which is not a
   * content id and has no Codex entry of its own — a boss crossing a threshold
   * is still the same boss. Only reachable through `seed`, since a phase change
   * emits no spawn.
   */
  private enemyIdAt(world: World, typeIdx: number): string | null {
    const row = world.rules.enemies.ids[typeIdx];
    if (row === undefined) return null;
    const hash = row.indexOf('#');
    return hash < 0 ? row : row.slice(0, hash);
  }
}
