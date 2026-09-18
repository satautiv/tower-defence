import type { Container, Texture } from 'pixi.js';

/**
 * Caches a stage's static map art as a single texture.
 *
 * Terrain is hundreds of tiles and props that never change during a stage.
 * Drawing them every frame would spend most of the render budget redrawing an
 * identical image; drawing them once into a texture turns the whole map into
 * one sprite and one draw call.
 *
 * The renderer is injected rather than reached for, so the "renders once per
 * stage" guarantee can be asserted without a GPU.
 */
export interface TerrainRenderer {
  /** Rasterises a container into a texture sized to the given extent. */
  renderToTexture(source: Container, width: number, height: number): Texture;
}

export class TerrainCache {
  private readonly renderer: TerrainRenderer;
  private cached?: { stageId: string; texture: Texture };
  private renders = 0;

  constructor(renderer: TerrainRenderer) {
    this.renderer = renderer;
  }

  /**
   * Returns the baked texture for a stage, rasterising only on a cache miss.
   * `draw` populates a container with the stage's static art.
   */
  textureFor(
    stageId: string,
    draw: (into: Container) => Container,
    width: number,
    height: number,
  ): Texture {
    const hit = this.cached;
    if (hit !== undefined && hit.stageId === stageId) return hit.texture;

    this.release();
    const source = draw(createDetachedContainer());
    const texture = this.renderer.renderToTexture(source, width, height);
    this.renders++;
    this.cached = { stageId, texture };
    return texture;
  }

  /** Rasterisations performed. Should be one per distinct stage, ever. */
  get renderCount(): number {
    return this.renders;
  }

  get cachedStageId(): string | undefined {
    return this.cached?.stageId;
  }

  /** Drops the cached texture, freeing its GPU memory. */
  release(): void {
    this.cached?.texture.destroy(true);
    this.cached = undefined;
  }
}

/**
 * Indirection so this module does not import Pixi's Container at runtime,
 * keeping it constructible in a plain Node test. Replaced with the real factory
 * by the caller during application setup.
 */
let containerFactory: () => Container = () => {
  throw new Error('TerrainCache: call setContainerFactory before baking terrain');
};

export function setContainerFactory(factory: () => Container): void {
  containerFactory = factory;
}

function createDetachedContainer(): Container {
  return containerFactory();
}
