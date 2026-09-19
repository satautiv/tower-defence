import { Application, Container, Rectangle } from 'pixi.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '@core/constants';
import { Camera } from './camera.js';
import { CameraController } from './input.js';
import { createLayerStack } from './layers.js';
import type { Layers } from './layers.js';
import { SOFTWARE_MAX_FPS, detectRendererSupport, showUnsupportedMessage } from './support.js';
import { TerrainCache, setContainerFactory } from './terrain.js';
import { clampResolution, fitViewport, readSafeAreaInsets } from './viewport.js';
import type { Viewport } from './viewport.js';

/**
 * Builds the render stack and wires it to the canvas.
 *
 * Scene graph:
 *
 *   stage
 *     root    <- letterbox: design resolution fitted to the real canvas
 *       world <- camera: pan and zoom over the map
 *         ... ten layers, back to front
 *
 * Two transforms rather than one, because they answer different questions.
 * The letterbox is "how does 1920x1080 fit this device", and it changes only on
 * resize. The camera is "what part of the map am I looking at", and it changes
 * constantly. Collapsing them would make every camera update also recompute
 * device fitting.
 */

export interface GameView {
  app: Application;
  /** Letterboxed root. Everything sits under this. */
  root: Container;
  /** Camera-transformed parent of the world layers. */
  world: Container;
  layers: Layers;
  camera: Camera;
  terrain: TerrainCache;
  controller: CameraController;
  /** Current letterbox fit. Replaced on resize. */
  readonly viewport: Viewport;
  destroy(): void;
}

export interface CreateViewOptions {
  mount: HTMLElement;
  background?: string;
  onTap?: (logicalX: number, logicalY: number) => void;
}

/**
 * Returns null when the device cannot render the game, after showing an
 * explanation in the mount point. Callers should treat null as "stop", not as
 * an error to retry.
 */
export async function createGameView(options: CreateViewOptions): Promise<GameView | null> {
  const { mount, background = '#0b0d14', onTap } = options;

  const support = detectRendererSupport();
  if (!support.supported) {
    showUnsupportedMessage(mount, support.message ?? 'This browser cannot run the game.');
    return null;
  }

  /*
   * A CPU rasteriser reports full WebGL2 support and then charges for every
   * pixel out of the frame budget of a core that also has to run the game.
   * Multisampling and a retina backing store are both pure fill-rate costs, so
   * they are dropped rather than paid: the alternative is not a slower game but
   * an unresponsive machine. The same trade is the right one on the weakest
   * devices in the matrix (#56), which is why it is not a local workaround.
   */
  const app = new Application();
  await app.init({
    background,
    resizeTo: mount,
    antialias: !support.software,
    autoDensity: true,
    resolution: support.software ? 1 : clampResolution(globalThis.devicePixelRatio ?? 1),
    preference: support.webgpu ? 'webgpu' : 'webgl',
  });
  mount.appendChild(app.canvas);

  /* Uncapped, the ticker takes every core it can reach. The fixed-timestep loop
     turns the longer frames into extra ticks, so the simulation is unchanged. */
  if (support.software) app.ticker.maxFPS = SOFTWARE_MAX_FPS;

  setContainerFactory(() => new Container());

  const root = new Container();
  root.label = 'root';
  app.stage.addChild(root);

  const { world, layers } = createLayerStack();
  root.addChild(world);

  const camera = new Camera();
  camera.setViewSize(LOGICAL_WIDTH, LOGICAL_HEIGHT);
  camera.setWorldSize(LOGICAL_WIDTH, LOGICAL_HEIGHT);
  camera.centreOnWorld();

  let viewport = fitViewport({ canvasWidth: mount.clientWidth, canvasHeight: mount.clientHeight });

  const applyViewport = (): void => {
    viewport = fitViewport({
      canvasWidth: mount.clientWidth,
      canvasHeight: mount.clientHeight,
      insets: readSafeAreaInsets(mount),
      devicePixelRatio: globalThis.devicePixelRatio ?? 1,
    });
    root.position.set(viewport.offsetX, viewport.offsetY);
    root.scale.set(viewport.scale);
    /* Clip to the design area so letterbox bars stay empty even if something
       is positioned outside the intended bounds. */
    root.boundsArea = new Rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  };
  applyViewport();

  const resizeObserver = new ResizeObserver(applyViewport);
  resizeObserver.observe(mount);

  const terrain = new TerrainCache({
    renderToTexture: (source, width, height) =>
      app.renderer.generateTexture({
        target: source,
        frame: new Rectangle(0, 0, width, height),
      }),
  });

  const controller = new CameraController({
    element: app.canvas,
    camera,
    getViewport: () => viewport,
    onTap,
  });
  controller.attach();

  /* The camera is mutated by input and by gameplay; pushing its transform once
     per frame keeps a single place where it reaches the scene graph. */
  const syncCamera = (): void => {
    const transform = camera.containerTransform();
    world.position.set(transform.x, transform.y);
    world.scale.set(transform.scale);
  };
  app.ticker.add(syncCamera);

  return {
    app,
    root,
    world,
    layers,
    camera,
    terrain,
    controller,
    get viewport() {
      return viewport;
    },
    destroy() {
      app.ticker.remove(syncCamera);
      resizeObserver.disconnect();
      controller.detach();
      terrain.release();
      app.destroy(true, { children: true });
    },
  };
}
