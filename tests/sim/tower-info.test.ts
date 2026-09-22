import { describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  TargetMode,
  advance,
  applyTowerStats,
  buildTower,
  createWorldForStage,
  enemyIndex,
  pickTarget,
  placeTower,
  setTargetMode,
  spawnEnemy,
  targetingSystem,
  tick,
  towerIndex,
  towerInfo,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * What the tower panel reads (#27, design pillar P2: readable depth).
 *
 * The acceptance criterion worth the most here is that **displayed DPS matches
 * the damage actually dealt**. A panel that quotes a number the game does not
 * honour is worse than no panel: it teaches the player something false and
 * they will build around it.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

function pointAt(world: World, pathDistance: number): { x: number; y: number } {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);
  return { x: sample.x, y: sample.y };
}

/** An enemy pinned in place so a measurement is not chasing it. */
function dummy(world: World, pathDistance: number): number {
  const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
  const at = pointAt(world, pathDistance);
  world.enemies.pathDist[slot] = pathDistance;
  world.enemies.x[slot] = at.x;
  world.enemies.y[slot] = at.y;
  world.enemies.hp[slot] = 10_000_000;
  world.enemies.maxHp[slot] = 10_000_000;
  /* No defences, so the quoted DPS and the dealt damage are the same number
     rather than the same number through the armour formula. */
  world.enemies.armour[slot] = 0;
  world.enemies.ward[slot] = 0;
  world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Blocked;
  return slot;
}

describe('the DPS the panel quotes is the damage it deals', () => {
  /**
   * The acceptance criterion, measured rather than asserted: a tower is stood
   * next to a target it cannot kill, left to fire for ten seconds, and what it
   * actually did is compared against what the panel said it would.
   */
  it.each(['arbalest_post', 'tesla_coil'])('holds for %s', (towerId) => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    const enemy = dummy(world, 400);

    const tower = placeTower(world, towerIndex(world, towerId), at.x, at.y);
    applyTowerStats(world, tower);

    const quoted = towerInfo(world, tower)?.current.dps ?? 0;
    expect(quoted).toBeGreaterThan(0);

    const seconds = 10;
    advance(world, TICK_HZ * seconds);

    const dealt = (world.towers.damageDealt[tower] as number) / seconds;
    /* Within a tenth: a ten-second window cannot divide every fire interval
       evenly, so the last shot may fall either side of the boundary. */
    expect(dealt).toBeGreaterThan(quoted * 0.9);
    expect(dealt).toBeLessThan(quoted * 1.1);
    expect(world.enemies.hp[enemy]).toBeLessThan(world.enemies.maxHp[enemy] as number);
  });
});

/**
 * And where it deliberately does not.
 *
 * The quoted DPS is what the *tower* puts out, not what a particular target
 * takes. A tower that applies Unravel amplifies its own later hits, so what
 * lands exceeds the quote — which is the mechanic working, not the panel
 * lying. Stating it here so nobody later "fixes" the panel to match.
 */
describe('a status-applying tower outgrows its own quote', () => {
  it('deals more than quoted once its status has stacked', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    dummy(world, 400);

    const tower = placeTower(world, towerIndex(world, 'arcane_spire'), at.x, at.y);
    applyTowerStats(world, tower);

    const quoted = towerInfo(world, tower)?.current.dps ?? 0;
    const seconds = 10;
    advance(world, TICK_HZ * seconds);

    const dealt = (world.towers.damageDealt[tower] as number) / seconds;
    expect(dealt).toBeGreaterThan(quoted);
    /* Bounded by the status's own cap, so it is amplification and not a bug. */
    expect(dealt).toBeLessThan(quoted * 1.5);
  });
});

describe('a tower reports what it has done', () => {
  it('starts at nothing', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), at.x, at.y);
    applyTowerStats(world, tower);

    const info = towerInfo(world, tower);
    expect(info?.kills).toBe(0);
    expect(info?.damageDealt).toBe(0);
  });

  it('counts the damage it deals', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    dummy(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), at.x, at.y);
    applyTowerStats(world, tower);

    advance(world, TICK_HZ * 3);
    expect(towerInfo(world, tower)?.damageDealt).toBeGreaterThan(0);
  });

  it('counts the kills it lands', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), at.x, at.y);
    applyTowerStats(world, tower);

    const enemy = dummy(world, 400);
    world.enemies.hp[enemy] = 1;
    advance(world, TICK_HZ * 2);

    expect(towerInfo(world, tower)?.kills).toBe(1);
  });

  /* Attribution matters: a kill by a burn or a reaction is not this tower's,
     and a panel that claimed it would overstate what the tower is worth. */
  it('does not claim a kill it did not land', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), at.x, at.y);
    applyTowerStats(world, tower);

    const enemy = dummy(world, 400);
    world.enemies.hp[enemy] = 1;
    /* Killed by something with no tower behind it. */
    world.damage.push(enemy, 500, 0, -1);
    tick(world);

    expect(towerInfo(world, tower)?.kills).toBe(0);
    expect(world.stats.enemiesKilled).toBe(1);
  });
});

describe('targeting modes', () => {
  /** Two enemies the tower can see, at known distances along the path. */
  function twoInRange(world: World): { tower: number; near: number; far: number } {
    const at = pointAt(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), at.x, at.y);
    applyTowerStats(world, tower);

    const near = dummy(world, 380);
    const far = dummy(world, 420);
    targetingSystem(world);
    return { tower, near, far };
  }

  it('First takes the one furthest along the path', () => {
    const world = freshWorld();
    const { tower, far } = twoInRange(world);
    world.towers.targetMode[tower] = TargetMode.First;
    expect(pickTarget(world, tower)).toBe(far);
  });

  it('Last takes the one least far along', () => {
    const world = freshWorld();
    const { tower, near } = twoInRange(world);
    world.towers.targetMode[tower] = TargetMode.Last;
    expect(pickTarget(world, tower)).toBe(near);
  });

  it('Strongest takes the one with the most health', () => {
    const world = freshWorld();
    const { tower, near, far } = twoInRange(world);
    world.enemies.hp[near] = 900;
    world.enemies.hp[far] = 100;
    world.towers.targetMode[tower] = TargetMode.Strongest;
    expect(pickTarget(world, tower)).toBe(near);
  });

  it('Weakest takes the one with the least', () => {
    const world = freshWorld();
    const { tower, near, far } = twoInRange(world);
    world.enemies.hp[near] = 900;
    world.enemies.hp[far] = 100;
    world.towers.targetMode[tower] = TargetMode.Weakest;
    expect(pickTarget(world, tower)).toBe(far);
  });

  it('Closest takes the one nearest in pixels', () => {
    const world = freshWorld();
    const { tower, near } = twoInRange(world);
    world.enemies.x[near] = world.towers.x[tower] as number;
    world.enemies.y[near] = (world.towers.y[tower] as number) + 8;
    world.towers.targetMode[tower] = TargetMode.Closest;
    expect(pickTarget(world, tower)).toBe(near);
  });

  /* The acceptance criterion: a change takes effect on the next re-target,
     not on some later tick and not never. */
  it('takes effect on the next re-target', () => {
    const world = freshWorld();
    const { tower, near, far } = twoInRange(world);
    world.towers.targetMode[tower] = TargetMode.First;
    world.towers.target[tower] = far;

    setTargetMode(world.commands, tower, TargetMode.Last);
    tick(world);

    expect(world.towers.target[tower]).toBe(near);
  });

  it('is reported to the panel', () => {
    const world = freshWorld();
    const { tower } = twoInRange(world);
    setTargetMode(world.commands, tower, TargetMode.Strongest);
    tick(world);
    expect(towerInfo(world, tower)?.targetMode).toBe(TargetMode.Strongest);
  });
});

describe('a tower opens on the mode it was built with', () => {
  /**
   * The preference rides on the build command rather than following it as a
   * second one, because the slot does not exist until the build lands — and
   * because a build and the preference it was made under are one intent.
   */
  it('takes the mode the build carried', () => {
    const world = freshWorld();
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    buildTower(world.commands, plot.id, towerIndex(world, 'arbalest_post'), TargetMode.Weakest);
    tick(world);

    let built = -1;
    for (let slot = 0; slot < world.towers.watermark; slot++) {
      if (world.towers.isAlive(slot)) built = slot;
    }
    expect(built).toBeGreaterThanOrEqual(0);
    expect(world.towers.targetMode[built]).toBe(TargetMode.Weakest);
  });

  it('defaults to First when the build carries nothing', () => {
    const world = freshWorld();
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    buildTower(world.commands, plot.id, towerIndex(world, 'arbalest_post'));
    tick(world);

    let built = -1;
    for (let slot = 0; slot < world.towers.watermark; slot++) {
      if (world.towers.isAlive(slot)) built = slot;
    }
    expect(world.towers.targetMode[built]).toBe(TargetMode.First);
  });
});

describe('the panel reads the same numbers the simulation uses', () => {
  it('quotes the range the targeting code actually enforces', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);
    const tower = placeTower(world, towerIndex(world, 'arbalest_post'), at.x, at.y);
    applyTowerStats(world, tower);

    const quoted = towerInfo(world, tower)?.current.rangeTiles ?? 0;
    expect(quoted * TILE_SIZE).toBeCloseTo(world.towers.range[tower] as number, 3);
  });

  it('reports the status a tier applies, and none when it applies none', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);

    const frost = placeTower(world, towerIndex(world, 'frost_cairn'), at.x, at.y);
    applyTowerStats(world, frost);
    expect(towerInfo(world, frost)?.current.status?.id).toBe('chill');

    const mortar = placeTower(world, towerIndex(world, 'mortar_emplacement'), at.x + 400, at.y);
    applyTowerStats(world, mortar);
    expect(towerInfo(world, mortar)?.current.status).toBeNull();
  });

  it('says what a tower can shoot at', () => {
    const world = freshWorld();
    const at = pointAt(world, 400);

    const mortar = placeTower(world, towerIndex(world, 'mortar_emplacement'), at.x, at.y);
    applyTowerStats(world, mortar);
    const info = towerInfo(world, mortar);
    expect(info?.current.hitsGround).toBe(true);
    expect(info?.current.hitsAir).toBe(false);
  });
});
