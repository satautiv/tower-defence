import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { DAMAGE_TYPES } from '@content/schema/common';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  CodexScout,
  NOTHING_FOUND,
  codexEntries,
  codexProgress,
  discoveredIn,
  isDiscovered,
  matchingEntries,
  reactionDamage,
  reactionFormula,
  recordFindings,
} from '@app/codex';
import type { CodexEntry } from '@app/codex';
import { EMPTY_PROFILE } from '@app/profile';
import type { Profile } from '@app/profile';
import {
  DAMAGE_INDEX,
  EnemyFlag,
  STATUS_INDEX,
  SimEventKind,
  applyStatus,
  buildTower,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  lifecycleSystem,
  reactionSystem,
  spawnEnemy,
  targetingSystem,
  tick,
  towerIndex,
} from '@sim/index';
import type { World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';
import locale from '../../src/i18n/en.json';

/**
 * The Codex (#38, docs/GAME_DESIGN.md §15).
 *
 * The acceptance criterion this file exists for is the first one:
 *
 * > Every reaction the player triggers is recorded with correct maths.
 *
 * "Correct" is not a thing a screenshot proves. The last block below triggers
 * each reaction in a real world and checks the Codex's arithmetic against the
 * magnitude the simulation actually emitted — so a retune of `reactions.json`
 * moves both together, and a Codex that drifted from the game would fail here
 * rather than mislead a player.
 */

const registry = buildRegistry(readContentFromDisk());
const entries = codexEntries(registry);
const keys = new Set(Object.keys(locale as Record<string, string>));
const text = (key: string): string => (locale as Record<string, string>)[key] ?? key;

const bySection = (section: CodexEntry['section']): CodexEntry[] =>
  entries.filter((entry) => entry.section === section);

describe('what the Codex holds', () => {
  it('covers every tower, enemy, reaction, status and damage type', () => {
    expect(bySection('towers')).toHaveLength(registry.towers.size);
    expect(bySection('enemies')).toHaveLength(registry.enemies.size);
    expect(bySection('reactions')).toHaveLength(registry.reactions.size);
    expect(bySection('statuses')).toHaveLength(registry.statuses.size);
    expect(bySection('damage')).toHaveLength(DAMAGE_TYPES.length);
  });

  /* A row with no words renders as a locale key on the player's screen. */
  it('names everything through the locale file', () => {
    for (const entry of entries) {
      expect(keys.has(entry.nameKey), `${entry.section} ${entry.id}: ${entry.nameKey}`).toBe(true);
      if (entry.descriptionKey !== undefined) {
        expect(keys.has(entry.descriptionKey), `${entry.id}: ${entry.descriptionKey}`).toBe(true);
      }
      if (entry.counterKey !== undefined) {
        expect(keys.has(entry.counterKey), `${entry.id}: ${entry.counterKey}`).toBe(true);
      }
    }
  });

  it('gives every entry something to say', () => {
    for (const entry of entries) expect(entry.rows.length, entry.id).toBeGreaterThan(0);
  });

  /* §38 asks for "full stats at every tier and specialisation", which is three
     base rungs plus two per branch, not a summary of tier one. */
  it('shows a tower at every rung it has', () => {
    for (const tower of registry.towers.values()) {
      const entry = entries.find((e) => e.section === 'towers' && e.id === tower.id);
      const labels = entry?.rows.map((row) => row.label) ?? [];

      tower.tiers.forEach((_, i) => expect(labels, tower.id).toContain(`Tier ${i + 1}`));
      for (const branch of tower.specialisations) {
        branch.tiers.forEach((_, i) =>
          expect(labels, branch.id).toContain(`— ${branch.id} ${i + 1}`),
        );
        expect(labels, branch.id).toContain(`— ${branch.id} ability`);
      }
    }
  });

  /* Statuses and damage types are reference, not reward: a player meeting
     Scorch for the first time has to be able to look it up. */
  it('keeps the rules of the game open and gates only what is met in play', () => {
    for (const entry of entries) {
      const gated = ['towers', 'enemies', 'reactions'].includes(entry.section);
      expect(entry.discoverable, `${entry.section} ${entry.id}`).toBe(gated);
      if (!gated) expect(isDiscovered(EMPTY_PROFILE, entry)).toBe(true);
    }
  });
});

describe('every enemy says how to fight it', () => {
  it.each([...registry.enemies.keys()])('%s carries a counter-play hint', (id) => {
    const entry = entries.find((e) => e.section === 'enemies' && e.id === id);
    expect(entry?.counterKey, id).toBeDefined();
    expect(text(entry?.counterKey ?? '').length).toBeGreaterThan(20);
  });
});

describe('discovery', () => {
  it('starts empty and reads nothing as found', () => {
    expect(codexProgress(EMPTY_PROFILE, entries)).toMatchObject({ found: 0, percent: 0 });
    expect(discoveredIn(EMPTY_PROFILE, 'enemies').size).toBe(0);
  });

  it('counts only what has to be found', () => {
    const discoverable = entries.filter((entry) => entry.discoverable).length;
    expect(codexProgress(EMPTY_PROFILE, entries).total).toBe(discoverable);
    expect(discoverable).toBeLessThan(entries.length);
  });

  it('records what a run met', () => {
    const profile = recordFindings(EMPTY_PROFILE, {
      towers: ['frost_cairn'],
      enemies: ['husk', 'riftling'],
      reactions: ['thermal_shock'],
    });
    expect(profile.codexTowers).toEqual(['frost_cairn']);
    expect(profile.codexEnemies).toEqual(['husk', 'riftling']);
    expect(codexProgress(profile, entries).found).toBe(4);
  });

  /* Called at the end of every stage, against localStorage. A run that met
     nothing new must not cost a write, and identity is how the caller tells. */
  it('returns the same profile when nothing is new', () => {
    const profile = recordFindings(EMPTY_PROFILE, {
      towers: ['frost_cairn'],
      enemies: [],
      reactions: [],
    });
    expect(recordFindings(profile, { towers: ['frost_cairn'], enemies: [], reactions: [] })).toBe(
      profile,
    );
    expect(recordFindings(profile, NOTHING_FOUND)).toBe(profile);
  });

  it('never records the same thing twice', () => {
    let profile: Profile = EMPTY_PROFILE;
    for (let i = 0; i < 3; i++) {
      profile = recordFindings(profile, { towers: [], enemies: ['husk'], reactions: [] });
    }
    expect(profile.codexEnemies).toEqual(['husk']);
  });

  it('reaches a hundred percent only when everything discoverable is found', () => {
    const full = recordFindings(EMPTY_PROFILE, {
      towers: [...registry.towers.keys()],
      enemies: [...registry.enemies.keys()],
      reactions: [...registry.reactions.keys()],
    });
    expect(codexProgress(full, entries).percent).toBe(100);

    const oneShort = { ...full, codexEnemies: full.codexEnemies.slice(1) };
    expect(codexProgress(oneShort, entries).percent).toBeLessThan(100);
  });
});

describe('search', () => {
  const find = (query: string, section: Parameters<typeof matchingEntries>[2] = null): string[] =>
    matchingEntries(entries, query, section, text).map((entry) => entry.id);

  it('returns everything for an empty query', () => {
    expect(find('')).toHaveLength(entries.length);
  });

  it('matches the name a player reads', () => {
    expect(find('Bulwark')).toContain('bulwark_golem');
  });

  it('matches the id a player never sees, because both are typed', () => {
    expect(find('bulwark_golem')).toContain('bulwark_golem');
  });

  /* "What has flying?" is a real question, and the trait is the only word that
     answers it. */
  it('matches a trait', () => {
    const flying = find('flying', 'enemies');
    expect(flying).toContain('rift_bat');
    expect(flying).not.toContain('husk');
  });

  it('narrows to one section', () => {
    expect(find('', 'reactions')).toHaveLength(registry.reactions.size);
  });

  it('finds nothing for nonsense rather than everything', () => {
    expect(find('qqzz')).toHaveLength(0);
  });
});

/* ------------------------------------------------------- the criterion */

const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

function worldWith(statuses: Array<[string, number]>): { world: World; slot: number } {
  const world = createWorldForStage(registry, stage!, 4, FULL_ROSTER);
  const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
  world.enemies.hp[slot] = 100_000;
  world.enemies.maxHp[slot] = 100_000;
  world.enemies.armour[slot] = 0;
  world.enemies.ward[slot] = 0;
  world.enemies.x[slot] = 500;
  world.enemies.y[slot] = 500;
  for (const [status, count] of statuses) {
    applyStatus(world, slot, STATUS_INDEX[status as keyof typeof STATUS_INDEX], count);
  }
  return { world, slot };
}

function magnitudeOf(world: World, id: string): number | null {
  const row = world.rules.reactions.ids.indexOf(id);
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.ReactionTriggered && event.a === row) return event.d;
  }
  return null;
}

/**
 * > Every reaction the player triggers is recorded with correct maths.
 *
 * Each reaction is triggered for real and the Codex's arithmetic is checked
 * against the magnitude the simulation emitted. Nothing here restates a number
 * from `reactions.json`: both sides read the content, which is what makes this
 * survive a retune instead of breaking on one.
 *
 * Worth knowing about its reach today: **only Thermal Shock has a per-stack
 * term**, and Superconduct and Amplify deal no damage at all — they strip
 * defence and add stacks instead. So the `base + perStack × stacks` half of the
 * formula is exercised by one row out of five. That is a fact about the
 * authored matrix rather than a hole in the test: give any other reaction a
 * `damagePerStack` and this tightens on it with no edit here.
 */
describe('the maths the Codex prints is the maths the game does', () => {
  it.each([...registry.reactions.values()].map((r) => [r.id, r] as const))(
    '%s',
    (id, definition) => {
      /* Amplify matches anything, so it is fed a second reactive status rather
         than a literal "any". */
      const partner = definition.b === 'any' ? 'corrode' : definition.b;
      const aStacks = registry.statuses.get(definition.a)?.maxStacks ?? 1;

      const { world, slot } = worldWith([
        [definition.a, aStacks],
        [partner, 1],
      ]);
      const carried = world.enemies.stacksOf(
        slot,
        STATUS_INDEX[definition.a as keyof typeof STATUS_INDEX],
      );

      targetingSystem(world);
      reactionSystem(world);
      damageResolutionSystem(world);

      const emitted = magnitudeOf(world, id);
      expect(emitted, `${id} did not trigger`).not.toBeNull();
      expect(reactionDamage(definition, carried)).toBeCloseTo(emitted as number, 4);
    },
  );

  it('prints the formula rather than one example of it', () => {
    const shock = registry.reactions.get('thermal_shock');
    if (shock === undefined) throw new Error('thermal_shock missing');
    const maxStacks = registry.statuses.get(shock.a)?.maxStacks ?? 1;
    const printed = reactionFormula(shock, maxStacks);

    expect(printed).toContain(String(shock.baseDamage));
    expect(printed).toContain(String(shock.damagePerStack));
    expect(printed).toContain(shock.a);
    /* And the number a fully-stacked hit really comes to. */
    expect(printed).toContain(String(reactionDamage(shock, maxStacks)));
  });

  /* Surge nodes and Conduction talents multiply it afterwards. A formula that
     folded them in would be wrong for every board that has neither, and one
     that ignored them would be wrong for every board that has them. */
  it('says what multiplies it afterwards', () => {
    for (const entry of bySection('reactions')) {
      const after = entry.rows.find((row) => row.label === 'Then multiplied by');
      expect(after?.value, entry.id).toMatch(/Surge|talent/i);
    }
  });
});

/**
 * What a run teaches, read off the event buffer (#38).
 *
 * The scout is the only stateful thing in the Codex, and the reason it has
 * state at all is worth re-reading: `EnemyDied` carries an entity id and not a
 * type, all five payload slots are spoken for, and the slot is freed before
 * anything drains the buffer. So the scout keeps its own map from entity to
 * enemy. These tests drive a real world rather than hand-built events, because
 * a map that went stale would look perfect against synthetic input.
 */
describe('what a run discovers', () => {
  function scoutedWorld(): { world: World; scout: CodexScout } {
    const world = createWorldForStage(registry, stage!, 11, FULL_ROSTER);
    return { world, scout: new CodexScout() };
  }

  it('finds nothing before anything happens', () => {
    const { scout } = scoutedWorld();
    expect(scout.findings).toEqual({ towers: [], enemies: [], reactions: [] });
  });

  it('records a tower the moment it is built', () => {
    const { world, scout } = scoutedWorld();
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage has no plots');

    buildTower(world.commands, plot.id, towerIndex(world, 'frost_cairn'));
    tick(world);
    scout.consume(world);

    expect(scout.findings.towers).toEqual(['frost_cairn']);
  });

  /* An enemy is discovered by killing it, not by meeting it. */
  it('records an enemy on the kill and not on the spawn', () => {
    const { world, scout } = scoutedWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    scout.consume(world);
    expect(scout.findings.enemies).toEqual([]);

    /* Killed through the shared damage queue, so the death event is the real
       one rather than a hand-written stand-in. */
    world.damage.push(slot, 10_000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    scout.consume(world);

    expect(scout.findings.enemies).toEqual(['husk']);
  });

  /* Something that walked past is not something the player learned to kill. */
  it('does not record an enemy that leaked', () => {
    const { world, scout } = scoutedWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'riftling'), 0);
    scout.consume(world);

    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;
    lifecycleSystem(world);
    scout.consume(world);

    expect(scout.findings.enemies).toEqual([]);
  });

  it('records a reaction the tick it detonates', () => {
    const { world, scout } = scoutedWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.hp[slot] = 100_000;
    world.enemies.maxHp[slot] = 100_000;
    world.enemies.x[slot] = 500;
    world.enemies.y[slot] = 500;
    applyStatus(world, slot, STATUS_INDEX.scorch, 3);
    applyStatus(world, slot, STATUS_INDEX.chill, 1);

    targetingSystem(world);
    reactionSystem(world);
    scout.consume(world);

    expect(scout.findings.reactions).toEqual(['thermal_shock']);
  });

  /* A retry starts a fresh run, and the last one's findings are already in the
     profile: carrying them over would re-record them every time. */
  it('forgets everything on reset', () => {
    const { world, scout } = scoutedWorld();
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage has no plots');
    buildTower(world.commands, plot.id, towerIndex(world, 'frost_cairn'));
    tick(world);
    scout.consume(world);
    expect(scout.findings.towers).toHaveLength(1);

    scout.reset();
    expect(scout.findings).toEqual({ towers: [], enemies: [], reactions: [] });
  });

  /* A resumed run never saw its spawns. Without adopting what is already on
     the board, killing it would discover nothing. */
  it('adopts the enemies a resumed run inherited', () => {
    const { world } = scoutedWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'rift_bat'), 0);
    world.events.clear();

    const scout = new CodexScout();
    scout.seed(world);
    world.damage.push(slot, 10_000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    scout.consume(world);

    expect(scout.findings.enemies).toEqual(['rift_bat']);
  });
});
