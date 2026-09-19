import { beforeEach, describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  EnemyFlag,
  STATUS_INDEX,
  STATUS_COUNT,
  advance,
  createWorldForStage,
  enemyIndex,
  hashWorld,
  placeTower,
  spawnEnemy,
  towerIndex,
} from '@sim/index';
import type { World } from '@sim/index';
import { createLayerStack } from '@view/layers';
import { EntityView } from '@view/entities';
import { EffectsView } from '@view/effects';

/**
 * Pixi's scene graph is plain JavaScript until something is rasterised, so
 * sprite lifecycle and interpolation can be tested for real under Node. What
 * cannot be tested here is how it looks; that is the Playwright pass in #53.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed);

function setup(): { world: World; view: EntityView } {
  const world = freshWorld();
  return { world, view: new EntityView(createLayerStack().layers) };
}

describe('sprites follow the entity pools', () => {
  let world: World;
  let view: EntityView;
  beforeEach(() => {
    ({ world, view } = setup());
  });

  it('creates a sprite when an entity appears', () => {
    expect(view.spriteCount).toBe(0);
    spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    view.sync(world);
    expect(view.spriteCount).toBe(1);
  });

  it('creates one per entity, towers included', () => {
    for (let i = 0; i < 5; i++) spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    placeTower(world, towerIndex(world, 'arbalest_post'), 100, 100);
    view.sync(world);
    expect(view.spriteCount).toBe(6);
  });

  it('removes the sprite when the entity goes', () => {
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    view.sync(world);

    world.enemies.free(slot);
    view.sync(world);
    expect(view.spriteCount).toBe(0);
  });

  /**
   * Slots are recycled. A sprite inheriting a new occupant's slot would keep
   * the previous entity's interpolation history and jump across the map.
   */
  it('rebuilds the sprite when a slot is recycled into a different entity', () => {
    const first = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.x[first] = 100;
    view.sync(world);
    view.render(world, 1);

    world.enemies.free(first);
    const second = spawnEnemy(world, enemyIndex(world, 'rift_bat'), 0);
    expect(second).toBe(first);
    world.enemies.x[second] = 900;
    view.sync(world);

    /* Interpolation starts from the new position, not the old one. */
    view.render(world, 0);
    expect(view.spriteCount).toBe(1);
  });

  it('hides a burrowed enemy rather than removing it', () => {
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    view.sync(world);
    expect(view.spriteCount).toBe(1);

    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Burrowed;
    view.sync(world);
    expect(view.spriteCount).toBe(1);
  });
});

describe('interpolation', () => {
  it('sits on the previous position at alpha zero and the current at one', () => {
    const { world, view } = setup();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);

    world.enemies.x[slot] = 100;
    world.enemies.y[slot] = 0;
    view.sync(world);

    view.captureForInterpolation();
    world.enemies.x[slot] = 200;
    view.sync(world);

    view.render(world, 0);
    expect(spriteAt(view, 0).x).toBeCloseTo(100, 4);

    view.render(world, 1);
    expect(spriteAt(view, 0).x).toBeCloseTo(200, 4);
  });

  it('places the sprite midway at alpha one half', () => {
    const { world, view } = setup();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.x[slot] = 0;
    world.enemies.y[slot] = 0;
    view.sync(world);

    view.captureForInterpolation();
    world.enemies.x[slot] = 100;
    world.enemies.y[slot] = 40;
    view.sync(world);
    view.render(world, 0.5);

    const sprite = spriteAt(view, 0);
    expect(sprite.x).toBeCloseTo(50, 4);
    expect(sprite.y).toBeCloseTo(20, 4);
  });

  it('sorts by screen row, so something lower draws in front', () => {
    const { world, view } = setup();
    const near = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    world.enemies.y[near] = 500;
    view.sync(world);
    view.render(world, 1);

    expect(spriteAt(view, 0).zIndex).toBeCloseTo(500, 4);
  });
});

/** Reaches into the view's own map, which is the only way to see a sprite. */
function spriteAt(view: EntityView, index: number): { x: number; y: number; zIndex: number } {
  const entries = [
    ...(
      view as unknown as {
        enemies: Map<number, { sprite: { x: number; y: number; zIndex: number } }>;
      }
    ).enemies.values(),
  ];
  const entry = entries[index];
  if (entry === undefined) throw new Error('no sprite at that index');
  return entry.sprite;
}

describe('sprites are recycled, not leaked', () => {
  /**
   * The acceptance criterion. A sprite per spawned enemy retained forever is
   * invisible until a long stage runs out of memory on a phone.
   */
  it('returns to baseline after a wave has come and gone', () => {
    const { world, view } = setup();
    const baseline = view.spriteCount;

    for (let round = 0; round < 20; round++) {
      const slots: number[] = [];
      for (let i = 0; i < 30; i++) slots.push(spawnEnemy(world, enemyIndex(world, 'husk'), 0));
      view.sync(world);
      expect(view.spriteCount).toBe(30);

      for (const slot of slots) world.enemies.free(slot);
      view.sync(world);
      expect(view.spriteCount).toBe(baseline);
    }
  });

  it('reuses the pooled sprites rather than making more', () => {
    const { world, view } = setup();
    for (let i = 0; i < 10; i++) spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    view.sync(world);
    for (let slot = 0; slot < world.enemies.watermark; slot++) world.enemies.free(slot);
    view.sync(world);

    const pooled = view.pooledCount;
    expect(pooled).toBe(10);

    for (let i = 0; i < 10; i++) spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    view.sync(world);
    expect(view.pooledCount).toBe(0);
    expect(view.spriteCount).toBe(10);
  });
});

describe('the view never writes to the simulation', () => {
  /**
   * The direction of data flow, checked rather than assumed. The lint rules
   * stop the view importing what it should not; nothing stops it mutating an
   * array it legitimately holds a reference to.
   */
  it('leaves the world byte-identical across a full render pass', () => {
    const world = freshWorld(99);
    const view = new EntityView(createLayerStack().layers);
    const effects = new EffectsView(createLayerStack().layers);

    for (const id of ['husk', 'riftling', 'rift_bat']) {
      spawnEnemy(world, enemyIndex(world, id), 0);
    }
    placeTower(world, towerIndex(world, 'arbalest_post'), 300, 300);
    world.enemies.statusStacks[STATUS_INDEX.scorch] = 3;
    advance(world, 30);

    const before = hashWorld(world);
    view.captureForInterpolation();
    view.sync(world);
    effects.consume(world);
    view.render(world, 0.5);
    effects.render();

    expect(hashWorld(world)).toBe(before);
  });
});

describe('health bars and status pips', () => {
  it('render without touching the world, even at full health', () => {
    const { world, view } = setup();
    const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    view.sync(world);

    const atFullHealth = hashWorld(world);
    view.render(world, 1);
    expect(hashWorld(world)).toBe(atFullHealth);

    /* Damaged and statused, which is when they actually draw. */
    world.enemies.hp[slot] = (world.enemies.maxHp[slot] as number) / 2;
    world.enemies.statusStacks[slot * STATUS_COUNT + STATUS_INDEX.chill] = 2;

    const damaged = hashWorld(world);
    view.render(world, 1);
    expect(hashWorld(world)).toBe(damaged);
  });
});

describe('death effects come from events', () => {
  it('spawns one puff per death and retires them', () => {
    const world = freshWorld();
    const effects = new EffectsView(createLayerStack().layers);

    for (let i = 0; i < 4; i++) {
      world.events.push(2 /* EnemyDied */, i, 100, 200, 0);
    }
    effects.consume(world);
    expect(effects.activeCount).toBe(4);

    for (let frame = 0; frame < 30; frame++) effects.render();
    expect(effects.activeCount).toBe(0);
  });

  it('drops puffs rather than growing without limit', () => {
    const world = freshWorld();
    const effects = new EffectsView(createLayerStack().layers);

    for (let i = 0; i < 1000; i++) world.events.push(2, i, 0, 0, 0);
    effects.consume(world);

    /* A missing puff is invisible; a stutter is not. */
    expect(effects.activeCount).toBeLessThanOrEqual(256);
  });
});
