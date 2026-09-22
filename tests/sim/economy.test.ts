import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  RejectReason,
  SimEventKind,
  StagePhase,
  addAether,
  addGold,
  advance,
  buildCost,
  buildTower,
  canAfford,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  sellTower,
  sellValue,
  setTargetMode,
  specialiseCost,
  specialiseTower,
  spawnEnemy,
  spendAether,
  spendGold,
  startWave,
  tick,
  towerIndex,
  upgradeCost,
  upgradeTower,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');
const tuning = registry.tuning;

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

const rejections = (world: World): number[] => {
  const out: number[] = [];
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.CommandRejected) out.push(event.b);
  }
  return out;
};

/** Builds through the command path, which is the only way the game builds. */
function build(world: World, id: string, plotId = 0): number {
  buildTower(world.commands, plotId, towerIndex(world, id));
  tick(world);
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (world.towers.isAlive(slot) && world.towers.plotId[slot] === plotId) return slot;
  }
  return -1;
}

describe('money cannot go out of bounds', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('refuses to spend gold that is not there', () => {
    world.resources.gold = 50;
    expect(spendGold(world, 80)).toBe(false);
    expect(world.resources.gold).toBe(50);
  });

  it('spends exactly when affordable', () => {
    world.resources.gold = 100;
    expect(spendGold(world, 100)).toBe(true);
    expect(world.resources.gold).toBe(0);
  });

  it('never lets gold go negative, however many failed purchases', () => {
    world.resources.gold = 10;
    for (let i = 0; i < 100; i++) spendGold(world, 1000);
    expect(world.resources.gold).toBe(10);
  });

  it('caps Aether at its ceiling', () => {
    addAether(world, tuning.aetherMax * 10);
    expect(world.resources.aether).toBe(tuning.aetherMax);
  });

  it('never lets Aether go negative', () => {
    world.resources.aether = 5;
    expect(spendAether(world, 40)).toBe(false);
    expect(world.resources.aether).toBe(5);
  });

  it('ignores negative additions rather than draining the balance', () => {
    world.resources.gold = 100;
    addGold(world, -500);
    addAether(world, -500);
    expect(world.resources.gold).toBe(100);
    expect(world.resources.aether).toBe(0);
  });

  it('reports affordability without spending', () => {
    world.resources.gold = 100;
    expect(canAfford(world, 100)).toBe(true);
    expect(canAfford(world, 101)).toBe(false);
    expect(world.resources.gold).toBe(100);
  });
});

describe('Aether charges from three sources', () => {
  it('trickles in while the stage runs', () => {
    const world = freshWorld();
    startWave(world, 0);
    advance(world, TICK_HZ);
    expect(world.resources.aether).toBeCloseTo(tuning.aetherPerSecond, 3);
  });

  /* Charging during the build phase would reward standing still. */
  it('does not trickle during the build phase', () => {
    const world = freshWorld();
    expect(world.phase).toBe(StagePhase.Building);
    advance(world, 30);
    expect(world.resources.aether).toBe(0);
  });

  it('charges on a kill', () => {
    const world = freshWorld();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.damage.push(slot, 10_000, DAMAGE_INDEX.true, -1);
    damageResolutionSystem(world);
    expect(world.resources.aether).toBeCloseTo(tuning.aetherPerKill, 4);
  });
});

describe('costs come from content', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('charges the authored tier-one price to build', () => {
    const authored = registry.towers.get('arbalest_post')!.tiers[0].cost;
    expect(buildCost(world, towerIndex(world, 'arbalest_post'))).toBe(authored);
  });

  it('charges the authored price for each upgrade', () => {
    const tower = build(world, 'arbalest_post');
    const tiers = registry.towers.get('arbalest_post')!.tiers;

    expect(upgradeCost(world, tower)).toBe(tiers[1].cost);
    world.resources.gold = 99_999;
    upgradeTower(world.commands, tower);
    tick(world);
    expect(upgradeCost(world, tower)).toBe(tiers[2].cost);
  });

  /* Tier two is the end of the base path: the next step is a branch, not an
     upgrade, which is the decision the whole tower design turns on. */
  it('refuses to upgrade past tier two without a branch', () => {
    const tower = build(world, 'arbalest_post');
    world.resources.gold = 99_999;
    world.towers.tier[tower] = 2;

    expect(upgradeCost(world, tower)).toBe(-1);
    upgradeTower(world.commands, tower);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.MustSpecialise);
  });

  it('charges the branch price to specialise', () => {
    const tower = build(world, 'arbalest_post');
    world.towers.tier[tower] = 2;
    const branches = registry.towers.get('arbalest_post')!.specialisations;

    expect(specialiseCost(world, tower, 0)).toBe(branches[0].tiers[0].cost);
    expect(specialiseCost(world, tower, 1)).toBe(branches[1].tiers[0].cost);
  });

  it('refuses to specialise a tower that is not ready', () => {
    const tower = build(world, 'arbalest_post');
    expect(specialiseCost(world, tower, 0)).toBe(-1);
  });

  it('has nothing left to sell once at the capstone', () => {
    const tower = build(world, 'arbalest_post');
    world.towers.specialisation[tower] = 0;
    world.towers.tier[tower] = 4;
    expect(upgradeCost(world, tower)).toBe(-1);
  });
});

describe('building through the command path', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('places a tower on the plot and charges for it', () => {
    const gold = world.resources.gold;
    const cost = buildCost(world, towerIndex(world, 'arbalest_post'));
    const tower = build(world, 'arbalest_post', 3);

    expect(tower).toBeGreaterThanOrEqual(0);
    expect(world.resources.gold).toBe(gold - cost);
    expect(world.towers.plotId[tower]).toBe(3);
  });

  it('puts the tower at the plot position, not the origin', () => {
    const tower = build(world, 'arbalest_post', 5);
    const plot = world.rules.plots.find((p) => p.id === 5)!;
    expect(world.towers.x[tower]).toBeCloseTo(plot.x, 4);
    expect(world.towers.y[tower]).toBeCloseTo(plot.y, 4);
  });

  it('refuses a plot that already has a tower, without charging', () => {
    build(world, 'arbalest_post', 2);
    const gold = world.resources.gold;

    buildTower(world.commands, 2, towerIndex(world, 'arbalest_post'));
    tick(world);

    expect(world.resources.gold).toBe(gold);
    expect(rejections(world)).toContain(RejectReason.PlotOccupied);
  });

  it('refuses a plot that does not exist', () => {
    buildTower(world.commands, 999, towerIndex(world, 'arbalest_post'));
    tick(world);
    expect(rejections(world)).toContain(RejectReason.NoSuchPlot);
  });

  /* A refusal must leave no gold spent and no half-built tower. */
  it('refuses when short of gold, spending nothing', () => {
    world.resources.gold = 5;
    buildTower(world.commands, 0, towerIndex(world, 'arbalest_post'));
    tick(world);

    expect(world.resources.gold).toBe(5);
    expect(world.towers.count).toBe(0);
    expect(rejections(world)).toContain(RejectReason.Unaffordable);
  });
});

describe('selling', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    world.resources.gold = 99_999;
  });

  it('returns the authored fraction of everything invested', () => {
    const tower = build(world, 'arbalest_post');
    const invested = world.towers.invested[tower] as number;
    const fraction = registry.towers.get('arbalest_post')!.sellRefund;

    expect(sellValue(world, tower)).toBe(Math.floor(invested * fraction));
  });

  /* Of everything sunk in, not of the last upgrade — which is what makes a
     mid-stage pivot viable but never free. */
  it('counts upgrades in the refund', () => {
    const tower = build(world, 'arbalest_post');
    const afterBuild = sellValue(world, tower);

    upgradeTower(world.commands, tower);
    tick(world);
    expect(sellValue(world, tower)).toBeGreaterThan(afterBuild);
  });

  it('counts a specialisation in the refund', () => {
    const tower = build(world, 'arbalest_post');
    world.towers.tier[tower] = 2;
    const beforeBranch = sellValue(world, tower);

    specialiseTower(world.commands, tower, 0);
    tick(world);
    expect(sellValue(world, tower)).toBeGreaterThan(beforeBranch);
  });

  /* Re-specialising costs the full price again with no refund, so changing
     your mind is possible but never free. */
  it('counts a re-specialisation, which is paid for twice', () => {
    const tower = build(world, 'arbalest_post');
    world.towers.tier[tower] = 2;

    specialiseTower(world.commands, tower, 0);
    tick(world);
    const afterFirst = world.towers.invested[tower] as number;

    specialiseTower(world.commands, tower, 1);
    tick(world);

    expect(world.towers.invested[tower]).toBeGreaterThan(afterFirst);
    expect(world.towers.specialisation[tower]).toBe(1);
    expect(world.towers.tier[tower]).toBe(3);
  });

  it('pays out and removes the tower', () => {
    const tower = build(world, 'arbalest_post');
    const value = sellValue(world, tower);
    const gold = world.resources.gold;

    sellTower(world.commands, tower);
    tick(world);

    expect(world.resources.gold).toBe(gold + value);
    expect(world.towers.isAlive(tower)).toBe(false);
  });

  it('refuses to sell nothing', () => {
    sellTower(world.commands, 42);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.NoSuchTower);
  });
});

describe('targeting mode is a command', () => {
  it('is applied and forces a re-pick', () => {
    const world = freshWorld();
    const tower = build(world, 'arbalest_post');

    setTargetMode(world.commands, tower, 3);
    tick(world);

    expect(world.towers.targetMode[tower]).toBe(3);
  });
});

describe('the gold curve is reproducible', () => {
  /* Same seed, same commands, same money at every step — otherwise the balance
     simulator's numbers would mean nothing. */
  it('produces an identical curve from the same seed', () => {
    const run = (): number[] => {
      const world = freshWorld(4242);
      const curve: number[] = [];
      for (let t = 0; t < 1500; t++) {
        if (t === 10) buildTower(world.commands, 0, towerIndex(world, 'arbalest_post'));
        if (t === 400) buildTower(world.commands, 1, towerIndex(world, 'frost_cairn'));
        tick(world);
        if (t % 100 === 0)
          curve.push(world.resources.gold, Math.round(world.resources.aether * 100));
      }
      return curve;
    };
    expect(run()).toEqual(run());
  });
});

describe('a stage reset returns both currencies', () => {
  it('restores starting gold and empties Aether', () => {
    const world = freshWorld();
    world.resources.gold = 3;
    world.resources.aether = 88;

    world.reset();
    expect(world.resources.gold).toBe(stage.startingGold);
    expect(world.resources.aether).toBe(0);
  });
});
