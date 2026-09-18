import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  children: ReactNode;
}

/** A surface that sits over the board: tower info, wave preview, build menu. */
export function Panel({ title, className, children, ...rest }: PanelProps): ReactElement {
  return (
    <section className={cx(INTERACTIVE, 'ui-panel', className)} {...rest}>
      {title !== undefined && <h2 className="ui-panel__title">{title}</h2>}
      <div className="ui-panel__body">{children}</div>
    </section>
  );
}
