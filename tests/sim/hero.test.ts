import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { stageAtLeast } from '@app/session';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  EnemyFlag,
  MAX_HERO_LEVEL,
  SoldierFlag,
  STATUS_INDEX,
  advance,
  castHeroAbility,
  createWorldForStage,
  enemyIndex,
  hashWorld,
  heroInfo,
  heroSystem,
  moveHero,
  orderHero,
  soldierSystem,
  spawnEnemy,
  tick,
} from '@sim/index';

/**
 * The hero (#25, docs/GAME_DESIGN.md §11).
 *
 * The acceptance criterion that matters most is architectural: *the hero
 * reuses this exact code path* — #24's blocking, not a second copy of it.
 * Blocking is the subtlest system in the genre and two implementations of it
 * would drift within a month, so several of these tests exist to prove the
 * hero is a soldier with better numbers and a flag.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const kaelen = registry.heroes.get('kaelen');
if (kaelen === undefined) throw new Error('kaelen missing');

const freshWorld = (level = 1, seed = 1): World =>
  createWorldForStage(registry, stage, seed, { heroId: 'kaelen', heroLevel: level });

function pointAt(world: World, pathDistance: number): { x: number; y: number } {
  const sample = { x: 0, y: 0, dirX: 0, dirY: 0 };
  world.rules.paths[0]?.sample(pathDistance, sample);
  return { x: sample.x, y: sample.y };
}

function enemyAt(world: World, pathDistance: number, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  const at = pointAt(world, pathDistance);
  world.enemies.pathDist[slot] = pathDistance;
  world.enemies.x[slot] = at.x;
  world.enemies.y[slot] = at.y;
  world.enemies.hp[slot] = 100_000;
  world.enemies.maxHp[slot] = 100_000;
  world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Blocked;
  return slot;
}

describe('deploying', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
  });

  it('puts the hero on the board at the Core', () => {
    heroSystem(world);
    expect(world.heroSlot).toBeGreaterThanOrEqual(0);
    expect(world.soldiers.x[world.heroSlot]).toBeCloseTo(world.rules.core.x, 3);
    expect(world.soldiers.y[world.heroSlot]).toBeCloseTo(world.rules.core.y, 3);
  });

  /* The whole design: a soldier with better numbers and a flag. */
  it('lives in the soldier pool, flagged as the hero', () => {
    heroSystem(world);
    const flags = world.soldiers.flags[world.heroSlot] as number;
    expect(flags & SoldierFlag.Hero).not.toBe(0);
    expect(world.soldiers.sourceTower[world.heroSlot]).toBe(-1);
  });

  it('deploys exactly one, however many ticks pass', () => {
    advance(world, 120);
    let heroes = 0;
    for (let slot = 0; slot < world.soldiers.watermark; slot++) {
      if (!world.soldiers.isAlive(slot)) continue;
      if (((world.soldiers.flags[slot] as number) & SoldierFlag.Hero) !== 0) heroes++;
    }
    expect(heroes).toBe(1);
  });

  it('takes its authored stats', () => {
    heroSystem(world);
    const slot = world.heroSlot;
    expect(world.soldiers.maxHp[slot]).toBe(kaelen.hp);
    expect(world.soldiers.damage[slot]).toBe(kaelen.damage);
    expect(world.soldiers.armour[slot]).toBe(kaelen.armour);
    expect(world.soldiers.damageType[slot]).toBe(DAMAGE_INDEX[kaelen.damageType]);
  });

  it('deploys none when the stage takes no hero', () => {
    const none = createWorldForStage(registry, stage, 1);
    advance(none, 60);
    expect(none.heroSlot).toBe(-1);
    expect(heroInfo(none)).toBeNull();
  });
});

describe('levels', () => {
  /* Levels come from stage completions rather than anything inside a run
     (§11), so they are folded in once at load and never move during play. */
  it('adds the authored growth per level', () => {
    const first = freshWorld(1);
    const tenth = freshWorld(MAX_HERO_LEVEL);

    expect(tenth.rules.hero?.hp).toBe(kaelen.hp + kaelen.hpPerLevel * (MAX_HERO_LEVEL - 1));
    expect(tenth.rules.hero?.damage).toBe(
      kaelen.damage + kaelen.damagePerLevel * (MAX_HERO_LEVEL - 1),
    );
    expect(first.rules.hero?.hp).toBe(kaelen.hp);
  });

  it('clamps past the top of the range', () => {
    expect(freshWorld(99).rules.hero?.level).toBe(MAX_HERO_LEVEL);
    expect(freshWorld(0).rules.hero?.level).toBe(1);
  });
});

describe('being commanded', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    heroSystem(world);
  });

  it('walks toward where it was sent', () => {
    const target = pointAt(world, 400);
    const before = Math.hypot(
      (world.soldiers.x[world.heroSlot] as number) - target.x,
      (world.soldiers.y[world.heroSlot] as number) - target.y,
    );

    orderHero(world, target.x, target.y);
    advance(world, 60);

    const after = Math.hypot(
      (world.soldiers.x[world.heroSlot] as number) - target.x,
      (world.soldiers.y[world.heroSlot] as number) - target.y,
    );
    expect(after).toBeLessThan(before);
  });

  it('arrives and stops', () => {
    const target = pointAt(world, 400);
    orderHero(world, target.x, target.y);
    advance(world, 20 * TICK_HZ);

    expect(world.soldiers.x[world.heroSlot]).toBeCloseTo(target.x, 1);
    expect(world.heroOrdered).toBe(false);
  });

  /* §11 says tap anywhere, not tap a path: a hero that refused to stand off
     the road could not be parked out of trouble while it heals. */
  it('goes to a point that is not on any path', () => {
    orderHero(world, 40, 40);
    advance(world, 30 * TICK_HZ);
    expect(world.soldiers.x[world.heroSlot]).toBeCloseTo(40, 1);
  });

  it('goes through the command queue like everything else', () => {
    const target = pointAt(world, 400);
    moveHero(world.commands, target.x, target.y);
    advance(world, 60);
    expect(world.heroOrdered || world.soldiers.x[world.heroSlot] !== world.rules.core.x).toBe(true);
  });

  it('cannot be commanded while it is down', () => {
    world.soldiers.flags[world.heroSlot] =
      SoldierFlag.Alive | SoldierFlag.Hero | SoldierFlag.Respawning;
    expect(orderHero(world, 100, 100)).toBe(false);
  });
});

/**
 * The acceptance criterion: the hero blocks through #24's code, not a copy.
 * These assert the *observable consequences* of that, which is the only way to
 * notice if someone quietly forks it later.
 */
describe('blocking, through the soldier code path', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    heroSystem(world);
  });

  it('holds a ground enemy it is standing in front of', () => {
    const at = pointAt(world, 400);
    orderHero(world, at.x, at.y);
    advance(world, 30 * TICK_HZ);

    const enemy = enemyAt(world, world.soldiers.pathDist[world.heroSlot] as number);
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked;
    soldierSystem(world);

    expect(world.enemies.blockedBy[enemy]).toBe(world.heroSlot);
  });

  /* The same window soldiers use: near in pixels is not near along the path. */
  it('ignores an enemy that is close in pixels but far along the path', () => {
    const at = pointAt(world, 400);
    orderHero(world, at.x, at.y);
    advance(world, 30 * TICK_HZ);

    const enemy = enemyAt(world, 400);
    world.enemies.x[enemy] = world.soldiers.x[world.heroSlot] as number;
    world.enemies.y[enemy] = world.soldiers.y[world.heroSlot] as number;
    world.enemies.pathDist[enemy] = 400 + TILE_SIZE * 20;
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked;

    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  it('lets a flyer pass, as any soldier would', () => {
    const at = pointAt(world, 400);
    orderHero(world, at.x, at.y);
    advance(world, 30 * TICK_HZ);

    const enemy = enemyAt(world, world.soldiers.pathDist[world.heroSlot] as number, 'rift_bat');
    world.enemies.flags[enemy] =
      ((world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked) | EnemyFlag.Flying;

    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });

  it('lets go when it is sent somewhere else', () => {
    const at = pointAt(world, 400);
    orderHero(world, at.x, at.y);
    advance(world, 30 * TICK_HZ);

    const enemy = enemyAt(world, world.soldiers.pathDist[world.heroSlot] as number);
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) & ~EnemyFlag.Blocked;
    soldierSystem(world);
    expect(world.enemies.blockedBy[enemy]).toBe(world.heroSlot);

    orderHero(world, 40, 40);
    expect(world.enemies.blockedBy[enemy]).toBe(-1);
  });
});

describe('auto-attack', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    heroSystem(world);
  });

  it('strikes an enemy inside its reach', () => {
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.hp[enemy] = 100_000;
    world.enemies.maxHp[enemy] = 100_000;
    world.enemies.x[enemy] = world.rules.core.x + 32;
    world.enemies.y[enemy] = world.rules.core.y;
    world.enemies.flags[enemy] = (world.enemies.flags[enemy] as number) | EnemyFlag.Blocked;

    heroSystem(world);
    expect(world.damage.count).toBeGreaterThan(0);
  });

  it('leaves one outside its reach alone', () => {
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.x[enemy] = world.rules.core.x + TILE_SIZE * 20;
    world.enemies.y[enemy] = world.rules.core.y;

    heroSystem(world);
    expect(world.damage.count).toBe(0);
  });

  /* Its own damage type, not the steel a soldier swings. */
  it('strikes with the hero`s damage type', () => {
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.x[enemy] = world.rules.core.x + 32;
    world.enemies.y[enemy] = world.rules.core.y;

    heroSystem(world);
    expect(world.damage.type[0]).toBe(DAMAGE_INDEX[kaelen.damageType]);
  });

  /* The soldier system already swings for an engaged body; striking again
     here would have the hero hit twice. */
  it('stands down while the soldier system is fighting for it', () => {
    world.soldiers.flags[world.heroSlot] =
      SoldierFlag.Alive | SoldierFlag.Hero | SoldierFlag.Engaged;
    const enemy = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.x[enemy] = world.rules.core.x + 32;
    world.enemies.y[enemy] = world.rules.core.y;

    heroSystem(world);
    expect(world.damage.count).toBe(0);
  });
});

describe('dying and coming back', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    heroSystem(world);
  });

  const kill = (): void => {
    world.soldiers.hp[world.heroSlot] = 0;
    world.soldiers.flags[world.heroSlot] =
      SoldierFlag.Alive | SoldierFlag.Hero | SoldierFlag.Respawning;
    world.heroRespawnIn = world.rules.hero?.respawnTicks ?? 0;
  };

  it('keeps its slot rather than being discarded', () => {
    const slot = world.heroSlot;
    kill();
    advance(world, 30);
    expect(world.heroSlot).toBe(slot);
    expect(world.soldiers.isAlive(slot)).toBe(true);
  });

  it('comes back after the authored delay, at full health', () => {
    kill();
    advance(world, Math.ceil(kaelen.respawnSeconds * TICK_HZ) + 5);

    expect((world.soldiers.flags[world.heroSlot] as number) & SoldierFlag.Respawning).toBe(0);
    expect(world.soldiers.hp[world.heroSlot]).toBe(world.rules.hero?.hp);
  });

  /* At the Core rather than where it fell, so dying costs position as well as
     time — the player has to walk it back to wherever the trouble was. */
  it('comes back at the Core', () => {
    orderHero(world, 200, 200);
    advance(world, 5 * TICK_HZ);
    kill();
    advance(world, Math.ceil(kaelen.respawnSeconds * TICK_HZ) + 5);

    expect(world.soldiers.x[world.heroSlot]).toBeCloseTo(world.rules.core.x, 3);
  });

  /* A hero that walked straight back into whatever killed it would be obeying
     an instruction the player gave a different situation. */
  it('forgets the order it died under', () => {
    orderHero(world, 200, 200);
    kill();
    advance(world, Math.ceil(kaelen.respawnSeconds * TICK_HZ) + 5);
    expect(world.heroOrdered).toBe(false);
  });

  it('reports the countdown, because §11 asks for a visible timer', () => {
    kill();
    advance(world, 60);

    const info = heroInfo(world);
    expect(info?.down).toBe(true);
    expect(info?.respawnIn).toBeGreaterThan(0);
    expect(info?.respawnIn).toBeLessThanOrEqual(kaelen.respawnSeconds);
  });
});

describe('abilities', () => {
  let world: World;
  beforeEach(() => {
    world = freshWorld();
    heroSystem(world);
  });

  it('has the three the hero authors', () => {
    expect(world.rules.hero?.abilityIds).toEqual(kaelen.abilities.map((a) => a.id));
  });

  it('casts the first and puts it on cooldown', () => {
    const at = pointAt(world, 400);
    const enemy = enemyAt(world, 400);
    /* Effects read the spatial index, which the targeting step rebuilds — so a
       tick has to have happened before anything can be found near anything. */
    tick(world);

    castHeroAbility(world.commands, 0, at.x, at.y);
    tick(world);

    expect(world.heroAbilityReadyTick[0]).toBeGreaterThan(0);
    expect(world.enemies.stacksOf(enemy, STATUS_INDEX.unravel)).toBeGreaterThan(0);
  });

  it('refuses a second cast while it cools', () => {
    const at = pointAt(world, 400);
    castHeroAbility(world.commands, 0, at.x, at.y);
    tick(world);
    const readyAt = world.heroAbilityReadyTick[0] as number;

    castHeroAbility(world.commands, 0, at.x, at.y);
    tick(world);
    expect(world.heroAbilityReadyTick[0]).toBe(readyAt);
  });

  it('cools each ability on its own clock', () => {
    const at = pointAt(world, 400);
    castHeroAbility(world.commands, 0, at.x, at.y);
    tick(world);

    castHeroAbility(world.commands, 1, at.x, at.y);
    tick(world);
    expect(world.heroAbilityReadyTick[1]).toBeGreaterThan(0);
  });

  /**
   * §11: abilities are on their own cooldowns, **independent of Aether
   * Charge**. The hero is the player's own agency, and making it compete with
   * Warden Powers for one pool would turn two decisions into one.
   */
  it('costs no Aether', () => {
    world.resources.aether = 0;
    const at = pointAt(world, 400);

    castHeroAbility(world.commands, 0, at.x, at.y);
    tick(world);
    expect(world.heroAbilityReadyTick[0]).toBeGreaterThan(0);
    expect(world.resources.aether).toBe(0);
  });

  it('will not cast while the hero is down', () => {
    world.soldiers.flags[world.heroSlot] =
      SoldierFlag.Alive | SoldierFlag.Hero | SoldierFlag.Respawning;
    castHeroAbility(world.commands, 0, 500, 500);
    tick(world);
    expect(world.heroAbilityReadyTick[0]).toBe(0);
  });

  it('refuses an ability that does not exist', () => {
    castHeroAbility(world.commands, 7, 500, 500);
    expect(() => tick(world)).not.toThrow();
  });
});

describe('the unlock gate', () => {
  /* Compared as region and index, so "1-10" comes after "1-5" rather than
     before it — which a string comparison would get exactly wrong. */
  it.each([
    ['1-5', '1-5', true],
    ['1-6', '1-5', true],
    ['1-10', '1-5', true],
    ['1-4', '1-5', false],
    ['2-1', '1-5', true],
    ['1-1', '2-1', false],
  ])('%s against a gate of %s is %s', (stageId, minimum, expected) => {
    expect(stageAtLeast(stageId, minimum)).toBe(expected);
  });
});

describe('the hero is deterministic', () => {
  function run(seed: number): string {
    const world = freshWorld(5, seed);
    heroSystem(world);
    const at = pointAt(world, 400);
    orderHero(world, at.x, at.y);
    for (let i = 0; i < 8; i++) enemyAt(world, 380 + i * 14);

    castHeroAbility(world.commands, 0, at.x, at.y);
    advance(world, 600);
    return hashWorld(world);
  }

  it('produces an identical world from an identical run', () => {
    expect(run(13)).toBe(run(13));
  });

  it('runs the same at 3x as at 1x', () => {
    const slow = freshWorld(5, 4);
    const fast = freshWorld(5, 4);
    for (const world of [slow, fast]) {
      heroSystem(world);
      const at = pointAt(world, 400);
      orderHero(world, at.x, at.y);
      for (let i = 0; i < 4; i++) enemyAt(world, 380 + i * 14);
    }

    for (let i = 0; i < 300; i++) advance(slow, 1);
    for (let i = 0; i < 100; i++) advance(fast, 3);

    expect(fast.tick).toBe(slow.tick);
    expect(hashWorld(fast)).toBe(hashWorld(slow));
  });
});
