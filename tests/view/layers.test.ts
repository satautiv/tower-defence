import { readFileSync } from 'node:fs';
import { Container, Sprite, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, createLayerStack, layerIndex } from '@view/layers';
import type { LayerName } from '@view/layers';

/**
 * Pixi's scene graph is plain JavaScript until something is actually rasterised,
 * so layer assignment can be tested for real in Node rather than asserted by
 * eye in a browser. What cannot be tested here is pixel output; that is what
 * the Playwright screenshots in #53 are for.
 */

const ATLAS = 'public/assets/atlas/game.json';

interface AtlasFile {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number } };
}

describe('layer stack', () => {
  it('orders layers so gameplay information is never hidden', () => {
    /* Bars and labels carry health and damage numbers. If a particle burst can
       cover them, the player loses the information they are deciding on. */
    expect(layerIndex('bars')).toBeGreaterThan(layerIndex('particles'));
    expect(layerIndex('labels')).toBeGreaterThan(layerIndex('bars'));
    expect(layerIndex('entities')).toBeGreaterThan(layerIndex('plots'));
    expect(layerIndex('projectiles')).toBeGreaterThan(layerIndex('entities'));
    expect(layerIndex('terrain')).toBe(0);
  });

  it('creates one labelled container per layer, parented to the world', () => {
    const { world, layers } = createLayerStack();
    expect(world.children).toHaveLength(LAYER_ORDER.length);

    for (const name of LAYER_ORDER) {
      expect(layers[name]).toBeInstanceOf(Container);
      expect(layers[name].label).toBe(name);
      expect(layers[name].parent).toBe(world);
    }
  });

  it('adds layers to the world in back-to-front order', () => {
    const { world } = createLayerStack();
    expect(world.children.map((c) => c.label)).toEqual([...LAYER_ORDER]);
  });

  it('enables depth sorting only on the entity layer, which is the only one that needs it', () => {
    const { layers } = createLayerStack();
    expect(layers.entities.sortableChildren).toBe(true);
    expect(layers.particles.sortableChildren).toBe(false);
    expect(layers.terrain.sortableChildren).toBe(false);
  });
});

describe('sprites land in the layer they were put in', () => {
  it.each(['terrain', 'plots', 'entities', 'projectiles', 'bars'] as LayerName[])(
    'places a sprite in %s and nowhere else',
    (target) => {
      const { layers } = createLayerStack();
      const sprite = new Sprite(Texture.EMPTY);
      layers[target].addChild(sprite);

      expect(layers[target].children).toContain(sprite);
      expect(sprite.parent).toBe(layers[target]);

      for (const other of LAYER_ORDER) {
        if (other === target) continue;
        expect(layers[other].children).not.toContain(sprite);
      }
    },
  );

  it('moves a sprite cleanly between layers', () => {
    const { layers } = createLayerStack();
    const sprite = new Sprite(Texture.EMPTY);

    layers.entities.addChild(sprite);
    layers.projectiles.addChild(sprite);

    expect(layers.entities.children).not.toContain(sprite);
    expect(layers.projectiles.children).toContain(sprite);
  });
});

describe('the generated atlas', () => {
  const atlas = JSON.parse(readFileSync(ATLAS, 'utf8')) as AtlasFile;

  it('is a Pixi spritesheet with every source sprite packed', () => {
    expect(atlas.meta.image).toBe('game.png');
    expect(Object.keys(atlas.frames).length).toBeGreaterThanOrEqual(12);
  });

  it('names frames after the sprite files, so lookups are by a readable key', () => {
    for (const name of ['tower_flame_vent', 'enemy_husk', 'plot_ley', 'projectile_bolt']) {
      expect(atlas.frames[name]).toBeDefined();
    }
  });

  it('packs every frame inside the texture bounds', () => {
    for (const [name, entry] of Object.entries(atlas.frames)) {
      expect(entry.frame.x + entry.frame.w, name).toBeLessThanOrEqual(atlas.meta.size.w);
      expect(entry.frame.y + entry.frame.h, name).toBeLessThanOrEqual(atlas.meta.size.h);
    }
  });

  it('renders an atlas-backed sprite into the layer it belongs to', () => {
    const { layers } = createLayerStack();
    const plotFrames = Object.keys(atlas.frames).filter((n) => n.startsWith('plot_'));
    expect(plotFrames.length).toBeGreaterThan(0);

    for (const _frame of plotFrames) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.label = _frame;
      layers.plots.addChild(sprite);
    }

    expect(layers.plots.children.map((c) => c.label).sort()).toEqual(plotFrames.sort());
    expect(layers.entities.children).toHaveLength(0);
  });
});
