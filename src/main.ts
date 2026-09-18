import { Application, RendererType } from 'pixi.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@core/constants';

/**
 * Minimal entry point: proves the toolchain and mounts a canvas.
 * Real bootstrapping — scaling, the layer stack, camera and asset loading —
 * is issue #7; the screen router is issue #8.
 */
async function main(): Promise<void> {
  const mount = document.getElementById('game');
  if (!mount) throw new Error('#game mount point missing from index.html');

  const app = new Application();
  await app.init({
    background: '#0b0d14',
    resizeTo: mount,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(globalThis.devicePixelRatio ?? 1, 2),
  });

  mount.appendChild(app.canvas);

  console.info(
    `Aetherfall — Pixi ${RendererType[app.renderer.type] ?? 'unknown'} renderer up, ` +
      `design resolution ${LOGICAL_WIDTH}x${LOGICAL_HEIGHT}`,
  );
}

void main();
