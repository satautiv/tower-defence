import { Container } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerrainCache, setContainerFactory } from '@view/terrain';
import type { TerrainRenderer } from '@view/terrain';

/**
 * Terrain is the one thing on screen that provably never changes during a
 * stage. Baking it into a single texture is worth a test of its own because
 * the failure mode is invisible: if the cache misses, the game still looks
 * correct and simply spends a large part of its frame budget redrawing an
 * identical image.
 */

function countingRenderer(): TerrainRenderer & { calls: number } {
  return {
    calls: 0,
    renderToTexture(_source: Container, _width: number, _height: number): Texture {
      this.calls++;
      /* A real Texture needs a GPU; only identity and destroy() matter here. */
      return { destroy: vi.fn() } as unknown as Texture;
    },
  };
}

const drawStage = (into: Container): Container => into;

describe('TerrainCache', () => {
  beforeEach(() => {
    setContainerFactory(() => new Container());
  });

  it('rasterises exactly once for a stage, however often it is asked', () => {
    const renderer = countingRenderer();
    const cache = new TerrainCache(renderer);

    for (let frame = 0; frame < 600; frame++) {
      cache.textureFor('1-1', drawStage, 1920, 1080);
    }

    expect(cache.renderCount).toBe(1);
    expect(renderer.calls).toBe(1);
  });

  it('returns the identical texture on a cache hit', () => {
    const cache = new TerrainCache(countingRenderer());
    const first = cache.textureFor('1-1', drawStage, 1920, 1080);
    const second = cache.textureFor('1-1', drawStage, 1920, 1080);
    expect(second).toBe(first);
  });

  it('rasterises again for a different stage, once', () => {
    const cache = new TerrainCache(countingRenderer());
    cache.textureFor('1-1', drawStage, 1920, 1080);
    cache.textureFor('1-2', drawStage, 1920, 1080);
    cache.textureFor('1-2', drawStage, 1920, 1080);

    expect(cache.renderCount).toBe(2);
    expect(cache.cachedStageId).toBe('1-2');
  });

  it('frees the previous texture when the stage changes, rather than leaking it', () => {
    const cache = new TerrainCache(countingRenderer());
    const first = cache.textureFor('1-1', drawStage, 1920, 1080);
    cache.textureFor('1-2', drawStage, 1920, 1080);
    expect(first.destroy).toHaveBeenCalledWith(true);
  });

  it('frees the texture on release and re-bakes if asked again', () => {
    const cache = new TerrainCache(countingRenderer());
    const texture = cache.textureFor('1-1', drawStage, 1920, 1080);
    cache.release();

    expect(texture.destroy).toHaveBeenCalledWith(true);
    expect(cache.cachedStageId).toBeUndefined();

    cache.textureFor('1-1', drawStage, 1920, 1080);
    expect(cache.renderCount).toBe(2);
  });

  it('passes the requested extent to the renderer', () => {
    const renderer = countingRenderer();
    const spy = vi.spyOn(renderer, 'renderToTexture');
    new TerrainCache(renderer).textureFor('1-1', drawStage, 1280, 720);
    expect(spy).toHaveBeenCalledWith(expect.anything(), 1280, 720);
  });

  it('gives the draw callback a fresh container each bake', () => {
    const cache = new TerrainCache(countingRenderer());
    const seen: Container[] = [];
    const draw = (into: Container): Container => {
      seen.push(into);
      return into;
    };

    cache.textureFor('1-1', draw, 100, 100);
    cache.textureFor('1-2', draw, 100, 100);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
  });
});
