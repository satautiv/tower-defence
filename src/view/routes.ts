import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { TILE_SIZE } from '@core/constants';
import { EnemyFlag, describeWave } from '@sim/index';
import type { BakedPath, PathSample, World } from '@sim/index';
import type { Layers } from './layers.js';

/**
 * Draws where enemies will go.
 *
 * A fixed-path defence game asks one question before any other — "where do I
 * cover?" — and the player cannot answer it without seeing the route. So every
 * route an enemy can take is drawn, including the ones only some of them take:
 * a branch is a whole alternative route chosen at spawn, and a flyer ignores
 * the road entirely for a straight line to the core. An undrawn route is a
 * leak the player had no way to plan for.
 *
 * Everything is read from the baked paths the movement system samples, never
 * re-derived from content, so the drawing cannot disagree with where enemies
 * actually walk.
 */

export interface GroundRoute {
  path: BakedPath;
  spawnIndex: number;
}

export interface FlyerLane {
  spawnIndex: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Where on the lane to mark it as a flyer lane: the point clearest of any road. */
  markX: number;
  markY: number;
}

export interface RouteMap {
  ground: GroundRoute[];
  flyers: FlyerLane[];
  spawns: { x: number; y: number }[];
  core: { x: number; y: number };
}

/**
 * Every route an enemy on this stage can take.
 *
 * A path shared by two spawn points is listed once. A flyer lane is listed only
 * when some wave actually sends a flyer from that spawn — a lane nothing flies
 * would teach the player to defend against a threat that never comes.
 */
export function describeRoutes(world: World): RouteMap {
  const rules = world.rules;
  const ground: GroundRoute[] = [];
  const seen = new Set<number>();

  const add = (pathId: number, spawnIndex: number): void => {
    const path = rules.pathById.get(pathId);
    if (path === undefined || seen.has(pathId)) return;
    seen.add(pathId);
    ground.push({ path, spawnIndex });
  };

  rules.spawnPoints.forEach((spawn, spawnIndex) => {
    add(spawn.pathId, spawnIndex);
    for (const branch of rules.pathById.get(spawn.pathId)?.branches ?? []) {
      add(branch.targetPathId, spawnIndex);
    }
  });

  const flyingFrom = new Set<number>();
  for (let wave = 0; wave < rules.waves.count; wave++) {
    for (const group of describeWave(rules, wave)?.groups ?? []) {
      const flags = rules.enemies.flags[group.enemyTypeIdx] as number;
      if ((flags & EnemyFlag.Flying) !== 0) flyingFrom.add(group.spawnPoint);
    }
  }

  const flyers: FlyerLane[] = [];
  for (const spawnIndex of [...flyingFrom].sort((a, b) => a - b)) {
    const spawn = rules.spawnPoints[spawnIndex];
    if (spawn === undefined) continue;
    const mark = clearestPoint(spawn.x, spawn.y, rules.core.x, rules.core.y, ground);
    flyers.push({
      spawnIndex,
      fromX: spawn.x,
      fromY: spawn.y,
      toX: rules.core.x,
      toY: rules.core.y,
      markX: mark.x,
      markY: mark.y,
    });
  }

  return {
    ground,
    flyers,
    spawns: rules.spawnPoints.map((spawn) => ({ x: spawn.x, y: spawn.y })),
    core: { x: rules.core.x, y: rules.core.y },
  };
}

/** Candidate points per lane when looking for somewhere to put its mark. */
const MARK_CANDIDATES = 32;

/**
 * The point on a straight lane farthest from every ground route.
 *
 * A lane usually shares its ends with the road — both start at the spawn and
 * finish at the core — so a mark at either end, or even the middle, can land
 * on the road and read as belonging to it. Only computed once per stage.
 */
export function clearestPoint(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  ground: readonly GroundRoute[],
): { x: number; y: number } {
  let best = { x: (fromX + toX) / 2, y: (fromY + toY) / 2 };
  let bestDistance = -1;

  /* Ends excluded: they are the spawn portal and the core. */
  for (let i = 1; i < MARK_CANDIDATES; i++) {
    const t = i / MARK_CANDIDATES;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;

    let nearest = Infinity;
    for (const route of ground) {
      const points = route.path.points;
      for (let p = 1; p < route.path.pointCount; p++) {
        const distance = distanceToSegment(
          x,
          y,
          points[(p - 1) * 2] as number,
          points[(p - 1) * 2 + 1] as number,
          points[p * 2] as number,
          points[p * 2 + 1] as number,
        );
        if (distance < nearest) nearest = distance;
      }
    }

    if (nearest > bestDistance) {
      bestDistance = nearest;
      best = { x, y };
    }
  }
  return best;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Road width. Wide enough to hold a spread pack, narrow enough to miss the plots. */
const ROAD_WIDTH = TILE_SIZE * 1.2;
const ROAD_EDGE = 3;
/* Desaturated on purpose: the environment stays quiet so enemies and
   projectiles own the bright colours (docs/GAME_DESIGN.md §16.1). */
const ROAD_FILL = 0x1a1f2e;
const ROAD_EDGE_COLOUR = 0x2c3245;

const ARROW_COLOUR = 0x98a0b8;
const ARROW_SPACING = TILE_SIZE * 1.5;
const ARROW_SIZE = TILE_SIZE * 0.16;
/** Pixels per second the arrows drift towards the core. */
const FLOW_SPEED = TILE_SIZE * 1.25;
/**
 * How close an arrow may come to one another route already shows. Wider than
 * half the spacing, so on any shared stretch the second route's arrows always
 * yield, whatever their phase.
 */
const ARROW_CLEARANCE = ARROW_SPACING * 0.6;
/** Arrows stop short of the spawn portal and the core, so neither marker is cluttered. */
const ARROW_MARGIN = TILE_SIZE * 0.75;
/**
 * The route matters most while the player is placing towers. Once enemies are
 * walking it they show the route themselves, and bright arrows underneath them
 * would compete with what the player actually needs to track.
 */
const ARROW_ALPHA_QUIET = 0.55;
const ARROW_ALPHA_BUSY = 0.15;
/** How quickly the arrows fade between the two, per second. */
const ALPHA_EASE_RATE = 4;

const AIR_COLOUR = 0x98a0b8;

const SPAWN_COLOUR = 0xd1495b;
const CORE_COLOUR = 0xe6e9f2;

/**
 * A line of arrows drifting along one route.
 *
 * Each arrow is a Graphics sharing a single pre-built chevron, and a frame only
 * moves and turns them. Redrawing the chevrons every frame instead would
 * re-tessellate every stroke sixty times a second — measurable on a CPU
 * rasteriser, where the whole frame budget is already spoken for.
 */
interface ArrowStream {
  length: number;
  /** Writes the position and heading `distance` along the route into `out`. */
  sampleAt(distance: number, out: PathSample): void;
  arrows: Graphics[];
}

export class RouteView {
  private readonly airLanes = new Graphics();
  private readonly airArrows = new Container();
  private readonly road = new Graphics();
  private readonly groundArrows = new Container();
  private readonly chevron = chevronContext();
  private streams: ArrowStream[] = [];
  /** Positions of the arrows shown so far this frame, interleaved x,y. */
  private shownAt = new Float32Array(0);
  private routes: RouteMap = { ground: [], flyers: [], spawns: [], core: { x: 0, y: 0 } };
  private arrowAlpha = ARROW_ALPHA_QUIET;
  private lastMs = -1;
  /** Reused so sampling a route per arrow allocates nothing. */
  private readonly sample: PathSample = { x: 0, y: 0, dirX: 0, dirY: 0 };

  constructor(layers: Layers) {
    /* The air lane goes under the road. Where it runs along the road flyers and
       walkers share the route, so the lane would add nothing there; covered by
       the road, it shows exactly where flyers take a different line. */
    layers.decals.addChild(this.airLanes);
    layers.decals.addChild(this.airArrows);
    layers.decals.addChild(this.road);
    layers.decals.addChild(this.groundArrows);
  }

  get routeMap(): RouteMap {
    return this.routes;
  }

  get currentArrowAlpha(): number {
    return this.arrowAlpha;
  }

  /** Arrows placed on the board, visible or not. */
  get arrowCount(): number {
    return this.airArrows.children.length + this.groundArrows.children.length;
  }

  /** Routes are fixed for the stage, so the road is drawn and the arrows made once. */
  sync(world: World): void {
    this.routes = describeRoutes(world);
    this.drawRoad();
    this.drawAirLanes();
    this.buildStreams();
  }

  /** `nowMs` drives the arrows only; it never reaches the simulation. */
  render(world: World, nowMs: number): void {
    const elapsed = this.lastMs < 0 ? 0 : Math.max(0, nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;

    const target = world.enemies.count > 0 ? ARROW_ALPHA_BUSY : ARROW_ALPHA_QUIET;
    this.arrowAlpha += (target - this.arrowAlpha) * Math.min(1, elapsed * ALPHA_EASE_RATE);
    this.groundArrows.alpha = this.arrowAlpha;
    this.airArrows.alpha = this.arrowAlpha;

    const phase = ((nowMs / 1000) * FLOW_SPEED) % ARROW_SPACING;
    const s = this.sample;
    let shownCount = 0;

    for (const stream of this.streams) {
      /* Only earlier routes are checked, so a route never hides its own arrows. */
      const earlier = shownCount;
      const end = stream.length - ARROW_MARGIN;

      for (let i = 0; i < stream.arrows.length; i++) {
        const arrow = stream.arrows[i] as Graphics;
        const distance = ARROW_MARGIN + phase + i * ARROW_SPACING;
        let shown = distance < end;
        if (shown) {
          stream.sampleAt(distance, s);
          shown = !this.nearShown(s.x, s.y, earlier);
        }
        if (arrow.visible !== shown) arrow.visible = shown;
        if (!shown) continue;

        arrow.position.set(s.x, s.y);
        arrow.rotation = Math.atan2(s.dirY, s.dirX);
        this.shownAt[shownCount * 2] = s.x;
        this.shownAt[shownCount * 2 + 1] = s.y;
        shownCount++;
      }
    }
  }

  /**
   * Whether an arrow another route already shows is too close to this point.
   *
   * Routes share stretches — a fork shares its start, a merge its end — and on
   * a stretch reached by different distances their arrows fall out of step and
   * double up. The first route to claim a stretch draws it; the others yield,
   * so every stretch of road carries one stream of arrows.
   */
  private nearShown(x: number, y: number, count: number): boolean {
    const limit = ARROW_CLEARANCE * ARROW_CLEARANCE;
    for (let k = 0; k < count; k++) {
      const dx = (this.shownAt[k * 2] as number) - x;
      const dy = (this.shownAt[k * 2 + 1] as number) - y;
      if (dx * dx + dy * dy < limit) return true;
    }
    return false;
  }

  private drawRoad(): void {
    const g = this.road;
    g.clear();

    /* Every edge before any fill, so where two routes share a stretch the
       second fill covers the first edge and they read as one road that forks,
       not two roads laid on top of each other. */
    for (const route of this.routes.ground) {
      tracePath(g, route.path);
      g.stroke({
        width: ROAD_WIDTH + ROAD_EDGE * 2,
        color: ROAD_EDGE_COLOUR,
        join: 'round',
        cap: 'round',
      });
    }
    for (const route of this.routes.ground) {
      tracePath(g, route.path);
      g.stroke({ width: ROAD_WIDTH, color: ROAD_FILL, join: 'round', cap: 'round' });
    }

    const core = this.routes.core;
    const r = TILE_SIZE * 0.45;
    g.moveTo(core.x + r, core.y);
    for (let i = 1; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      g.lineTo(core.x + Math.cos(angle) * r, core.y + Math.sin(angle) * r);
    }
    g.closePath()
      .fill({ color: CORE_COLOUR, alpha: 0.18 })
      .stroke({ width: 3, color: CORE_COLOUR, alpha: 0.85 });

    /* The bird sits with the road rather than the lane: it is placed clear of
       every road, and must stay visible wherever the lane is covered. */
    for (const lane of this.routes.flyers) {
      /* Lifted off the line so the arrows riding the lane never cross it. */
      const length = Math.hypot(lane.toX - lane.fromX, lane.toY - lane.fromY) || 1;
      const lift = TILE_SIZE * 0.5;
      const x = lane.markX + ((lane.toY - lane.fromY) / length) * lift;
      const y = lane.markY - ((lane.toX - lane.fromX) / length) * lift;
      bird(g, x, y, TILE_SIZE * 0.4);
      g.stroke({ width: 4, color: AIR_COLOUR, alpha: 0.8, cap: 'round', join: 'round' });
    }

    for (const spawn of this.routes.spawns) {
      g.circle(spawn.x, spawn.y, TILE_SIZE * 0.5).fill({ color: SPAWN_COLOUR, alpha: 0.15 });
      g.circle(spawn.x, spawn.y, TILE_SIZE * 0.5).stroke({
        width: 3,
        color: SPAWN_COLOUR,
        alpha: 0.9,
      });
      g.circle(spawn.x, spawn.y, TILE_SIZE * 0.28).stroke({
        width: 2,
        color: SPAWN_COLOUR,
        alpha: 0.6,
      });
    }
  }

  /**
   * A bare line rather than a road: flyers are not confined to anything, and
   * the difference has to read at a glance. The arrows riding it give the
   * direction; the line only holds them together as one lane.
   */
  private drawAirLanes(): void {
    const g = this.airLanes;
    g.clear();

    for (const lane of this.routes.flyers) {
      g.moveTo(lane.fromX, lane.fromY).lineTo(lane.toX, lane.toY);
    }
    g.stroke({ width: 2, color: AIR_COLOUR, alpha: 0.25 });
  }

  private buildStreams(): void {
    for (const parent of [this.airArrows, this.groundArrows]) {
      for (const child of parent.removeChildren()) child.destroy();
    }

    const streams: ArrowStream[] = [];
    for (const route of this.routes.ground) {
      const path = route.path;
      streams.push({
        length: path.totalLength,
        sampleAt: (distance, out) => void path.sample(distance, out),
        arrows: this.makeArrows(path.totalLength, this.groundArrows),
      });
    }
    for (const lane of this.routes.flyers) {
      const dx = lane.toX - lane.fromX;
      const dy = lane.toY - lane.fromY;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      const ux = dx / length;
      const uy = dy / length;
      streams.push({
        length,
        sampleAt: (distance, out) => {
          out.x = lane.fromX + ux * distance;
          out.y = lane.fromY + uy * distance;
          out.dirX = ux;
          out.dirY = uy;
        },
        arrows: this.makeArrows(length, this.airArrows),
      });
    }
    this.streams = streams;

    let total = 0;
    for (const stream of streams) total += stream.arrows.length;
    this.shownAt = new Float32Array(total * 2);
  }

  /** Enough arrows to fill the route at any phase; the spare one hides. */
  private makeArrows(length: number, parent: Container): Graphics[] {
    const count = Math.max(0, Math.ceil((length - ARROW_MARGIN * 2) / ARROW_SPACING));
    const arrows: Graphics[] = [];
    for (let i = 0; i < count; i++) {
      const arrow = new Graphics(this.chevron);
      parent.addChild(arrow);
      arrows.push(arrow);
    }
    return arrows;
  }

  destroy(): void {
    this.airLanes.destroy();
    this.airArrows.destroy({ children: true });
    this.road.destroy();
    this.groundArrows.destroy({ children: true });
    this.chevron.destroy();
  }
}

function tracePath(g: Graphics, path: BakedPath): void {
  const points = path.points;
  g.moveTo(points[0] as number, points[1] as number);
  for (let i = 1; i < path.pointCount; i++) {
    g.lineTo(points[i * 2] as number, points[i * 2 + 1] as number);
  }
}

/** An open chevron centred on the origin, pointing along +x. */
function chevronContext(): GraphicsContext {
  const s = ARROW_SIZE;
  return new GraphicsContext()
    .moveTo(-s, s)
    .lineTo(s, 0)
    .lineTo(-s, -s)
    .stroke({ width: 3, color: ARROW_COLOUR, join: 'round', cap: 'round' });
}

/** The two-arc doodle bird: understood as "flying" without a word of text. */
function bird(g: Graphics, x: number, y: number, size: number): void {
  g.moveTo(x - size, y - size * 0.3)
    .quadraticCurveTo(x - size * 0.45, y - size * 0.75, x, y + size * 0.15)
    .quadraticCurveTo(x + size * 0.45, y - size * 0.75, x + size, y - size * 0.3);
}
