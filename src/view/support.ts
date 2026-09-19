/**
 * Renderer capability detection.
 *
 * PixiJS v8 removed the Canvas2D fallback, so a browser without WebGL2 cannot
 * run the game at all. That has to be detected before initialising and reported
 * as a sentence a person can act on — a blank black canvas is the worst
 * possible way to deliver this news.
 */

export interface RendererSupport {
  supported: boolean;
  webgl2: boolean;
  webgpu: boolean;
  /** Unmasked GL renderer string, or 'unknown' when it cannot be read. */
  renderer: string;
  /** True when the CPU is drawing every pixel. See `isSoftwareRenderer`. */
  software: boolean;
  /** Player-facing explanation when unsupported. */
  message?: string;
}

/**
 * Renderer strings that mean there is no GPU behind the context.
 *
 * SwiftShader (Chrome), llvmpipe/softpipe/lavapipe (Mesa) and the Windows Basic
 * Render Driver all present a complete, conformant WebGL2 implementation that
 * runs entirely on the CPU. Capability detection therefore says yes, the game
 * starts, and then every pixel of a 1920x1080 scene is rasterised in software —
 * which saturates every core rather than merely dropping frames. On a small VM
 * that is the difference between a slow game and an unresponsive machine.
 */
const SOFTWARE_RENDERERS = [
  'swiftshader',
  'llvmpipe',
  'softpipe',
  'lavapipe',
  'software rasterizer',
  'microsoft basic render',
  'mesa offscreen',
  'apple software renderer',
];

export function isSoftwareRenderer(renderer: string): boolean {
  const lower = renderer.toLowerCase();
  return SOFTWARE_RENDERERS.some((name) => lower.includes(name));
}

/** Frame cap applied when rasterising on the CPU, where an uncapped ticker
 *  simply consumes every core it can reach. The fixed-timestep loop absorbs
 *  the longer frames as extra ticks, so the simulation is unaffected. */
export const SOFTWARE_MAX_FPS = 30;

interface Probe {
  webgl2: boolean;
  renderer: string;
}

/** Probing throws in some locked-down environments; treat that as unsupported. */
function probe(): Probe {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl === null) return { webgl2: false, renderer: 'unknown' };

    /* The unmasked string is the one that names the real driver; the plain
       RENDERER parameter is generic enough to hide a software fallback. */
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer =
      debug === null
        ? gl.getParameter(gl.RENDERER)
        : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);

    return { webgl2: true, renderer: String(renderer ?? 'unknown') };
  } catch {
    return { webgl2: false, renderer: 'unknown' };
  }
}

export function detectRendererSupport(): RendererSupport {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  const { webgl2, renderer } = probe();
  const software = isSoftwareRenderer(renderer);

  if (webgl2 || webgpu) return { supported: true, webgl2, webgpu, renderer, software };

  return {
    supported: false,
    webgl2,
    webgpu,
    renderer,
    software,
    message:
      'This game needs WebGL2, which this browser does not support. ' +
      'Updating to a recent version of Chrome, Firefox, Edge or Safari should fix it. ' +
      'If you are on a desktop, check that hardware acceleration is enabled.',
  };
}

/** Renders the unsupported message into the mount point, in place of the game. */
export function showUnsupportedMessage(mount: HTMLElement, message: string): void {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'height:100%',
    'padding:24px',
    'box-sizing:border-box',
    'color:#c8cbd9',
    'background:#0b0d14',
    'font:16px/1.6 system-ui,sans-serif',
    'text-align:center',
  ].join(';');

  const inner = document.createElement('p');
  inner.style.maxWidth = '42ch';
  inner.textContent = message;
  panel.appendChild(inner);
  mount.appendChild(panel);
}
