import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  RejectReason,
  SimEventKind,
  advance,
  buildOptions,
  buildTower,
  canUndo,
  createWorldForStage,
  plotInfo,
  prospectiveRange,
  rangeOf,
  sellTower,
  specialiseTower,
  tick,
  towerIndex,
  towerInfo,
  undoBuild,
  undoSecondsRemaining,
  upgradeTower,
} from '@sim/index';

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

const rejections = (world: World): number[] => {
  const out: number[] = [];
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.CommandRejected) out.push(event.b);
  }
  return out;
};

function build(world: World, id = 'arbalest_post', plotId = 0): number {
  buildTower(world.commands, plotId, towerIndex(world, id));
  tick(world);
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (world.towers.isAlive(slot) && world.towers.plotId[slot] === plotId) return slot;
  }
  return -1;
}

describe('undoing a build', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  /* Full price back, not the sell refund: a misplaced tap on a touchscreen is
     a slip, and charging thirty percent for a slip feels hostile. */
  it('returns the full price, not the sell value', () => {
    const before = world.resources.gold;
    const slot = build(world);
    expect(world.resources.gold).toBeLessThan(before);

    undoBuild(world.commands);
    tick(world);

    expect(world.resources.gold).toBe(before);
    expect(world.towers.isAlive(slot)).toBe(false);
  });

  it('does not count the undone build in the statistics', () => {
    build(world);
    undoBuild(world.commands);
    tick(world);

    expect(world.stats.towersBuilt).toBe(0);
    expect(world.stats.goldSpent).toBe(0);
  });

  it('expires after the authored window', () => {
    build(world);
    advance(world, Math.ceil(registry.tuning.undoWindowSeconds * TICK_HZ) + 2);

    undoBuild(world.commands);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.UndoWindowExpired);
  });

  it('still works at the edge of the window', () => {
    const before = world.resources.gold;
    build(world);
    advance(world, Math.floor(registry.tuning.undoWindowSeconds * TICK_HZ) - 2);

    undoBuild(world.commands);
    tick(world);
    expect(world.resources.gold).toBe(before);
  });

  /* Once upgraded, the thing being undone is not the thing that was built. */
  it('refuses once the tower has been upgraded', () => {
    world.resources.gold = 99_999;
    const slot = build(world);
    upgradeTower(world.commands, slot);
    tick(world);

    undoBuild(world.commands);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.TowerChangedSinceBuild);
    expect(world.towers.isAlive(slot)).toBe(true);
  });

  it('refuses when there is nothing to undo', () => {
    undoBuild(world.commands);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.NothingToUndo);
  });

  it('cannot be used twice', () => {
    build(world);
    undoBuild(world.commands);
    tick(world);

    undoBuild(world.commands);
    tick(world);
    expect(rejections(world)).toContain(RejectReason.NothingToUndo);
  });

  /**
   * Slots are recycled, so an undo after selling and rebuilding must not
   * refund whatever now occupies the slot.
   */
  it('does not refund a different tower that took the recycled slot', () => {
    world.resources.gold = 99_999;
    const first = build(world, 'arbalest_post', 0);
    sellTower(world.commands, first);
    tick(world);

    const second = build(world, 'frost_cairn', 0);
    const gold = world.resources.gold;

    undoBuild(world.commands);
    tick(world);

    /* The second build is itself undoable, so it goes back — the point is the
       refund matches what is standing there. */
    expect(world.resources.gold).toBe(
      gold + (world.rules.towers.cost[towerIndex(world, 'frost_cairn') * 7] as number),
    );
    expect(world.towers.isAlive(second)).toBe(false);
  });

  it('reports the time remaining, counting down', () => {
    build(world);
    const first = undoSecondsRemaining(world);
    advance(world, TICK_HZ);
    expect(undoSecondsRemaining(world)).toBeLessThan(first);
  });

  it('reports zero when nothing is undoable', () => {
    expect(undoSecondsRemaining(world)).toBe(0);
  });
});

describe('what the interface is shown', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('lists every tower with its cost and whether it can be afforded', () => {
    const options = buildOptions(world);
    expect(options.length).toBe(world.rules.towers.ids.length);

    world.resources.gold = 0;
    expect(buildOptions(world).every((option) => !option.affordable)).toBe(true);
  });

  it('reports a tower stats, sell value and upgrade path', () => {
    const slot = build(world);
    const info = towerInfo(world, slot);

    expect(info).not.toBeNull();
    expect(info!.current.dps).toBeGreaterThan(0);
    expect(info!.current.damageType).toBe('kinetic');
    expect(info!.upgrade).not.toBeNull();
    expect(info!.sellValue).toBeGreaterThan(0);
  });

  /* The before-and-after is the whole point of the upgrade panel. */
  it('shows what an upgrade changes', () => {
    const slot = build(world);
    const info = towerInfo(world, slot)!;
    expect(info.upgrade!.after.dps).toBeGreaterThan(info.upgrade!.before.dps);
  });

  it('offers both branches at the branch point, and no upgrade', () => {
    world.resources.gold = 99_999;
    const slot = build(world);
    world.towers.tier[slot] = 2;

    const info = towerInfo(world, slot)!;
    expect(info.specialisations).toHaveLength(2);
    expect(info.upgrade).toBeNull();
  });

  /* The panel showed "Branch 1" and "Branch 2" for every tower on the board,
     because both options carried the *tower's* id rather than the branch's.
     A side-by-side comparison of two things with the same name is a list. */
  it('names each branch as itself, not as the tower', () => {
    world.resources.gold = 99_999;
    const slot = build(world);
    world.towers.tier[slot] = 2;

    const info = towerInfo(world, slot)!;
    const [first, second] = info.specialisations;
    expect(first!.id).not.toBe(info.id);
    expect(second!.id).not.toBe(info.id);
    expect(first!.id).not.toBe(second!.id);
  });

  /* What a branch *does* is the reason to pick it, and it is the half the
     stat rows cannot say — two branches can share a DPS and diverge on it. */
  it("carries each branch's perk descriptions", () => {
    world.resources.gold = 99_999;
    const slot = build(world);
    world.towers.tier[slot] = 2;

    const info = towerInfo(world, slot)!;
    for (const option of info.specialisations) {
      expect(option.perkKeys.length).toBeGreaterThan(0);
    }
  });

  it('offers nothing further at the capstone', () => {
    world.resources.gold = 99_999;
    const slot = build(world);
    world.towers.tier[slot] = 2;
    specialiseTower(world.commands, slot, 0);
    tick(world);
    world.towers.tier[slot] = 4;

    expect(towerInfo(world, slot)!.upgrade).toBeNull();
  });

  it('reports nothing for a tower that is not there', () => {
    expect(towerInfo(world, 99)).toBeNull();
  });

  it('marks which plots are taken, and which carry a ley node', () => {
    const slot = build(world, 'arbalest_post', 2);
    const plots = plotInfo(world);

    expect(plots.find((plot) => plot.id === 2)!.occupiedBy).toBe(slot);
    expect(plots.find((plot) => plot.id === 0)!.occupiedBy).toBe(-1);
    expect(plots.some((plot) => plot.leyNode !== null)).toBe(true);
  });
});

describe('the range preview matches the simulation', () => {
  /**
   * The acceptance criterion. A ring that disagreed with the targeting code
   * would be worse than showing nothing — the player would place towers based
   * on a lie.
   */
  it('reports exactly the radius the tower uses', () => {
    const world = freshWorld();
    const slot = build(world);
    const ring = rangeOf(world, slot);

    expect(ring).not.toBeNull();
    expect(ring!.radius).toBe(world.towers.range[slot]);
    expect(ring!.x).toBe(world.towers.x[slot]);
    expect(ring!.y).toBe(world.towers.y[slot]);
  });

  it('follows an upgrade that changes the reach', () => {
    const world = freshWorld();
    world.resources.gold = 99_999;
    const slot = build(world);
    const before = rangeOf(world, slot)!.radius;

    upgradeTower(world.commands, slot);
    tick(world);
    expect(rangeOf(world, slot)!.radius).toBe(world.towers.range[slot]);
    expect(rangeOf(world, slot)!.radius).toBeGreaterThan(before);
  });

  it('reports the dead zone as well as the reach', () => {
    const world = freshWorld();
    const slot = build(world);
    world.towers.minRange[slot] = 3 * TILE_SIZE;
    expect(rangeOf(world, slot)!.minRadius).toBe(3 * TILE_SIZE);
  });

  it('previews what a tower would reach before it is built', () => {
    const world = freshWorld();
    const typeIdx = towerIndex(world, 'arbalest_post');
    const preview = prospectiveRange(world, typeIdx);

    const slot = build(world);
    expect(preview).toBe(world.towers.range[slot]);
  });

  it('reports nothing for a tower that is not there', () => {
    expect(rangeOf(freshWorld(), 99)).toBeNull();
    expect(prospectiveRange(freshWorld(), 999)).toBe(0);
  });
});

describe('canUndo tracks the one tower it applies to', () => {
  it('is true only for the most recent build', () => {
    const world = freshWorld();
    world.resources.gold = 99_999;
    const first = build(world, 'arbalest_post', 0);
    const second = build(world, 'frost_cairn', 1);

    expect(canUndo(world, second)).toBe(true);
    expect(canUndo(world, first)).toBe(false);
  });
});
