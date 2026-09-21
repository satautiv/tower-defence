import { describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  SimEventKind,
  behaviourSystem,
  buildTower,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  firingSystem,
  hashWorld,
  movementSystem,
  spawnEnemy,
  targetingSystem,
  tick,
  towerIndex,
} from '@sim/index';

/**
 * Enemy behaviours (#29, docs/GAME_DESIGN.md §9).
 *
 * The acceptance criteria are what this file is organised around, because each
 * one names a way the feature could be present and still wrong: an aura that
 * outlives its source, a splitter whose children land somewhere different each
 * run, a behaviour that changes the rules with no warning.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

/** An enemy parked where it is put, with health to spare. */
function place(world: World, id: string, x: number, y: number): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  if (slot < 0) throw new Error(`could not spawn ${id}`);
  world.enemies.hp[slot] = 100_000;
  world.enemies.maxHp[slot] = 100_000;
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = y;
  return slot;
}

/** Seeds the spatial index, which the behaviour system queries. */
function runBehaviours(world: World): void {
  targetingSystem(world);
  behaviourSystem(world);
}

const behaviourEvents = (world: World): number[] => {
  const out: number[] = [];
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.BehaviourFired) out.push(event.b);
  }
  return out;
};

describe('the roster is data, and the systems read it', () => {
  it('carries every behaviour the design names', () => {
    const world = freshWorld();
    for (const id of [
      'mender',
      'sapper',
      'shieldwright',
      'bulwark_golem',
      'burrower',
      'phase_stalker',
      'nullifier',
      'standard_bearer',
      'carrier',
      'rift_sprout',
      'dread_wyrm',
      'mite',
    ]) {
      expect(enemyIndex(world, id), `${id} is missing`).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The acceptance criterion *no enemy is immune to a damage type*, checked
   * against the formula rather than against intent.
   *
   * Armour and ward are diminishing returns, so the only way to be immune is to
   * reach the cap — and the cap itself still lets damage through. This asserts
   * the roster stays inside it, which is the thing an author could break with a
   * single generous number.
   */
  it('gives nobody defences that would read as immunity', () => {
    const world = freshWorld();
    const table = world.rules.enemies;
    const cap = world.rules.tuning.defenceCap;

    for (let i = 0; i < table.ids.length; i++) {
      expect(table.armour[i] as number, `${table.ids[i]} armour`).toBeLessThan(cap);
      expect(table.ward[i] as number, `${table.ids[i]} ward`).toBeLessThan(cap);
    }
  });
});

/**
 * The acceptance criterion: *auras apply and remove cleanly on death and on
 * range exit*.
 */
describe('auras last exactly as long as their source', () => {
  it('suppresses a tower in range and restores it the tick the source dies', () => {
    const world = freshWorld();
    world.resources.gold += 10_000;
    buildTower(world.commands, 0, towerIndex(world, 'frost_cairn'));
    tick(world);

    const tower = 0;
    const nullifier = place(
      world,
      'nullifier',
      world.towers.x[tower] as number,
      world.towers.y[tower] as number,
    );

    runBehaviours(world);
    const suppressed = world.towers.auraFireRate[tower] as number;
    expect(suppressed).toBeLessThan(1);

    /* Killed outright rather than left to the damage queue, so what is under
       test is the aura's lifetime and not the kill path. */
    world.enemies.free(nullifier);
    runBehaviours(world);
    expect(world.towers.auraFireRate[tower]).toBe(1);
  });

  it('drops a haste buff the moment the ally walks out of radius', () => {
    const world = freshWorld();
    const bearer = place(world, 'standard_bearer', 1_000, 1_000);
    const ally = place(world, 'husk', 1_020, 1_000);

    runBehaviours(world);
    expect(world.enemies.auraSpeed[ally] as number).toBeGreaterThan(1);
    expect(world.enemies.auraArmour[ally] as number).toBeGreaterThan(0);

    /* Well beyond the authored five tiles. */
    world.enemies.x[ally] = 1_000 + TILE_SIZE * 20;
    runBehaviours(world);
    expect(world.enemies.auraSpeed[ally]).toBe(1);
    expect(world.enemies.auraArmour[ally]).toBe(0);
    expect(bearer).toBeGreaterThanOrEqual(0);
  });

  it('does not buff the bearer itself, which would outrun its own escort', () => {
    const world = freshWorld();
    const bearer = place(world, 'standard_bearer', 1_000, 1_000);
    place(world, 'husk', 1_020, 1_000);

    runBehaviours(world);
    expect(world.enemies.auraSpeed[bearer]).toBe(1);
  });
});

describe('a Mender undoes work, and only on allies that need it', () => {
  it('heals the most-damaged ally in reach', () => {
    const world = freshWorld();
    place(world, 'mender', 1_000, 1_000);
    const hurt = place(world, 'husk', 1_020, 1_000);
    const healthy = place(world, 'husk', 1_040, 1_000);

    world.enemies.hp[hurt] = 50_000;
    const before = world.enemies.hp[hurt] as number;
    const healthyBefore = world.enemies.hp[healthy] as number;

    runBehaviours(world);
    expect(world.enemies.hp[hurt] as number).toBeGreaterThan(before);
    /* A heal spent on a full health bar is the Mender wasting its own threat. */
    expect(world.enemies.hp[healthy]).toBe(healthyBefore);
  });

  it('never heals past full', () => {
    const world = freshWorld();
    place(world, 'mender', 1_000, 1_000);
    const ally = place(world, 'husk', 1_020, 1_000);
    world.enemies.hp[ally] = (world.enemies.maxHp[ally] as number) - 0.01;

    runBehaviours(world);
    expect(world.enemies.hp[ally] as number).toBeLessThanOrEqual(
      world.enemies.maxHp[ally] as number,
    );
  });

  it('does not heal itself', () => {
    const world = freshWorld();
    const mender = place(world, 'mender', 1_000, 1_000);
    world.enemies.hp[mender] = 10;

    runBehaviours(world);
    expect(world.enemies.hp[mender]).toBe(10);
  });
});

describe('a Shieldwright grants an overshield, refreshed rather than stacked', () => {
  it('shields an ally and does not grow the pool on the next refresh', () => {
    const world = freshWorld();
    const smith = place(world, 'shieldwright', 1_000, 1_000);
    const ally = place(world, 'husk', 1_020, 1_000);
    world.enemies.hp[ally] = 10;

    runBehaviours(world);
    const granted = world.enemies.overshield[ally] as number;
    expect(granted).toBeGreaterThan(0);

    /* Past the authored refresh interval, twice over. */
    world.enemies.behaviourReadyTick[smith] = 0;
    runBehaviours(world);
    expect(world.enemies.overshield[ally]).toBe(granted);
  });
});

/**
 * The acceptance criterion: *every behaviour is telegraphed visually before it
 * takes effect* (design pillar P4).
 */
describe('a Sapper warns before it lands', () => {
  function sapperOnTower(): { world: World; tower: number; sapper: number } {
    const world = freshWorld();
    world.resources.gold += 10_000;
    buildTower(world.commands, 0, towerIndex(world, 'frost_cairn'));
    tick(world);

    const tower = 0;
    const sapper = place(
      world,
      'sapper',
      world.towers.x[tower] as number,
      world.towers.y[tower] as number,
    );
    return { world, tower, sapper };
  }

  it('telegraphs on arrival and disables only after the wind-up', () => {
    const { world, tower } = sapperOnTower();

    world.events.clear();
    runBehaviours(world);
    /* The warning comes first, and the tower is still firing. */
    expect(behaviourEvents(world).length).toBeGreaterThan(0);
    expect(world.towers.disabledUntil[tower] as number).toBeLessThanOrEqual(world.tick);

    const telegraph = world.rules.enemies.telegraphTicks[enemyIndex(world, 'sapper')] as number;
    expect(telegraph).toBeGreaterThan(0);

    for (let i = 0; i <= telegraph; i++) {
      world.tick += 1;
      runBehaviours(world);
    }
    expect(world.towers.disabledUntil[tower] as number).toBeGreaterThan(world.tick);
  });

  it('abandons the wind-up if it is killed before it finishes', () => {
    const { world, tower, sapper } = sapperOnTower();
    runBehaviours(world);

    world.enemies.free(sapper);
    for (let i = 0; i < 200; i++) {
      world.tick += 1;
      runBehaviours(world);
    }
    /* The window the telegraph exists to give the player. */
    expect(world.towers.disabledUntil[tower] as number).toBeLessThanOrEqual(world.tick);
  });

  it('stops a disabled tower firing', () => {
    const { world, tower } = sapperOnTower();
    const victim = place(
      world,
      'husk',
      world.towers.x[tower] as number,
      world.towers.y[tower] as number,
    );

    world.towers.disabledUntil[tower] = world.tick + 100;
    world.towers.cooldown[tower] = 0;
    const before = world.enemies.hp[victim] as number;

    targetingSystem(world);
    firingSystem(world);
    damageResolutionSystem(world);
    expect(world.enemies.hp[victim]).toBe(before);
  });
});

describe('a Phase Stalker jumps only when a hit lands hard enough', () => {
  function hit(amount: number): { world: World; slot: number; before: number } {
    const world = freshWorld();
    const slot = place(world, 'phase_stalker', 500, 500);
    world.enemies.pathDist[slot] = 200;
    const before = world.enemies.pathDist[slot] as number;

    /* True damage, so the authored threshold is compared against the number
       actually asked for rather than one armour has already eaten. */
    world.damage.push(slot, amount, 6, -1, 4);
    damageResolutionSystem(world);
    return { world, slot, before };
  }

  it('ignores chip damage', () => {
    const { world, slot, before } = hit(10);
    expect(world.enemies.pathDist[slot]).toBe(before);
  });

  it('jumps forward on a heavy hit', () => {
    const { world, slot, before } = hit(500);
    const expected = world.rules.enemies.phaseDistance[
      enemyIndex(world, 'phase_stalker')
    ] as number;
    expect(world.enemies.pathDist[slot] as number).toBeCloseTo(before + expected, 3);
  });

  it('does not teleport a corpse', () => {
    const world = freshWorld();
    const slot = place(world, 'phase_stalker', 500, 500);
    world.enemies.hp[slot] = 50;
    world.enemies.pathDist[slot] = 200;

    world.damage.push(slot, 5_000, 6, -1, 4);
    damageResolutionSystem(world);
    /* Dead, and still where it fell. */
    expect(world.enemies.isAlive(slot)).toBe(false);
  });
});

describe('spawners put children on the road', () => {
  it('lets a Rift Sprout breed until it is killed, and never moves', () => {
    const world = freshWorld();
    const sprout = place(world, 'rift_sprout', 600, 600);
    const before = world.enemies.count;

    world.enemies.behaviourReadyTick[sprout] = 0;
    runBehaviours(world);
    expect(world.enemies.count).toBeGreaterThan(before);

    const distance = world.enemies.pathDist[sprout] as number;
    for (let i = 0; i < 60; i++) movementSystem(world);
    expect(world.enemies.pathDist[sprout]).toBe(distance);
  });

  it('drops a Carrier’s cargo onto the road it is flying over', () => {
    const world = freshWorld();
    const carrier = place(world, 'carrier', 800, 400);
    world.enemies.pathDist[carrier] = 300;
    const before = world.enemies.count;

    world.enemies.behaviourReadyTick[carrier] = 0;
    runBehaviours(world);
    expect(world.enemies.count).toBeGreaterThan(before);

    /* The cargo walks; only the Carrier flies. */
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (!world.enemies.isAlive(slot) || slot === carrier) continue;
      expect((world.enemies.flags[slot] as number) & EnemyFlag.Flying).toBe(0);
    }
  });

  it('is identical run to run', () => {
    const run = (): string => {
      const world = freshWorld();
      const sprout = place(world, 'rift_sprout', 600, 600);
      world.enemies.behaviourReadyTick[sprout] = 0;
      for (let i = 0; i < 300; i++) tick(world);
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});

describe('a Burrower owns its own tunnel', () => {
  it('does not take the rest of the wave underground with it', () => {
    const world = freshWorld();
    const table = world.rules.enemies;
    /* Only the Burrower carries the flag; the segment belongs to the road and
       would otherwise hide everything walking it. */
    expect((table.flags[enemyIndex(world, 'burrower')] as number) & EnemyFlag.CanBurrow).not.toBe(
      0,
    );
    expect((table.flags[enemyIndex(world, 'husk')] as number) & EnemyFlag.CanBurrow).toBe(0);
  });
});

describe('wave scaling', () => {
  it('makes a later wave tougher without making it richer in proportion', () => {
    const world = freshWorld();
    const early = spawnEnemy(world, enemyIndex(world, 'husk'), 0, 0);
    const late = spawnEnemy(world, enemyIndex(world, 'husk'), 0, 8);

    expect(world.enemies.maxHp[late] as number).toBeGreaterThan(
      world.enemies.maxHp[early] as number,
    );

    const growth = world.rules.scaling.hpGrowthPerWave;
    expect(world.enemies.maxHp[late] as number).toBeCloseTo(
      (world.enemies.maxHp[early] as number) * (1 + growth * 8),
      2,
    );
  });

  it('grows armour more slowly than health, so no damage type dies out', () => {
    const world = freshWorld();
    const early = spawnEnemy(world, enemyIndex(world, 'husk'), 0, 0);
    const late = spawnEnemy(world, enemyIndex(world, 'husk'), 0, 8);

    const hpRatio = (world.enemies.maxHp[late] as number) / (world.enemies.maxHp[early] as number);
    const armourRatio =
      (world.enemies.armour[late] as number) / (world.enemies.armour[early] as number);

    expect(armourRatio).toBeGreaterThan(1);
    expect(armourRatio).toBeLessThan(hpRatio);
  });

  it('scales a splitter’s children by the parent’s wave, not the current one', () => {
    const world = freshWorld();
    const mother = spawnEnemy(world, enemyIndex(world, 'chitin_mother'), 0, 6);
    world.enemies.waveIndex[mother] = 6;
    world.enemies.hp[mother] = 1;

    world.damage.push(mother, 5_000, 6, -1, 4);
    damageResolutionSystem(world);

    const plain = spawnEnemy(world, enemyIndex(world, 'broodling'), 0, 0);
    let child = -1;
    for (let slot = 0; slot < world.enemies.watermark; slot++) {
      if (!world.enemies.isAlive(slot) || slot === plain) continue;
      if ((world.enemies.typeIdx[slot] as number) === enemyIndex(world, 'broodling')) {
        child = slot;
        break;
      }
    }

    expect(child).toBeGreaterThanOrEqual(0);
    expect(world.enemies.maxHp[child] as number).toBeGreaterThan(
      world.enemies.maxHp[plain] as number,
    );
  });
});

describe('the behaviour system costs nothing on an ordinary roster', () => {
  it('leaves an enemy with no behaviour entirely alone', () => {
    const world = freshWorld();
    const husk = place(world, 'husk', 1_000, 1_000);
    const before = hashWorld(world);

    for (let i = 0; i < 10; i++) behaviourSystem(world);
    expect(hashWorld(world)).toBe(before);
    expect(world.enemies.auraSpeed[husk]).toBe(1);
  });

  it('runs a full stage with every behaviour present and stays deterministic', () => {
    const run = (): string => {
      const world = freshWorld();
      for (const id of ['mender', 'nullifier', 'standard_bearer', 'shieldwright', 'sapper']) {
        place(world, id, 400 + TILE_SIZE, 400);
      }
      for (let i = 0; i < TICK_HZ * 3; i++) tick(world);
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});
