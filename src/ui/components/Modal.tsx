import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A blocking dialog. Used for settings and confirmations — never during a wave,
 * where interrupting the player is a design failure (docs/GAME_DESIGN.md §17.3).
 *
 * The backdrop re-enables pointer events deliberately: while a modal is open it
 * should swallow clicks rather than let them reach the board underneath.
 */
export function Modal({ open, title, onClose, children }: ModalProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cx(INTERACTIVE, 'ui-modal__backdrop')}
      onClick={onClose}
      role="presentation"
      data-testid="modal-backdrop"
    >
      <div
        ref={dialogRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="ui-modal__title">{title}</h2>
        <div className="ui-modal__body">{children}</div>
      </div>
    </div>
  );
}
