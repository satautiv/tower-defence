import { Container } from 'pixi.js';

/**
 * The render layer stack (docs/TECH_DESIGN.md §9.2), back to front.
 *
 * Order is a gameplay concern, not decoration: health bars and damage numbers
 * must never be hidden behind a particle burst, and the player must always be
 * able to see what is standing on a build plot. Fixing the order here means no
 * individual sprite needs to reason about z-index.
 */
export const LAYER_ORDER = [
  /** Static map art. Rendered once into a texture and never redrawn. */
  'terrain',
  /** Path decals and ley-line glow. */
  'decals',
  /** Lingering pools, fields, lava. */
  'groundEffects',
  /** Build plots and range previews. */
  'plots',
  'shadows',
  /** Enemies, towers, soldiers, the hero. Sorted by y for depth. */
  'entities',
  'projectiles',
  'particles',
  /** Health bars and status icons. */
  'bars',
  /** Damage numbers and floating reaction labels. */
  'labels',
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

/** Layers that move with the camera. The rest are screen-fixed. */
const WORLD_LAYERS: ReadonlySet<LayerName> = new Set<LayerName>(LAYER_ORDER);

export type Layers = Record<LayerName, Container>;

export interface LayerStack {
  /** Parent of every world layer. The camera transform is applied here. */
  world: Container;
  layers: Layers;
}

export function createLayerStack(): LayerStack {
  const world = new Container();
  world.label = 'world';

  const layers = {} as Layers;
  for (const name of LAYER_ORDER) {
    const container = new Container();
    container.label = name;
    /* Only the entity layer pays for depth sorting; everything else is
       naturally ordered by insertion. */
    container.sortableChildren = name === 'entities';
    layers[name] = container;
    if (WORLD_LAYERS.has(name)) world.addChild(container);
  }

  return { world, layers };
}

/** Index of a layer in the stack, for assertions and debugging. */
export function layerIndex(name: LayerName): number {
  return LAYER_ORDER.indexOf(name);
}
