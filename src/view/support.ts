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
  /** Player-facing explanation when unsupported. */
  message?: string;
}

/** Probing throws in some locked-down environments; treat that as unsupported. */
function hasWebgl2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function detectRendererSupport(): RendererSupport {
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

  const webgl2 = hasWebgl2();

  if (webgl2 || webgpu) return { supported: true, webgl2, webgpu };

  return {
    supported: false,
    webgl2,
    webgpu,
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
