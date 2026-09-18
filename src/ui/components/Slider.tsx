import type { ReactElement } from 'react';
import { INTERACTIVE, cx } from './classNames.js';

export interface SliderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  /** Rendered beside the label, e.g. "80%". */
  format?: (value: number) => string;
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  format,
}: SliderProps): ReactElement {
  return (
    <label className={cx(INTERACTIVE, 'ui-slider')}>
      <span className="ui-slider__label">
        {label}
        {format !== undefined && <span className="ui-slider__value">{format(value)}</span>}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ui-slider__input"
      />
    </label>
  );
}
