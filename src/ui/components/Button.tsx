import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * A key that does the same thing. Announced to assistive technology, and
   * drawn on the button where there is a keyboard to use it.
   */
  shortcut?: { label: string; aria: string };
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  shortcut,
  className,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={cx(INTERACTIVE, 'ui-button', `ui-button--${variant}`, className)}
      aria-keyshortcuts={shortcut?.aria}
      {...rest}
    >
      {children}
      {shortcut !== undefined && (
        <kbd className="ui-kbd" aria-hidden="true">
          {shortcut.label}
        </kbd>
      )}
    </button>
  );
}
