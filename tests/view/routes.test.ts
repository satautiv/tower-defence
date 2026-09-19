import type { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import type { StageDefinition } from '@content/schema/stage';
import { readContentFromDisk } from '../../tools/content/io.js';
import { createWorldForStage, enemyIndex, spawnEnemy } from '@sim/index';
import type { BakedPath, World } from '@sim/index';
import { createLayerStack } from '@view/layers';
import type { Layers } from '@view/layers';
import { RouteView, describeRoutes } from '@view/routes';

/**
 * The player plans every placement off this drawing, so what matters is that it
 * shows every route an enemy can actually take and nothing else. Pixel output
 * is not testable under Node; where the arrows land is.
 */

const registry = buildRegistry(readContentFromDisk());
const base = registry.stages.get('1-1');
if (base === undefined) throw new Error('stage 1-1 missing');
const stage: StageDefinition = base;

const worldFor = (definition: StageDefinition): World =>
  createWorldForStage(registry, definition, 1);

const points = (list: [number, number][]): { x: number; y: number }[] =>
  list.map(([x, y]) => ({ x, y }));

/**
 * 1-1 with a fork and a second spawn: path 0 may divert onto path 1 along the
 * bottom edge, and a spawn on the top edge joins path 0's route partway. A
 * third spawn reuses path 0, which must not be drawn twice.
 */
const forked: StageDefinition = {
  ...stage,
  paths: [
    {
      ...(stage.paths[0] as StageDefinition['paths'][number]),
      branches: [{ atDistanceTiles: 6, targetPathId: 1, weight: 1 }],
    },
    {
      id: 1,
      points: points([
        [0, 8],
        [6, 8],
        [6, 16],
        [22, 16],
        [22, 8],
        [29, 8],
      ]),
      branches: [],
    },
    {
      id: 2,
      points: points([
        [10, 0],
        [10, 3],
        [14, 3],
        [14, 13],
        [22, 13],
        [22, 8],
        [29, 8],
      ]),
      branches: [],
    },
  ],
  spawnPoints: [
    ...stage.spawnPoints,
    { id: 1, position: { x: 10, y: 0 }, pathId: 2 },
    { id: 2, position: { x: 0, y: 8 }, pathId: 0 },
  ],
};

const grounded: StageDefinition = {
  ...stage,
  waves: stage.waves
    .map((wave) => ({ ...wave, groups: wave.groups.filter((group) => group.enemy !== 'rift_bat') }))
    .filter((wave) => wave.groups.length > 0),
};

function distanceToPath(path: BakedPath, x: number, y: number): number {
  let nearest = Infinity;
  for (let p = 1; p < path.pointCount; p++) {
    const ax = path.points[(p - 1) * 2] as number;
    const ay = path.points[(p - 1) * 2 + 1] as number;
    const dx = (path.points[p * 2] as number) - ax;
    const dy = (path.points[p * 2 + 1] as number) - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    nearest = Math.min(nearest, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
  }
  return nearest;
}

/** The arrows are the children of the containers on the decal layer. */
function visibleArrows(layers: Layers): { x: number; y: number }[] {
  return layers.decals.children
    .flatMap((child: Container) => child.children)
    .filter((arrow) => arrow.visible)
    .map((arrow) => ({ x: arrow.position.x, y: arrow.position.y }));
}

function setup(definition: StageDefinition): { world: World; layers: Layers; view: RouteView } {
  const world = worldFor(definition);
  const { layers } = createLayerStack();
  const view = new RouteView(layers);
  view.sync(world);
  return { world, layers, view };
}

describe('which routes are drawn', () => {
  it('draws the one road of stage 1-1, from its spawn to the core', () => {
    const world = worldFor(stage);
    const routes = describeRoutes(world);

    expect(routes.ground.map((route) => route.path.id)).toEqual([0]);
    expect(routes.spawns).toEqual([{ x: 0, y: 8 * TILE_SIZE }]);
    expect(routes.core).toEqual(world.rules.core);
  });

  /** A branch is a whole route chosen at spawn; an undrawn one is an unplannable leak. */
  it('includes every branch and every spawn, each path once', () => {
    const routes = describeRoutes(worldFor(forked));
    expect(routes.ground.map((route) => route.path.id).sort()).toEqual([0, 1, 2]);
    expect(routes.spawns).toHaveLength(3);
  });

  /** Rift Bats fly straight from the spawn to the core, ignoring the road. */
  it('draws a flyer lane when a wave sends flyers', () => {
    const world = worldFor(stage);
    const [lane, ...rest] = describeRoutes(world).flyers;

    expect(rest).toHaveLength(0);
    expect(lane).toMatchObject({
      spawnIndex: 0,
      fromX: 0,
      fromY: 8 * TILE_SIZE,
      toX: world.rules.core.x,
      toY: world.rules.core.y,
    });
  });

  it('draws no flyer lane on a stage where nothing flies', () => {
    expect(describeRoutes(worldFor(grounded)).flyers).toHaveLength(0);
  });

  /**
   * The lane runs along the road at both ends and crosses it in the middle, so
   * the mark saying "flyers" has to be placed deliberately to read as the
   * lane's rather than the road's.
   */
  it('marks the flyer lane well clear of the road', () => {
    const world = worldFor(stage);
    const lane = describeRoutes(world).flyers[0];
    const path = world.rules.pathById.get(0);
    if (lane === undefined || path === undefined) throw new Error('fixture');

    expect(lane.markY).toBe(8 * TILE_SIZE);
    expect(distanceToPath(path, lane.markX, lane.markY)).toBeGreaterThanOrEqual(3 * TILE_SIZE);
  });
});

describe('flow arrows', () => {
  it('only ever sit on a route', () => {
    const { world, layers, view } = setup(stage);
    const path = world.rules.pathById.get(0);
    if (path === undefined) throw new Error('fixture');
    const laneY = 8 * TILE_SIZE;

    for (const now of [0, 333, 750, 1200]) {
      view.render(world, now);
      const arrows = visibleArrows(layers);
      expect(arrows.length).toBeGreaterThan(0);
      for (const arrow of arrows) {
        const onRoad = distanceToPath(path, arrow.x, arrow.y) < 1;
        const onLane = Math.abs(arrow.y - laneY) < 1;
        expect(onRoad || onLane).toBe(true);
      }
    }
  });

  it('drift towards the core', () => {
    const { world, layers, view } = setup(grounded);
    const first = (): { x: number; y: number } => {
      const arrow = layers.decals.children.flatMap((child: Container) => child.children)[0];
      if (arrow === undefined) throw new Error('no arrows');
      return { x: arrow.position.x, y: arrow.position.y };
    };

    view.render(world, 0);
    const before = first();
    view.render(world, 200);
    const after = first();

    /* 1-1 leaves its spawn heading east. */
    expect(after.y).toBe(before.y);
    expect(after.x).toBeGreaterThan(before.x);
  });

  /**
   * Routes reach a shared stretch by different distances, so their arrows fall
   * out of step there. Drawn naively, every merged stretch shows two arrows
   * where there should be one.
   */
  it('never double up where routes share a stretch', () => {
    const { world, layers, view } = setup(forked);

    for (let now = 0; now < 1500; now += 125) {
      view.render(world, now);
      const arrows = visibleArrows(layers);
      for (let i = 0; i < arrows.length; i++) {
        for (let j = i + 1; j < arrows.length; j++) {
          const a = arrows[i] as { x: number; y: number };
          const b = arrows[j] as { x: number; y: number };
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(TILE_SIZE * 0.75);
        }
      }
    }
  });

  it('still shows each branch once the routes part', () => {
    const { world, layers, view } = setup(forked);
    view.render(world, 0);
    const arrows = visibleArrows(layers);

    /* The bottom detour belongs to the branch alone. */
    expect(arrows.some((arrow) => arrow.y === 16 * TILE_SIZE)).toBe(true);
    /* The top spawn's approach belongs to its own route alone. */
    expect(arrows.some((arrow) => arrow.x === 10 * TILE_SIZE && arrow.y < 3 * TILE_SIZE)).toBe(
      true,
    );
  });

  /** Enemies on the road show the route themselves; bright arrows would compete. */
  it('fade while enemies are on the board and return once it is clear', () => {
    const { world, view } = setup(stage);
    view.render(world, 0);
    const quiet = view.currentArrowAlpha;

    const slot = spawnEnemy(world, enemyIndex(world, 'riftling'), 0);
    for (let now = 0; now <= 2000; now += 16) view.render(world, now);
    const busy = view.currentArrowAlpha;
    expect(busy).toBeLessThan(quiet / 2);

    world.enemies.free(slot);
    for (let now = 2000; now <= 4000; now += 16) view.render(world, now);
    expect(view.currentArrowAlpha).toBeCloseTo(quiet, 2);
  });

  it('are built once per stage, not per frame', () => {
    const { world, view } = setup(forked);
    const count = view.arrowCount;
    expect(count).toBeGreaterThan(0);

    for (let now = 0; now < 1000; now += 16) view.render(world, now);
    expect(view.arrowCount).toBe(count);
  });
});
