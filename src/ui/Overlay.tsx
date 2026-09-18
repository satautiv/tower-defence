import type { ReactElement, ReactNode } from 'react';

/**
 * The DOM layer above the canvas.
 *
 * Covers the board completely, so it must not absorb clicks: `.ui-overlay` sets
 * `pointer-events: none` and each control opts back in. Without that, an
 * invisible div would swallow every attempt to select a build plot and the game
 * would be unplayable while looking perfectly fine.
 */
export function Overlay({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="ui-overlay" data-testid="ui-overlay">
      {children}
    </div>
  );
}
