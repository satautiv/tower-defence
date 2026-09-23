import { STATUS_BY_DAMAGE_TYPE } from './schema/common.js';
import type { ContentRegistry } from './loader.js';
import type { StageDefinition, TowerTier } from './schema/index.js';

/**
 * Cross-reference validation, run as a build gate.
 *
 * Zod checks that each file is individually well-formed. These rules check the
 * things only visible across files: a wave naming an enemy that does not exist,
 * a plot placed off the map, an unlock chain that can never complete. Catching
 * them statically is the difference between a build failure and a stage that
 * crashes on wave nine.
 */

export interface Diagnostic {
  /** Stable rule id, so a fixture can assert on exactly this failure. */
  rule: string;
  /** What the problem is about — a stage id, tower id, or file path. */
  source: string;
  message: string;
}

/**
 * A stage that cannot fund this many of its cheapest tower is almost certainly
 * misconfigured rather than hard. Deliberately loose: content-lint should catch
 * broken stages, and leave "is this fun" to the balance simulator (#35).
 */
const MIN_AFFORDABLE_TOWERS = 4;

/**
 * Ley nodes per map, from the authoring rules (docs/GAME_DESIGN.md §5, §13.2).
 *
 * A band rather than a count, and a gate rather than a guideline: below it the
 * secondary mechanic is absent from a stage that is supposed to teach it, and
 * above it every interesting plot is a bonus plot, which is the same as none of
 * them being one.
 */
const MIN_LEY_NODES = 2;
const MAX_LEY_NODES = 4;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Every tier a tower can reach, base path and both specialisations. */
function allTiers(
  registry: ContentRegistry,
): Array<{ tower: string; label: string; tier: TowerTier }> {
  const out: Array<{ tower: string; label: string; tier: TowerTier }> = [];
  for (const tower of registry.towers.values()) {
    tower.tiers.forEach((tier, i) => out.push({ tower: tower.id, label: `tier ${i + 1}`, tier }));
    for (const spec of tower.specialisations) {
      spec.tiers.forEach((tier, i) =>
        out.push({ tower: tower.id, label: `${spec.id} tier ${i + 4}`, tier }),
      );
    }
  }
  return out;
}

function cheapestTowerCost(registry: ContentRegistry): number {
  let cheapest = Number.POSITIVE_INFINITY;
  for (const tower of registry.towers.values()) {
    const base = tower.tiers[0].cost;
    if (base < cheapest) cheapest = base;
  }
  return cheapest;
}

function totalWaveBounty(stage: StageDefinition, registry: ContentRegistry): number {
  let total = 0;
  for (const wave of stage.waves) {
    for (const group of wave.groups) {
      const enemy = registry.enemies.get(group.enemy);
      if (enemy !== undefined) total += enemy.bounty * group.count;
    }
  }
  return total;
}

/**
 * Collects every localisation key referenced by content.
 *
 * Convention-based: any string under a field ending in `Key`, or any string in
 * a `perkKeys` array. The schemas name locale fields consistently, so this
 * picks up new ones automatically instead of needing a hand-maintained list
 * that quietly falls behind.
 */
export function collectLocaleKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectLocaleKeys(item, into);
    return into;
  }
  if (value === null || typeof value !== 'object') return into;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && (key.endsWith('Key') || key === 'perkKeys')) {
      into.add(child);
    } else if (key === 'perkKeys' && Array.isArray(child)) {
      for (const item of child) if (typeof item === 'string') into.add(item);
    } else {
      collectLocaleKeys(child, into);
    }
  }
  return into;
}

export function lintContent(
  registry: ContentRegistry,
  localeKeys?: ReadonlySet<string>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (rule: string, source: string, message: string) =>
    out.push({ rule, source, message });

  /* ---- stages: waves, geometry, economy ---- */
  for (const stage of registry.stages.values()) {
    const spawnIds = new Set(stage.spawnPoints.map((s) => s.id));
    const pathIds = new Set(stage.paths.map((p) => p.id));

    for (const spawn of stage.spawnPoints) {
      if (!pathIds.has(spawn.pathId)) {
        add(
          'spawn-point-path-ref',
          stage.id,
          `spawn point ${spawn.id} uses unknown path ${spawn.pathId}`,
        );
      }
    }
    for (const path of stage.paths) {
      for (const branch of path.branches) {
        if (!pathIds.has(branch.targetPathId)) {
          add(
            'path-branch-ref',
            stage.id,
            `path ${path.id} branches to unknown path ${branch.targetPathId}`,
          );
        }
      }
      for (const [i, point] of path.points.entries()) {
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x > stage.widthTiles ||
          point.y > stage.heightTiles
        ) {
          add(
            'path-bounds',
            stage.id,
            `path ${path.id} point ${i} at (${point.x}, ${point.y}) is off the map`,
          );
        }
      }
    }

    stage.waves.forEach((wave, waveIndex) => {
      wave.groups.forEach((group, groupIndex) => {
        const where = `wave ${waveIndex + 1} group ${groupIndex + 1}`;
        if (!registry.enemies.has(group.enemy)) {
          add('wave-enemy-ref', stage.id, `${where} references unknown enemy "${group.enemy}"`);
        }
        if (!spawnIds.has(group.spawnPoint)) {
          add(
            'wave-spawn-point-ref',
            stage.id,
            `${where} uses unknown spawn point ${group.spawnPoint}`,
          );
        }
      });
    });

    for (const plot of stage.plots) {
      const { x, y } = plot.position;
      if (x < 0 || y < 0 || x > stage.widthTiles || y > stage.heightTiles) {
        add('plot-bounds', stage.id, `plot ${plot.id} at (${x}, ${y}) is off the map`);
      }
    }
    for (let i = 0; i < stage.plots.length; i++) {
      for (let j = i + 1; j < stage.plots.length; j++) {
        const a = stage.plots[i] as (typeof stage.plots)[number];
        const b = stage.plots[j] as (typeof stage.plots)[number];
        const gap = dist(a.position, b.position);
        if (gap < stage.minPlotSpacingTiles) {
          add(
            'plot-overlap',
            stage.id,
            `plots ${a.id} and ${b.id} are ${gap.toFixed(2)} tiles apart, closer than the ${stage.minPlotSpacingTiles} tile minimum`,
          );
        }
      }
    }

    const leyNodes = stage.plots.filter((plot) => plot.leyNode !== undefined).length;
    if (leyNodes < MIN_LEY_NODES || leyNodes > MAX_LEY_NODES) {
      add(
        'ley-node-count',
        stage.id,
        `has ${leyNodes} ley node(s), outside the ${MIN_LEY_NODES}-${MAX_LEY_NODES} the map authoring rules allow`,
      );
    }

    /* A seam nobody can see is decoration that failed at its one job, and a
       seam running off the map is a straightforward authoring slip. */
    stage.leySeams.forEach((seam, seamIndex) => {
      seam.forEach((point, i) => {
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x > stage.widthTiles ||
          point.y > stage.heightTiles
        ) {
          add(
            'ley-seam-bounds',
            stage.id,
            `ley seam ${seamIndex} point ${i} at (${point.x}, ${point.y}) is off the map`,
          );
        }
      });
    });

    const cheapest = cheapestTowerCost(registry);
    if (Number.isFinite(cheapest)) {
      if (stage.startingGold < cheapest) {
        add(
          'stage-economy',
          stage.id,
          `starting gold ${stage.startingGold} cannot afford the cheapest tower (${cheapest})`,
        );
      }
      const available = stage.startingGold + totalWaveBounty(stage, registry);
      const needed = cheapest * MIN_AFFORDABLE_TOWERS;
      if (available < needed) {
        add(
          'stage-economy',
          stage.id,
          `total available gold ${available} cannot fund ${MIN_AFFORDABLE_TOWERS} of the cheapest tower (${needed})`,
        );
      }
    }
  }

  /* ---- towers: status must be producible by the damage type ---- */
  for (const { tower, label, tier } of allTiers(registry)) {
    const applied = tier.statusApplied;
    if (applied === undefined) continue;
    const allowed = STATUS_BY_DAMAGE_TYPE[tier.damageType];
    if (allowed === undefined) {
      add(
        'tower-status-damage-type',
        tower,
        `${label} deals ${tier.damageType}, which applies no status, but claims "${applied.status}"`,
      );
    } else if (allowed !== applied.status) {
      add(
        'tower-status-damage-type',
        tower,
        `${label} deals ${tier.damageType}, which applies "${allowed}", but claims "${applied.status}"`,
      );
    }
    if (!registry.statuses.has(applied.status)) {
      add('status-ref', tower, `${label} applies unknown status "${applied.status}"`);
    }
  }

  /* ---- reactions reference real statuses ---- */
  for (const reaction of registry.reactions.values()) {
    if (!registry.statuses.has(reaction.a)) {
      add('reaction-status-ref', reaction.id, `references unknown status "${reaction.a}"`);
    }
    if (reaction.b !== 'any' && !registry.statuses.has(reaction.b)) {
      add('reaction-status-ref', reaction.id, `references unknown status "${reaction.b}"`);
    }
  }

  /* ---- statuses escalate into statuses that exist ---- */
  for (const status of registry.statuses.values()) {
    if (status.escalatesTo !== undefined && !registry.statuses.has(status.escalatesTo)) {
      add('status-ref', status.id, `escalates to unknown status "${status.escalatesTo}"`);
    }
  }

  /* ---- enemies that split must split into something real ---- */
  for (const enemy of registry.enemies.values()) {
    const into = enemy.traitConfig.splitsInto;
    if (into !== undefined && !registry.enemies.has(into)) {
      add('enemy-split-ref', enemy.id, `splits into unknown enemy "${into}"`);
    }
    const spawns = enemy.traitConfig.spawns;
    if (spawns !== undefined && !registry.enemies.has(spawns)) {
      add('enemy-spawn-ref', enemy.id, `spawns unknown enemy "${spawns}"`);
    }
  }

  /* ---- unlock gates must name a stage that exists ---- */
  const gated: Array<{ kind: string; id: string; stage: string | undefined }> = [
    ...[...registry.towers.values()].map((t) => ({
      kind: 'tower',
      id: t.id,
      stage: t.unlockedByStage,
    })),
    ...[...registry.powers.values()].map((p) => ({
      kind: 'power',
      id: p.id,
      stage: p.unlockedByStage,
    })),
    ...[...registry.heroes.values()].map((h) => ({
      kind: 'hero',
      id: h.id,
      stage: h.unlockedByStage,
    })),
  ];
  for (const entry of gated) {
    if (entry.stage !== undefined && !registry.stages.has(entry.stage)) {
      add(
        'unlock-stage-ref',
        `${entry.kind} ${entry.id}`,
        `unlocked by unknown stage "${entry.stage}"`,
      );
    }
  }

  /* ---- talent prerequisites exist and do not cycle ---- */
  for (const talent of registry.talents.values()) {
    for (const required of talent.requires) {
      if (!registry.talents.has(required)) {
        add('talent-requires-ref', talent.id, `requires unknown talent "${required}"`);
      }
    }
  }
  for (const cycle of findTalentCycles(registry)) {
    add('talent-cycle', cycle[0] ?? '(unknown)', `prerequisite cycle: ${cycle.join(' -> ')}`);
  }

  /* ---- challenges name a stage, towers and plots that exist ---- */
  for (const challenge of registry.challenges.values()) {
    const stage = registry.stages.get(challenge.stageId);
    if (stage === undefined) {
      add('challenge-stage-ref', challenge.id, `is for unknown stage "${challenge.stageId}"`);
    }

    for (const id of challenge.rules.allowedTowers) {
      if (!registry.towers.has(id)) {
        add('challenge-tower-ref', challenge.id, `allows unknown tower "${id}"`);
      }
    }

    const plotIds = new Set(stage?.plots.map((plot) => plot.id) ?? []);
    const taken = new Set<number>();
    for (const start of challenge.rules.startingTowers) {
      if (!registry.towers.has(start.tower)) {
        add('challenge-tower-ref', challenge.id, `starts with unknown tower "${start.tower}"`);
      }
      if (stage !== undefined && !plotIds.has(start.plotId)) {
        add(
          'challenge-plot-ref',
          challenge.id,
          `starts a tower on plot ${start.plotId}, which stage ${challenge.stageId} has not got`,
        );
      }
      if (taken.has(start.plotId)) {
        add('challenge-plot-twice', challenge.id, `starts two towers on plot ${start.plotId}`);
      }
      taken.add(start.plotId);
    }

    /* A challenge that allows nothing is unwinnable, and the failure is silent:
       the build menu simply offers no towers. Worth catching at lint rather
       than at the end of a playtest. */
    const allowsATower =
      challenge.rules.allowedTowers.length === 0 && challenge.rules.allowedDamageTypes.length === 0
        ? true
        : [...registry.towers.values()].some(
            (tower) =>
              (challenge.rules.allowedTowers.length === 0 ||
                challenge.rules.allowedTowers.includes(tower.id)) &&
              (challenge.rules.allowedDamageTypes.length === 0 ||
                challenge.rules.allowedDamageTypes.includes(tower.tiers[0]?.damageType ?? 'true')),
          );
    if (!allowsATower && challenge.rules.startingTowers.length === 0) {
      add('challenge-no-towers', challenge.id, 'allows no tower to be built and hands over none');
    }
  }

  /* ---- every referenced localisation key exists ---- */
  if (localeKeys !== undefined) {
    const referenced = collectLocaleKeys({
      towers: [...registry.towers.values()],
      enemies: [...registry.enemies.values()],
      stages: [...registry.stages.values()],
      powers: [...registry.powers.values()],
      heroes: [...registry.heroes.values()],
      talents: [...registry.talents.values()],
      challenges: [...registry.challenges.values()],
      statuses: [...registry.statuses.values()],
      reactions: [...registry.reactions.values()],
    });
    for (const key of [...referenced].sort()) {
      if (!localeKeys.has(key)) {
        add('locale-key-missing', key, 'referenced by content but absent from the locale file');
      }
    }
  }

  return out;
}

/** Depth-first search over talent prerequisites, reporting each cycle once. */
function findTalentCycles(registry: ContentRegistry): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const seen = state.get(id);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      const from = stack.indexOf(id);
      cycles.push([...stack.slice(from), id]);
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const required of registry.talents.get(id)?.requires ?? []) {
      if (registry.talents.has(required)) visit(required);
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const id of [...registry.talents.keys()].sort()) visit(id);
  return cycles;
}
