import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { RawContent } from '@content/loader';
import type { World } from '@sim/index';
import {
  DAMAGE_BY_INDEX,
  FiringMode,
  TIER_SLOTS,
  applyTowerStats,
  buildOptions,
  createWorldForStage,
  placeTower,
  tick,
  towerIndex,
} from '@sim/index';

/**
 * The base roster (#23, GDD Part 2 §8).
 *
 * Two things are worth testing here and the rest is content review. First, that
 * the towers the design names actually exist with the stats it gives them —
 * checked against the document's own numbers, so a transcription slip fails
 * rather than quietly shipping a different game. Second, and far more
 * important, that **a ninth tower needs no code**: that is the property the
 * whole data-driven design was paid for, and it is invisible until someone
 * tries it.
 */

const raw = readContentFromDisk();
const registry = buildRegistry(raw);
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const world = (): World => createWorldForStage(registry, stage, 1);

describe('the roster the design names', () => {
  const EXPECTED = [
    'alchemists_still',
    'arbalest_post',
    'arcane_spire',
    'flame_vent',
    'frost_cairn',
    'mortar_emplacement',
    'tesla_coil',
    'wardens_barracks',
  ];

  it('has all eight base towers', () => {
    expect([...registry.towers.keys()].sort()).toEqual(EXPECTED);
  });

  it('spreads them across all four families', () => {
    const families = new Set([...registry.towers.values()].map((t) => t.family));
    expect([...families].sort()).toEqual(['arcane', 'control', 'marksman', 'ordnance']);
  });

  /** T1 stats, straight from the tables in §8.2–§8.5. */
  it.each([
    ['arbalest_post', 80, 12, 'kinetic', 1.2, 7.0],
    ['mortar_emplacement', 120, 45, 'kinetic', 0.4, 9.0],
    ['flame_vent', 100, 8, 'pyro', 4.0, 3.5],
    ['arcane_spire', 110, 22, 'arcane', 0.8, 6.5],
    ['tesla_coil', 130, 16, 'volt', 0.7, 5.5],
    ['frost_cairn', 90, 5, 'cryo', 1.0, 4.5],
    ['alchemists_still', 100, 18, 'toxic', 0.6, 6.0],
  ])('%s opens at the authored stats', (id, cost, damage, type, rate, range) => {
    const tier = registry.towers.get(id)?.tiers[0];
    expect(tier).toMatchObject({
      cost,
      damage,
      damageType: type,
      fireRate: rate,
      rangeTiles: range,
    });
  });

  /**
   * The cost curve in §8.1: T1 ×1.0, T2 ×1.6, T3 ×2.6, T4 ×4.5, T5 ×8.0.
   * Gets a tower's whole upgrade path wrong in one number if transcribed by
   * hand, and nothing in play would make that obvious.
   */
  it.each([...registry.towers.keys()].sort())('%s follows the cost curve', (id) => {
    const tower = registry.towers.get(id);
    if (tower === undefined) throw new Error(`${id} missing`);
    const base = tower.tiers[0].cost;

    expect(tower.tiers[1].cost).toBe(Math.round(base * 1.6));
    expect(tower.tiers[2].cost).toBe(Math.round(base * 2.6));
    for (const spec of tower.specialisations) {
      expect(spec.tiers[0].cost, `${id}/${spec.id} tier 4`).toBe(Math.round(base * 4.5));
      expect(spec.tiers[1].cost, `${id}/${spec.id} tier 5`).toBe(Math.round(base * 8.0));
    }
  });

  it('gives every tower two specialisations and a capstone ability each', () => {
    for (const tower of registry.towers.values()) {
      expect(tower.specialisations).toHaveLength(2);
      const ids = tower.specialisations.map((s) => s.id);
      expect(new Set(ids).size, `${tower.id} branches share an id`).toBe(2);
      for (const spec of tower.specialisations) {
        expect(spec.ability.effects.length, `${tower.id}/${spec.id}`).toBeGreaterThan(0);
      }
    }
  });

  /* Mortars must be placed away from the action. Nothing else has a dead zone,
     and it is the whole reason they compete for different plots (§8.3). */
  it('gives the mortar its minimum range and nothing else one', () => {
    for (const tower of registry.towers.values()) {
      const min = tower.tiers[0].minRangeTiles;
      if (tower.id === 'mortar_emplacement') expect(min).toBeGreaterThan(0);
      else expect(min, `${tower.id} has a dead zone`).toBe(0);
    }
  });
});

describe('the coverage audit in §8.6 holds', () => {
  /**
   * *"Every design constraint the enemy roster creates has at least two
   * answers — never exactly one."* A threat with a single answer is a stat
   * check, which pillar P4 exists to forbid. Read from the towers rather than
   * restated, so a balance edit that quietly leaves a threat unanswered fails
   * here.
   */
  const tiersOf = (id: string) => registry.towers.get(id)?.tiers ?? [];
  const towerIds = [...registry.towers.keys()];

  const answersTo = (predicate: (id: string) => boolean): string[] => towerIds.filter(predicate);

  it('answers air with more than one tower', () => {
    const air = answersTo((id) => tiersOf(id).some((t) => t.targets !== 'ground' && t.damage > 0));
    expect(air.length, `only ${air.join(', ')} can hit air`).toBeGreaterThanOrEqual(2);
  });

  /* Arcane ignores armour outright; Corrode eats it. Both are real answers. */
  it('answers high armour with more than one tower', () => {
    const armour = answersTo((id) =>
      tiersOf(id).some((t) => t.damageType === 'arcane' || t.statusApplied?.status === 'corrode'),
    );
    expect(armour.length).toBeGreaterThanOrEqual(2);
  });

  /* Ward is the mirror: kinetic passes through it, and Fracture scales it. */
  it('answers high ward with more than one tower', () => {
    const ward = answersTo((id) =>
      tiersOf(id).some((t) => t.damageType === 'kinetic' && t.damage > 0),
    );
    expect(ward.length).toBeGreaterThanOrEqual(2);
  });

  it('answers swarms with more than one tower', () => {
    const swarm = answersTo((id) =>
      tiersOf(id).some(
        (t) =>
          t.splashRadiusTiles > 0 ||
          t.chainTargets > 0 ||
          t.firingMode === 'aura' ||
          t.firingMode === 'cone',
      ),
    );
    expect(swarm.length).toBeGreaterThanOrEqual(2);
  });

  /* Evasion is dodged only by projectiles, so anything that does not fire one
     is an answer to it. */
  it('answers evasion with more than one tower', () => {
    const unerring = answersTo((id) =>
      tiersOf(id).some(
        (t) =>
          t.damage > 0 &&
          (t.firingMode === 'aura' || t.firingMode === 'cone' || t.firingMode === 'beam'),
      ),
    );
    expect(unerring.length).toBeGreaterThanOrEqual(2);
  });

  it('covers every damage type the reaction matrix needs', () => {
    const applied = new Set<string>();
    for (const tower of registry.towers.values()) {
      for (const tier of tower.tiers) {
        if (tier.statusApplied !== undefined) applied.add(tier.statusApplied.status);
      }
    }
    /* Every status a reaction pairs on must be reachable from a base tower, or
       that reaction can never fire (§4.3). */
    for (const status of ['scorch', 'chill', 'charge', 'corrode', 'unravel']) {
      expect(applied, `nothing applies ${status}`).toContain(status);
    }
  });
});

/**
 * The property the whole data-driven design was paid for.
 *
 * Every stat lives in JSON, the ruleset resolves it into flat tables at load,
 * and no system branches on a tower's identity. If that is true, a ninth tower
 * is a file — and if it has quietly stopped being true, this is the only place
 * anyone would find out.
 *
 * Worth noting what actually happened when the roster went from three towers to
 * eight: `src/sim`, `src/view` and `src/ui` were not touched at all.
 */
describe('a ninth tower needs no code', () => {
  /** A tower unlike anything in the roster, built only from schema fields. */
  function ninthTower(): RawContent {
    const tier = (cost: number, damage: number) => ({
      cost,
      damage,
      damageType: 'toxic',
      fireRate: 2.5,
      rangeTiles: 5.25,
      splashRadiusTiles: 1.75,
      firingMode: 'chain',
      chainTargets: 3,
      chainFalloff: 0.6,
      armourPierce: 7,
      bonusGoldPerKill: 3,
      statusApplied: { status: 'corrode', stacks: 2 },
    });
    const ability = (id: string) => ({
      id,
      nameKey: 'tower.ninth.ability',
      cost: 20,
      cooldownSeconds: 25,
      effects: [{ kind: 'damage_in_radius', params: { radiusTiles: 2, damage: 50 } }],
    });
    const spec = (id: string) => ({
      id,
      nameKey: 'tower.ninth.name',
      descriptionKey: 'tower.ninth.desc',
      tiers: [tier(900, 90), tier(1600, 130)],
      ability: ability(`${id}_ability`),
    });

    return {
      ...raw,
      towers: [
        ...raw.towers,
        {
          path: 'src/content/data/towers/ninth_tower.json',
          data: {
            id: 'ninth_tower',
            nameKey: 'tower.ninth.name',
            descriptionKey: 'tower.ninth.desc',
            family: 'arcane',
            tiers: [tier(200, 20), tier(320, 30), tier(520, 44)],
            specialisations: [spec('ninth_alpha'), spec('ninth_beta')],
            sellRefund: 0.7,
          },
        },
      ],
    };
  }

  const extended = buildRegistry(ninthTower());
  const extendedStage = extended.stages.get('1-1');
  if (extendedStage === undefined) throw new Error('stage 1-1 missing');
  const extendedWorld = (): World => createWorldForStage(extended, extendedStage, 1);

  it('loads without complaint', () => {
    expect(extended.towers.has('ninth_tower')).toBe(true);
  });

  it('resolves into the ruleset like any other tower', () => {
    const w = extendedWorld();
    const idx = towerIndex(w, 'ninth_tower');
    expect(idx).toBeGreaterThanOrEqual(0);

    const stats = idx * TIER_SLOTS;
    expect(w.rules.towers.cost[stats]).toBe(200);
    expect(DAMAGE_BY_INDEX[w.rules.towers.damageType[stats] as number]).toBe('toxic');
    expect(w.rules.towers.firingMode[stats]).toBe(FiringMode.Chain);
    expect(w.rules.towers.chainTargets[stats]).toBe(3);
    /* Content authors tiles; the ruleset is the only place they become pixels. */
    expect(w.rules.towers.range[stats]).toBeCloseTo(5.25 * 64, 4);
  });

  it('appears in the build menu the interface reads', () => {
    const options = buildOptions(extendedWorld());
    expect(options.map((o) => o.id)).toContain('ninth_tower');
  });

  it('stands on a plot and fires, with no system knowing what it is', () => {
    const w = extendedWorld();
    const plot = w.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    const slot = placeTower(w, towerIndex(w, 'ninth_tower'), plot.x, plot.y);
    applyTowerStats(w, slot);
    expect(w.towers.isAlive(slot)).toBe(true);

    /* A tick with it on the board resolves cleanly: nothing branches on an
       identity it has never seen. */
    expect(() => {
      for (let i = 0; i < 120; i++) tick(w);
    }).not.toThrow();
  });

  it('leaves the towers that were already there untouched', () => {
    const before = world();
    const after = extendedWorld();
    for (const id of registry.towers.keys()) {
      const a = before.rules.towers.cost[towerIndex(before, id) * TIER_SLOTS];
      const b = after.rules.towers.cost[towerIndex(after, id) * TIER_SLOTS];
      expect(b, `${id} shifted when a ninth tower was added`).toBe(a);
    }
  });
});
