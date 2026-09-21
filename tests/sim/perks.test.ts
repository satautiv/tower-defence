import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { TOWER_PERKS } from '@content/schema/tower';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  STATUS_INDEX,
  TIER_SLOTS,
  applyStatus,
  applyTowerStats,
  createWorldForStage,
  damageResolutionSystem,
  effectiveDefence,
  enemyIndex,
  firingSystem,
  placeTower,
  setTowerSpecialisation,
  spawnEnemy,
  targetingSystem,
  tierSlot,
  towerIndex,
} from '@sim/index';

/**
 * Tier-4 and tier-5 branch perks (#32, docs/GAME_DESIGN.md §8.2–8.5).
 *
 * The issue's first acceptance criterion is that each branch is *"a
 * meaningfully different strategic choice, not a numerical one"*. That is what
 * this file checks: for each perk, that the mechanic fires, and — where the
 * design says so — that it only fires for a board that earned it.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

/** Builds a tower and takes it straight to a named branch's first rung. */
function branch(world: World, towerId: string, branchIndex: 0 | 1, x = 500, y = 500): number {
  const slot = placeTower(world, towerIndex(world, towerId), x, y);
  if (slot < 0) throw new Error(`could not place ${towerId}`);
  setTowerSpecialisation(world, slot, branchIndex, 0);
  return slot;
}

/** The stat index a branch's first rung occupies. */
const branchStats = (world: World, towerId: string, branchIndex: 0 | 1): number =>
  towerIndex(world, towerId) * TIER_SLOTS + tierSlot(3, branchIndex);

function victim(world: World, x = 500, y = 500, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.hp[slot] = 1_000_000;
  world.enemies.maxHp[slot] = 1_000_000;
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = y;
  return slot;
}

const hpLost = (world: World, slot: number): number =>
  (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

describe('every perk the schema offers is used by a branch', () => {
  /**
   * A perk nobody authors is a mechanic that cannot be balanced, reviewed or
   * removed — it just sits in the enum looking implemented.
   */
  it('leaves no perk unclaimed', () => {
    const claimed = new Set<string>();
    for (const tower of registry.towers.values()) {
      for (const spec of tower.specialisations) {
        for (const tier of spec.tiers) for (const perk of tier.perks) claimed.add(perk);
      }
    }
    expect([...TOWER_PERKS].filter((perk) => !claimed.has(perk))).toEqual([]);
  });

  /** A branch keeps its identity when it is upgraded to its capstone. */
  it('carries each branch perk onto its tier-five rung', () => {
    const world = freshWorld();
    for (const tower of registry.towers.values()) {
      tower.specialisations.forEach((spec, index) => {
        const first = spec.tiers[0].perks;
        const second = spec.tiers[1].perks;
        expect([...second].sort(), `${spec.id} loses its perk at tier 5`).toEqual(
          [...first].sort(),
        );
        expect(index).toBeGreaterThanOrEqual(0);
      });
    }
    expect(world.rules.towers.ids.length).toBeGreaterThan(0);
  });
});

describe('Sniper Nest ignores a share of armour, not a flat amount', () => {
  it('scales with how armoured the target is', () => {
    const world = freshWorld();
    const stats = branchStats(world, 'arbalest_post', 0);
    const fraction = world.rules.towers.pierceFraction[stats] as number;
    expect(fraction).toBeGreaterThan(0);

    const slot = victim(world);
    world.enemies.armour[slot] = 200;

    const plain = effectiveDefence(world, slot, true, 0, 0, 0);
    const sniped = effectiveDefence(world, slot, true, 0, 0, 0, stats);
    expect(sniped).toBeCloseTo(plain * (1 - fraction), 3);
  });

  it('leaves Ward alone, so it is an armour answer and not a universal one', () => {
    const world = freshWorld();
    const stats = branchStats(world, 'arbalest_post', 0);
    const slot = victim(world);
    world.enemies.ward[slot] = 120;

    expect(effectiveDefence(world, slot, false, 0, 0, 0, stats)).toBeCloseTo(
      effectiveDefence(world, slot, false, 0, 0, 0),
      3,
    );
  });
});

describe('Rime Spire sunders what it chills', () => {
  it('removes armour per stack of Chill', () => {
    const world = freshWorld();
    const stats = branchStats(world, 'frost_cairn', 1);
    const per = world.rules.towers.armourPerChillStack[stats] as number;
    expect(per).toBeGreaterThan(0);

    const slot = victim(world);
    world.enemies.armour[slot] = 100;

    const clean = effectiveDefence(world, slot, true, 0, 0, 0, stats);
    applyStatus(world, slot, STATUS_INDEX.chill, 3);
    const chilled = effectiveDefence(world, slot, true, 0, 0, 0, stats);

    expect(clean - chilled).toBeCloseTo(per * 3, 3);
  });

  it('does nothing for a tower without the perk', () => {
    const world = freshWorld();
    const slot = victim(world);
    world.enemies.armour[slot] = 100;
    applyStatus(world, slot, STATUS_INDEX.chill, 3);

    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(100, 3);
  });
});

describe('Pyroclast Vent is paid for pairing, not for firing', () => {
  /**
   * The bonus is against Corrode, which a Pyroclast Vent cannot apply itself —
   * so it is only ever collected by a board that also fields an Alchemist.
   * That is pillar P1 expressed as a number, and it is the reason the branch
   * exists.
   */
  it('hits harder into a status it cannot apply itself', () => {
    const world = freshWorld();
    const stats = branchStats(world, 'flame_vent', 0);
    const towers = world.rules.towers;
    const multiplier = towers.bonusVsStatusMultiplier[stats] as number;
    expect(multiplier).toBeGreaterThan(1);

    /* Whatever it applies on hit must not be what it is rewarded for. */
    expect(towers.bonusVsStatus[stats]).not.toBe(towers.statusId[stats]);

    const deal = (corroded: boolean): number => {
      const w = freshWorld();
      const tower = branch(w, 'flame_vent', 0);
      const slot = victim(w);
      w.enemies.armour[slot] = 0;
      w.enemies.ward[slot] = 0;
      if (corroded) applyStatus(w, slot, STATUS_INDEX.corrode, 1);

      w.damage.push(slot, 100, DAMAGE_INDEX.pyro, tower);
      damageResolutionSystem(w);
      return hpLost(w, slot);
    };

    const plain = deal(false);
    expect(plain).toBeGreaterThan(0);
    expect(deal(true) / plain).toBeCloseTo(multiplier, 2);
  });
});

describe('a corpse can carry a status to its neighbours', () => {
  it('spreads from a Plague Vat kill and not from an ordinary one', () => {
    const spread = (towerId: string, branchIndex: 0 | 1 | null): number => {
      const world = freshWorld();
      const tower =
        branchIndex === null
          ? placeTower(world, towerIndex(world, towerId), 500, 500)
          : branch(world, towerId, branchIndex);

      const dying = victim(world, 500, 500);
      const neighbour = victim(world, 520, 500);
      world.enemies.hp[dying] = 1;

      world.damage.push(dying, 10_000, DAMAGE_INDEX.true, tower, 4);
      targetingSystem(world);
      damageResolutionSystem(world);
      return world.enemies.stacksOf(neighbour, STATUS_INDEX.corrode);
    };

    expect(spread('alchemists_still', 0)).toBeGreaterThan(0);
    expect(spread('alchemists_still', null)).toBe(0);
  });
});

describe('Gilded Alembic pays the whole board', () => {
  it('raises every bounty, not only its own kills', () => {
    const earn = (withAlembic: boolean): number => {
      const world = freshWorld();
      const killer = placeTower(world, towerIndex(world, 'arbalest_post'), 400, 400);
      if (withAlembic) branch(world, 'alchemists_still', 1, 900, 900);

      /* An ordinary Region 1 bounty on purpose. Fifteen percent of six gold
         is under one, and flooring the award used to discard it entirely —
         the branch did nothing in the region it is unlocked in. */
      const slot = victim(world, 500, 500);
      world.enemies.hp[slot] = 1;
      const before = world.resources.gold;

      world.damage.push(slot, 10_000, DAMAGE_INDEX.true, killer, 4);
      damageResolutionSystem(world);
      return world.resources.gold - before;
    };

    const plain = earn(false);
    expect(plain).toBeGreaterThan(0);
    /* The kill was an Arbalest's; the Alembic was nowhere near it. */
    expect(earn(true)).toBeGreaterThan(plain);
  });
});

/**
 * The acceptance criterion the issue calls out by name: *"Prism Tower's
 * refraction correctly detects distinct damage types from towers within 3
 * tiles and adds them to its beams — this is the most pillar P1 tower in the
 * game, it has to work."*
 */
describe('Prism Tower refracts its neighbours', () => {
  function damageWithNeighbours(neighbours: readonly string[]): number {
    const world = freshWorld();
    const prism = branch(world, 'arcane_spire', 1, 500, 500);

    neighbours.forEach((id, i) => {
      /* Well inside the authored three tiles. */
      placeTower(world, towerIndex(world, id), 500 + TILE_SIZE, 500 + i * 8);
    });

    const slot = victim(world, 520, 500);
    world.enemies.armour[slot] = 0;
    world.enemies.ward[slot] = 0;

    targetingSystem(world);
    world.towers.cooldown[prism] = 0;
    firingSystem(world);
    damageResolutionSystem(world);
    /* The prism's own contribution, not the enemy's health bar: the
       neighbours are shooting the same target, and measuring hp lost would
       be measuring them too. */
    return world.towers.damageDealt[prism] as number;
  }

  it('is worth nothing beside no one', () => {
    const alone = damageWithNeighbours([]);
    expect(alone).toBeGreaterThan(0);
  });

  it('counts distinct damage types, not neighbours', () => {
    const alone = damageWithNeighbours([]);
    /* Three Flame Vents are one colour of light. */
    const sameType = damageWithNeighbours(['flame_vent', 'flame_vent', 'flame_vent']);
    expect(sameType).toBeCloseTo(alone * 1.25, 1);
  });

  it('is worth more to a mixed board than to a spammed one', () => {
    const sameType = damageWithNeighbours(['flame_vent', 'flame_vent', 'flame_vent']);
    const mixed = damageWithNeighbours(['flame_vent', 'frost_cairn', 'tesla_coil']);
    expect(mixed).toBeGreaterThan(sameType);
  });

  it('ignores towers beyond its radius', () => {
    const world = freshWorld();
    const stats = branchStats(world, 'arcane_spire', 1);
    const radius = world.rules.towers.refractRadius[stats] as number;
    expect(radius).toBeGreaterThan(0);

    const near = damageWithNeighbours(['frost_cairn']);

    const far = freshWorld();
    const prism = branch(far, 'arcane_spire', 1, 500, 500);
    placeTower(far, towerIndex(far, 'frost_cairn'), 500 + radius * 3, 500);
    const slot = victim(far, 520, 500);
    far.enemies.armour[slot] = 0;
    far.enemies.ward[slot] = 0;
    targetingSystem(far);
    far.towers.cooldown[prism] = 0;
    firingSystem(far);
    damageResolutionSystem(far);

    expect(far.towers.damageDealt[prism] as number).toBeLessThan(near);
  });
});

describe('perks survive the upgrade that should keep them', () => {
  it('still refracts after the capstone upgrade', () => {
    const world = freshWorld();
    const prism = branch(world, 'arcane_spire', 1);
    const table = world.rules.towers;

    const atFour = table.perks[
      towerIndex(world, 'arcane_spire') * TIER_SLOTS + tierSlot(3, 1)
    ] as number;
    world.towers.tier[prism] = 4;
    applyTowerStats(world, prism);
    const atFive = table.perks[
      towerIndex(world, 'arcane_spire') * TIER_SLOTS + tierSlot(4, 1)
    ] as number;

    expect(atFive).toBe(atFour);
    expect(atFive).not.toBe(0);
  });
});
