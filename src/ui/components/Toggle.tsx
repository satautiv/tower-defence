import type { ReactElement } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

export function Toggle({ label, checked, onChange, description }: ToggleProps): ReactElement {
  return (
    <label className={cx(INTERACTIVE, 'ui-toggle')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="ui-toggle__input"
      />
      <span className="ui-toggle__text">
        <span className="ui-toggle__label">{label}</span>
        {description !== undefined && <span className="ui-toggle__description">{description}</span>}
      </span>
    </label>
  );
}
