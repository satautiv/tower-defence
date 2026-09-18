import { Assets, Sprite } from 'pixi.js';
import type { Spritesheet } from 'pixi.js';
import { TILE_SIZE } from '@core/constants';
import { loadContent } from '@content/load';
import { initAssets, loadBundle } from '@view/assets';
import type { GameView } from '@view/app';

/**
 * Temporary scaffolding: draws a stage's build plots so the render stack has
 * something visible to show.
 *
 * Replaced by the real stage loader in #15 and #19, which will build terrain,
 * paths and entities from the same content. Kept here rather than in the entry
 * point so the screen owns what appears on it.
 */

const ATLAS_BUNDLE = 'core';

export async function drawStagePreview(view: GameView, stageId: string): Promise<void> {
  await initAssets({
    bundles: [{ name: ATLAS_BUNDLE, assets: [{ alias: 'game', src: 'assets/atlas/game.json' }] }],
  });
  await loadBundle(ATLAS_BUNDLE);

  const atlas = Assets.get<Spritesheet>('game');
  const stage = loadContent().stages.get(stageId);
  if (stage === undefined || atlas === undefined) return;

  view.camera.setWorldSize(stage.widthTiles * TILE_SIZE, stage.heightTiles * TILE_SIZE);
  view.camera.centreOnWorld();

  for (const plot of stage.plots) {
    const texture = atlas.textures[plot.leyNode === undefined ? 'plot_empty' : 'plot_ley'];
    if (texture === undefined) continue;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(plot.position.x * TILE_SIZE, plot.position.y * TILE_SIZE);
    view.layers.plots.addChild(sprite);
  }
}
