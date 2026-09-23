import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { ReplayHeader, World } from '@sim/index';
import { DevOverlay } from './DevOverlay.jsx';
import { StageDevtools } from './overlay.js';

/**
 * The overlay's whole entry point, and the only name the stage screen knows.
 *
 * It owns the `StageDevtools` instance rather than being handed one, and hands
 * it back through `onReady`. That inversion is deliberate: the stage screen
 * ships, so it must not name a devtools type anywhere — not even in a type
 * position, because a ban with an exception for types is a ban somebody
 * eventually launders a value through. Receiving the instance through a
 * callback means TypeScript infers it from this side of the boundary and the
 * shipping file describes only the handful of methods its ticker calls.
 *
 * The `~` binding lives here for the same reason. It is not a game shortcut,
 * it does not belong in `keys.ts` beside the ones a player can rebind, and a
 * production build has nothing to bind it to.
 */

export interface DevPanelProps {
  /** Called once with the instance the ticker should drive. */
  onReady: (dev: StageDevtools) => void;
  /** Called when the screen goes away, so the debug layer is let go. */
  onTeardown: () => void;
  world: () => World | null;
  replayHeader: () => ReplayHeader | null;
}

export function DevPanel({
  onReady,
  onTeardown,
  world,
  replayHeader,
}: DevPanelProps): ReactElement {
  /* Created once for the life of the screen. A lazy initialiser rather than a
     ref, because StrictMode double-invokes a render and two overlays would
     both add a Graphics to the labels layer. */
  const [dev] = useState(() => new StageDevtools());

  useEffect(() => {
    onReady(dev);

    const onKey = (event: KeyboardEvent): void => {
      /* Both, because the key is `~` on the cap and "`" without Shift, and a
         binding that needed Shift would be a binding nobody remembers. */
      if (event.key !== '`' && event.key !== '~') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && isTyping(target)) return;
      event.preventDefault();
      dev.toggleVisible();
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      onTeardown();
    };
  }, [dev, onReady, onTeardown]);

  return <DevOverlay dev={dev} world={world} replayHeader={replayHeader} />;
}

function isTyping(element: HTMLElement): boolean {
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || element.isContentEditable;
}
