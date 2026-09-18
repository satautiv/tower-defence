import { Assets, Sprite } from 'pixi.js';
import type { Spritesheet } from 'pixi.js';
import { TILE_SIZE } from '@core/constants';
import { loadContent } from '@content/load';
import { createGameView, initAssets, loadBundle } from '@view/index';

/**
 * Entry point.
 *
 * Brings up the render stack, loads the atlas and places a few sprites so the
 * layer ordering and camera are visible. There is no simulation yet — the world
 * and its systems arrive with #10, and the screen router with #8.
 */

const ATLAS_BUNDLE = 'core';

async function main(): Promise<void> {
  const mount = document.getElementById('game');
  if (!mount) throw new Error('#game mount point missing from index.html');

  const view = await createGameView({
    mount,
    onTap: (x, y) => {
      const world = view?.camera.screenToWorld(x, y);
      if (world) console.info(`tap at world ${world.x.toFixed(0)}, ${world.y.toFixed(0)}`);
    },
  });
  /* Null means the device cannot render the game; the message is already on
     screen, so stop rather than failing louder. */
  if (view === null) return;

  await initAssets({
    bundles: [{ name: ATLAS_BUNDLE, assets: [{ alias: 'game', src: 'assets/atlas/game.json' }] }],
  });
  await loadBundle(ATLAS_BUNDLE, ({ fraction }) => {
    if (fraction >= 1) console.info('assets ready');
  });

  const atlas = Assets.get<Spritesheet>('game');
  const content = loadContent();
  const stage = content.stages.get('1-1');
  if (stage === undefined) throw new Error('stage 1-1 missing from content');

  view.camera.setWorldSize(stage.widthTiles * TILE_SIZE, stage.heightTiles * TILE_SIZE);
  view.camera.centreOnWorld();

  /* Build plots into the plots layer, so the stack ordering is visible before
     there is anything else to draw. */
  for (const plot of stage.plots) {
    const texture = atlas.textures[plot.leyNode === undefined ? 'plot_empty' : 'plot_ley'];
    if (texture === undefined) continue;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(plot.position.x * TILE_SIZE, plot.position.y * TILE_SIZE);
    view.layers.plots.addChild(sprite);
  }

  console.info(
    `Aetherfall — ${stage.plots.length} plots on ${stage.id}, ` +
      `${Object.keys(atlas.textures).length} atlas frames, ` +
      `viewport scale ${view.viewport.scale.toFixed(3)}`,
  );
}

void main();
