import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export interface InteractiveProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Re-enables pointer events for an ad-hoc region that is not a primitive. */
export function Interactive({ className, children, ...rest }: InteractiveProps): ReactElement {
  return (
    <div className={cx(INTERACTIVE, className)} {...rest}>
      {children}
    </div>
  );
}
