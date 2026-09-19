import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { createGameView } from '@view/app';
import type { GameView } from '@view/app';

/**
 * Owns the renderer's lifetime.
 *
 * React mounts and unmounts this as the player moves between screens, and each
 * time it creates or destroys the whole Pixi application. A renderer left alive
 * behind a menu keeps a WebGL context, its textures and a ticker running for a
 * screen nobody is looking at — and browsers cap how many WebGL contexts a page
 * may hold, so leaking them eventually kills the canvas outright.
 *
 * Creation is asynchronous, which means a fast unmount can resolve after the
 * component is gone. The cancelled flag handles that, and also React's
 * development StrictMode, which mounts every effect twice on purpose to catch
 * exactly this class of bug.
 */
export interface GameCanvasProps {
  onReady?: (view: GameView) => void;
  onUnsupported?: () => void;
  /** A press that never became a drag, in design-space coordinates. */
  onTap?: (logicalX: number, logicalY: number) => void;
}

export function GameCanvas({ onReady, onUnsupported, onTap }: GameCanvasProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  const unsupportedRef = useRef(onUnsupported);
  const tapRef = useRef(onTap);

  useEffect(() => {
    readyRef.current = onReady;
    unsupportedRef.current = onUnsupported;
    tapRef.current = onTap;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let view: GameView | null = null;
    let cancelled = false;

    void (async () => {
      /* Routed through a ref so a changing handler never re-runs this effect
         and tears the renderer down. */
      const created = await createGameView({
        mount: host,
        onTap: (x, y) => tapRef.current?.(x, y),
      });
      if (cancelled) {
        /* Unmounted while initialising. Destroy immediately rather than leaving
           an orphaned renderer with no component to tear it down. */
        created?.destroy();
        return;
      }
      if (created === null) {
        unsupportedRef.current?.();
        return;
      }
      view = created;
      readyRef.current?.(created);
    })();

    return () => {
      cancelled = true;
      view?.destroy();
      view = null;
    };
  }, []);

  return <div ref={hostRef} className="game-canvas-host" data-testid="game-canvas-host" />;
}
