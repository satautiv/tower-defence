import { TICK_HZ } from '@core/constants';
import { buildRuleset } from '@sim/index';
import type { ContentRegistry } from '@content/loader';
import type { Draft } from './draft.js';

/**
 * What a wave is worth, live, while it is being composed (#34).
 *
 * The composer shows total health, total bounty and an estimated duration as
 * the author types, and every one of those numbers comes out of
 * `buildRuleset` — the same tables the simulation reads during a tick. A
 * second copy of the wave-scaling formula here would drift from §9.2 the first
 * time someone tuned it, and the composer would confidently show numbers the
 * game does not agree with.
 *
 * "Estimated" is honest about the duration: it is how long the *spawning*
 * takes, not how long the wave survives. How long it survives is a question
 * for the balance simulator, which plays the stage rather than adding up its
 * wave file.
 */

export interface WaveTotals {
  /** Enemies this wave sends. */
  count: number;
  /** Health, after the region and per-wave scaling the simulation applies. */
  hp: number;
  /** Gold this wave pays if every enemy dies, the clear bonus included. */
  bounty: number;
  /** Seconds from the wave starting until its last enemy has spawned. */
  spawnSeconds: number;
  /** Groups naming an enemy that does not exist. Empty is what an author wants. */
  unknownEnemies: string[];
}

export function waveTotals(draft: Draft, waveIndex: number, registry: ContentRegistry): WaveTotals {
  const empty: WaveTotals = {
    count: 0,
    hp: 0,
    bounty: 0,
    spawnSeconds: 0,
    unknownEnemies: [],
  };

  const wave = draft.waves[waveIndex];
  if (wave === undefined) return empty;

  /* Built from the draft itself, so the region multiplier is the draft's
     region rather than whatever stage happens to be loaded. */
  const rules = buildRuleset(registry, draft);
  const table = rules.enemies;
  const scale = rules.scaling;

  const hpScale = scale.hp * (1 + scale.hpGrowthPerWave * waveIndex);

  let count = 0;
  let hp = 0;
  let bounty = 0;
  let spawnSeconds = 0;
  const unknownEnemies: string[] = [];

  for (const group of wave.groups) {
    const typeIdx = table.indexOf.get(group.enemy);
    if (typeIdx === undefined) {
      unknownEnemies.push(group.enemy);
      continue;
    }

    count += group.count;
    hp += (table.hp[typeIdx] as number) * hpScale * group.count;
    /* Bounty grows by the square root so a player cannot out-earn the curve,
       and the rounding matches `awardKill` — a 15% cut of a small bounty is
       otherwise a different number here than in play. */
    bounty += Math.round((table.bounty[typeIdx] as number) * scale.bounty) * group.count;

    /* The last enemy of a group lands `count - 1` intervals after the group
       starts, not `count` — a group of one is instantaneous. */
    const groupEnd = group.delaySeconds + Math.max(0, group.count - 1) * group.intervalSeconds;
    if (groupEnd > spawnSeconds) spawnSeconds = groupEnd;
  }

  return {
    count,
    hp,
    bounty: bounty + wave.clearBonus,
    spawnSeconds,
    unknownEnemies,
  };
}

/** Every wave's totals, for the composer's summary row. */
export function allWaveTotals(draft: Draft, registry: ContentRegistry): WaveTotals[] {
  return draft.waves.map((_, index) => waveTotals(draft, index, registry));
}

/**
 * The longest a stage can take before a single shot is fired.
 *
 * Auto-start delays plus spawn time: the floor under a stage's length, and the
 * number that tells an author whether ten waves is a five-minute stage or a
 * twelve-minute one. §16 wants Region 1 stages at four to six minutes.
 */
export function stageFloorSeconds(draft: Draft, registry: ContentRegistry): number {
  return draft.waves.reduce(
    (total, wave, index) =>
      total + wave.autoStartDelaySeconds + waveTotals(draft, index, registry).spawnSeconds,
    0,
  );
}

/** Ticks the simulation would run for that floor, for anyone comparing to a replay. */
export function stageFloorTicks(draft: Draft, registry: ContentRegistry): number {
  return Math.round(stageFloorSeconds(draft, registry) * TICK_HZ);
}
