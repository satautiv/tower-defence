import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  className,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={cx(INTERACTIVE, 'ui-button', `ui-button--${variant}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
