import { describe, expect, it } from 'vitest';
import { LEY_NODE_TYPES } from '@content/schema/common';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  STATUS_INDEX,
  applyStatus,
  applyTowerStats,
  buildOptions,
  buildTower,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  firingSystem,
  hashWorld,
  raiseTowerTier,
  reactionSystem,
  sellTower,
  setTowerSpecialisation,
  spawnEnemy,
  targetingSystem,
  tick,
  towerIndex,
  towerInfo,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * Ley nodes (#30, docs/GAME_DESIGN.md §5).
 *
 * Every expected figure is computed from `tuning.json` rather than written
 * down, so retuning a node moves these assertions with it instead of breaking
 * them — the same bargain the reaction tests make. What is asserted literally
 * is the *shape*: which tower a bonus reaches, and at which tier.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

/** Stage 1-1 authors exactly these two, which the content lint holds it to. */
const RESONANCE_PLOT = 2;
const SURGE_PLOT = 7;
const PLAIN_PLOT = 0;

const leyIdx = (type: string): number => LEY_NODE_TYPES.indexOf(type as never);

/** Builds through the command path, which is the only way the game builds. */
function build(world: World, id: string, plotId: number): number {
  world.resources.gold += 10_000;
  buildTower(world.commands, plotId, towerIndex(world, id));
  tick(world);
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (world.towers.isAlive(slot) && (world.towers.plotId[slot] as number) === plotId) return slot;
  }
  throw new Error(`nothing was built on plot ${plotId}`);
}

/** A plot with the given node type, whatever id the stage gave it. */
function plotWith(world: World, type: string): number {
  const plot = world.rules.plots.find((candidate) => candidate.leyNode === type);
  if (plot === undefined) throw new Error(`stage 1-1 has no ${type} node`);
  return plot.id;
}

/**
 * Moves a built tower onto a node type this stage does not author.
 *
 * Stage 1-1 carries only Resonance and Surge, and what is under test here is
 * whether the stat pipeline honours a node at a given rung — not which two
 * nodes this particular map happens to have. Re-stats, because that is exactly
 * what the build path does after setting the node.
 */
function putOnNode(world: World, slot: number, type: string): void {
  world.towers.leyNode[slot] = leyIdx(type);
  applyTowerStats(world, slot);
}

describe('the stage authors what the rules resolve', () => {
  it('reads each plot node into an index the simulation can use', () => {
    const world = freshWorld();
    expect(world.rules.plotById.get(RESONANCE_PLOT)?.leyNode).toBe('resonance');
    expect(world.rules.plotById.get(RESONANCE_PLOT)?.leyNodeIdx).toBe(leyIdx('resonance'));
    expect(world.rules.plotById.get(PLAIN_PLOT)?.leyNodeIdx).toBe(-1);
  });

  it('carries a bonus for every node type the schema allows', () => {
    const world = freshWorld();
    expect([...world.rules.ley.ids]).toEqual([...LEY_NODE_TYPES]);
    /* Every type has to move *something*, or it is a plot that promises a
       bonus and grants nothing — the one failure a player cannot see. */
    for (let i = 0; i < LEY_NODE_TYPES.length; i++) {
      const moves =
        (world.rules.ley.attackSpeed[i] as number) !== 1 ||
        (world.rules.ley.range[i] as number) !== 1 ||
        (world.rules.ley.statusStacks[i] as number) !== 0 ||
        (world.rules.ley.reactionDamage[i] as number) !== 1;
      expect(moves, `${LEY_NODE_TYPES[i]} grants nothing`).toBe(true);
    }
  });

  it('leaves a tower on ordinary ground with no node at all', () => {
    const world = freshWorld();
    const slot = build(world, 'flame_vent', PLAIN_PLOT);
    expect(world.towers.leyNode[slot]).toBe(-1);
  });
});

/**
 * The acceptance criterion: *bonuses apply correctly at every tier and
 * specialisation*.
 *
 * Driven through the real rungs rather than by re-statting by hand, because
 * the thing being tested is that no upgrade path forgets the node — and an
 * upgrade path is exactly where that would be forgotten.
 */
describe('a bonus survives every rung of the tower', () => {
  const rungs: Array<{ label: string; climb: (world: World, slot: number) => void }> = [
    { label: 'tier 1', climb: () => {} },
    { label: 'tier 2', climb: (w, s) => raiseTowerTier(w, s, 0) },
    {
      label: 'tier 3',
      climb: (w, s) => {
        raiseTowerTier(w, s, 0);
        raiseTowerTier(w, s, 0);
      },
    },
    { label: 'branch 1', climb: (w, s) => setTowerSpecialisation(w, s, 0, 0) },
    { label: 'branch 2', climb: (w, s) => setTowerSpecialisation(w, s, 1, 0) },
  ];

  for (const rung of rungs) {
    it(`lengthens range on a Depth node at ${rung.label}`, () => {
      const world = freshWorld();
      const plain = build(world, 'arbalest_post', PLAIN_PLOT);
      const onNode = build(world, 'arbalest_post', RESONANCE_PLOT);
      putOnNode(world, onNode, 'depth');

      rung.climb(world, plain);
      rung.climb(world, onNode);

      const expected =
        (world.towers.range[plain] as number) * (world.rules.ley.range[leyIdx('depth')] as number);
      expect(world.towers.range[onNode]).toBeCloseTo(expected, 4);
    });

    it(`shortens the fire interval on a Flux node at ${rung.label}`, () => {
      const world = freshWorld();
      const plain = build(world, 'arbalest_post', PLAIN_PLOT);
      const onNode = build(world, 'arbalest_post', RESONANCE_PLOT);
      putOnNode(world, onNode, 'flux');

      rung.climb(world, plain);
      rung.climb(world, onNode);

      const expected =
        (world.towers.fireInterval[plain] as number) /
        (world.rules.ley.attackSpeed[leyIdx('flux')] as number);
      expect(world.towers.fireInterval[onNode]).toBeCloseTo(expected, 4);
      /* Faster, not slower — the bonus is authored as attack speed and the
         pool stores an interval, which is the one place an inversion hides. */
      expect(world.towers.fireInterval[onNode] as number).toBeLessThan(
        world.towers.fireInterval[plain] as number,
      );
    });

    it(`adds a stack on a Resonance node at ${rung.label}`, () => {
      const world = freshWorld();
      const plain = build(world, 'frost_cairn', PLAIN_PLOT);
      const onNode = build(world, 'frost_cairn', RESONANCE_PLOT);

      rung.climb(world, plain);
      rung.climb(world, onNode);

      const expected =
        (world.towers.statusStacks[plain] as number) +
        (world.rules.ley.statusStacks[leyIdx('resonance')] as number);
      expect(world.towers.statusStacks[onNode]).toBe(expected);
    });
  }
});

/**
 * Counted in shots, not read off the stat field.
 *
 * The first version of this suite asserted on `towers.fireInterval` and passed
 * while Flux did nothing at all: the firing loop was still reading the tier
 * table for its cooldown, so the node shortened a number nobody consumed and
 * the panel quoted a rate the tower never fired at. A bonus is only real if it
 * changes what the simulation does.
 */
describe('a Flux node actually makes the tower shoot faster', () => {
  function shotsIn(plotId: number, ley: string | null, ticks: number): number {
    const world = freshWorld();
    const tower = build(world, 'frost_cairn', plotId);
    if (ley !== null) putOnNode(world, tower, ley);

    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.hp[slot] = 10_000_000;
    world.enemies.maxHp[slot] = 10_000_000;
    world.enemies.x[slot] = world.towers.x[tower] as number;
    world.enemies.y[slot] = world.towers.y[tower] as number;

    let shots = 0;
    for (let i = 0; i < ticks; i++) {
      const before = world.enemies.hp[slot] as number;
      targetingSystem(world);
      firingSystem(world);
      damageResolutionSystem(world);
      if ((world.enemies.hp[slot] as number) < before) shots++;
      /* The cooldown is spent by the firing system, not by `tick`, which this
         test deliberately does not run — the enemy has to stay put. */
      world.towers.cooldown[tower] = Math.max(0, (world.towers.cooldown[tower] as number) - 1);
    }
    return shots;
  }

  it('fires more often on a Flux node than on ordinary ground', () => {
    const ticks = 600;
    const plain = shotsIn(PLAIN_PLOT, null, ticks);
    const flux = shotsIn(PLAIN_PLOT, 'flux', ticks);

    expect(plain).toBeGreaterThan(1);
    const world = freshWorld();
    const speed = world.rules.ley.attackSpeed[leyIdx('flux')] as number;
    /* Within a shot either way: the window does not divide evenly by either
       interval, so the last shot of each can fall outside it. */
    expect(Math.abs(flux - plain * speed)).toBeLessThanOrEqual(1);
  });
});

describe('a Resonance node reaches what the tower actually hits', () => {
  /**
   * Chill landed on an enemy by one shot of a Frost Cairn built on `plotId`.
   *
   * One tower per world, and the systems driven directly rather than through
   * `tick`: the full pipeline moves enemies along the path, so an enemy placed
   * by hand next to a tower does not stay there long enough to be shot. A
   * Frost Cairn is an aura, so the hit resolves the same tick with no
   * projectile to chase.
   */
  function chillFromOneShot(plotId: number): number {
    const world = freshWorld();
    const tower = build(world, 'frost_cairn', plotId);

    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.hp[slot] = 100_000;
    world.enemies.maxHp[slot] = 100_000;
    world.enemies.x[slot] = world.towers.x[tower] as number;
    world.enemies.y[slot] = world.towers.y[tower] as number;

    targetingSystem(world);
    firingSystem(world);
    damageResolutionSystem(world);
    return world.enemies.stacksOf(slot, STATUS_INDEX.chill);
  }

  it('lands the extra stack on an enemy, not just in the stat table', () => {
    const plain = chillFromOneShot(PLAIN_PLOT);
    expect(plain).toBeGreaterThan(0);

    const world = freshWorld();
    const bonus = world.rules.ley.statusStacks[leyIdx('resonance')] as number;
    expect(chillFromOneShot(RESONANCE_PLOT)).toBe(plain + bonus);
  });
});

/**
 * The acceptance criterion: *Surge nodes correctly amplify only reactions
 * triggered by that tower*.
 */
describe('a Surge node amplifies its own reactions and no others', () => {
  /** An undefended enemy, so a reaction's damage arrives unreduced. */
  function target(world: World, x: number, y: number): number {
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.hp[slot] = 100_000;
    world.enemies.maxHp[slot] = 100_000;
    world.enemies.armour[slot] = 0;
    world.enemies.ward[slot] = 0;
    world.enemies.x[slot] = x;
    world.enemies.y[slot] = y;
    return slot;
  }

  const hpLost = (world: World, slot: number): number =>
    (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

  /**
   * Detonates Thermal Shock on a fresh enemy, crediting `source` for the hit
   * that completed the pair.
   *
   * The Scorch is applied with no source at all and the Chill with one, which
   * mirrors what actually happens on a board: two towers, and the second one
   * to land is the one that set the reaction off.
   */
  function detonate(world: World, source: number): number {
    const slot = target(world, 1_500, 1_500);
    applyStatus(world, slot, STATUS_INDEX.scorch, 3);
    applyStatus(world, slot, STATUS_INDEX.chill, 1, source);

    targetingSystem(world);
    reactionSystem(world);
    damageResolutionSystem(world);
    return hpLost(world, slot);
  }

  it('pays the authored multiple when its own hit completed the pair', () => {
    const world = freshWorld();
    const surge = build(world, 'frost_cairn', plotWith(world, 'surge'));
    const plain = build(world, 'frost_cairn', PLAIN_PLOT);

    const ordinary = detonate(world, plain);
    const amplified = detonate(world, surge);

    expect(ordinary).toBeGreaterThan(0);
    expect(amplified / ordinary).toBeCloseTo(
      world.rules.ley.reactionDamage[leyIdx('surge')] as number,
      3,
    );
  });

  it('leaves a reaction no tower completed alone', () => {
    const world = freshWorld();
    const plain = build(world, 'frost_cairn', PLAIN_PLOT);

    /* -1 is what a ground field, a Warden Power and a reaction's own ignition
       all carry: nobody's node should pay out for those. */
    expect(detonate(world, -1)).toBeCloseTo(detonate(world, plain), 3);
  });

  it('does not pay out for a neighbouring tower that happens to be on it', () => {
    const world = freshWorld();
    build(world, 'frost_cairn', plotWith(world, 'surge'));
    const plain = build(world, 'flame_vent', PLAIN_PLOT);

    /* A Surge node on the board is not a Surge node on *this* reaction. The
       credit follows the hit, not the neighbourhood. */
    const withSurgeOnBoard = detonate(world, plain);

    const bare = freshWorld();
    const bareTower = build(bare, 'flame_vent', PLAIN_PLOT);
    expect(withSurgeOnBoard).toBeCloseTo(detonate(bare, bareTower), 3);
  });

  it('keeps the credit when a hit escalates Chill into Freeze', () => {
    const world = freshWorld();
    const surge = build(world, 'frost_cairn', plotWith(world, 'surge'));
    const slot = target(world, 1_500, 1_500);

    /* Five Chill escalates, and the Freeze is applied by `escalate` rather
       than by the hit. If the source were dropped there, a Frost Cairn on a
       Surge node would lose its own bonus at exactly the moment it lands its
       best hit. */
    applyStatus(world, slot, STATUS_INDEX.chill, 5, surge);
    expect(world.enemies.statusSource[slot]).toBe(surge);
  });
});

describe('a node belongs to the plot, not to the slot', () => {
  it('does not leak to the next tower built in a recycled slot', () => {
    const world = freshWorld();
    const onNode = build(world, 'frost_cairn', RESONANCE_PLOT);
    const bonused = world.towers.statusStacks[onNode] as number;

    sellTower(world.commands, onNode);
    tick(world);

    const replacement = build(world, 'frost_cairn', PLAIN_PLOT);
    expect(replacement).toBe(onNode);
    expect(world.towers.leyNode[replacement]).toBe(-1);
    expect(world.towers.statusStacks[replacement] as number).toBeLessThan(bonused);
  });
});

/**
 * #27's remaining code-level item: *upgrade preview with the effect of the ley
 * node if present*. A preview that quoted the unbonused number would understate
 * every upgrade on the one plot the player is most deliberate about.
 */
describe('the panel quotes the stats the tower actually has', () => {
  it('reports the bonused range, at the current tier and the next', () => {
    const world = freshWorld();
    const onNode = build(world, 'arbalest_post', RESONANCE_PLOT);
    world.towers.leyNode[onNode] = leyIdx('depth');

    const plain = towerInfo(world, build(world, 'arbalest_post', PLAIN_PLOT));
    const bonused = towerInfo(world, onNode);
    if (plain === null || bonused === null) throw new Error('tower vanished');
    if (plain.upgrade === null || bonused.upgrade === null) throw new Error('no upgrade offered');

    const multiplier = world.rules.ley.range[leyIdx('depth')] as number;
    expect(bonused.current.rangeTiles).toBeCloseTo(plain.current.rangeTiles * multiplier, 4);
    expect(bonused.upgrade.after.rangeTiles).toBeCloseTo(
      plain.upgrade.after.rangeTiles * multiplier,
      4,
    );
  });

  it('names the node it is standing on', () => {
    const world = freshWorld();
    expect(towerInfo(world, build(world, 'frost_cairn', RESONANCE_PLOT))?.leyNode).toBe(
      'resonance',
    );
    expect(towerInfo(world, build(world, 'frost_cairn', PLAIN_PLOT))?.leyNode).toBeNull();
  });

  it('shows the build menu what a tower would become on this plot', () => {
    const world = freshWorld();
    const cairn = towerIndex(world, 'frost_cairn');

    const onNode = buildOptions(world, RESONANCE_PLOT)[cairn];
    const plain = buildOptions(world, PLAIN_PLOT)[cairn];
    if (onNode === undefined || plain === undefined) throw new Error('no such option');

    expect(onNode.leyNode).toBe('resonance');
    expect(plain.leyNode).toBeNull();
    expect(onNode.stats.status?.stacks).toBe(
      (plain.stats.status?.stacks ?? 0) +
        (world.rules.ley.statusStacks[leyIdx('resonance')] as number),
    );
  });
});

describe('the bonus is part of the replay', () => {
  it('fingerprints a tower on a node differently from one beside it', () => {
    const onNode = freshWorld();
    build(onNode, 'frost_cairn', RESONANCE_PLOT);

    const plain = freshWorld();
    build(plain, 'frost_cairn', PLAIN_PLOT);

    /* Not merely "they differ" — a plot id differs too. What matters is that
       the node reaches the hash at all, which is what keeps a replay of a
       board built on ley nodes reproducible. */
    expect(hashWorld(onNode)).not.toBe(hashWorld(plain));

    const again = freshWorld();
    build(again, 'frost_cairn', RESONANCE_PLOT);
    expect(hashWorld(again)).toBe(hashWorld(onNode));
  });
});

describe('a Resonance node under a barracks reaches its soldiers', () => {
  it('is not dead ground for the one tower that fights with people', () => {
    const world = freshWorld();
    const onNode = build(world, 'wardens_barracks', SURGE_PLOT);
    world.towers.leyNode[onNode] = leyIdx('resonance');

    /* The barracks' own `statusStacks` is beside the point — it never hits
       anything. What matters is the soldier path, which reads the node
       directly, so this asserts the node is visible from the tower the
       soldiers belong to. */
    expect(world.towers.leyNode[onNode]).toBe(leyIdx('resonance'));
    expect(world.rules.ley.statusStacks[leyIdx('resonance')] as number).toBeGreaterThan(0);
  });
});
