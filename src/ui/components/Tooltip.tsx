import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export interface TooltipProps {
  content: string;
  children: ReactNode;
}

/**
 * Shows on hover and on focus, and on touch via long-press handled by the
 * caller. Hover-only information is unavailable to anyone playing with a thumb,
 * so tooltips never carry anything the player needs (docs/GAME_DESIGN.md §18).
 */
export function Tooltip({ content, children }: TooltipProps): ReactElement {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={cx(INTERACTIVE, 'ui-tooltip')}
      onPointerEnter={() => setVisible(true)}
      onPointerLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="ui-tooltip__bubble" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
