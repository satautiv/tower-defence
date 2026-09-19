import type { ReactElement } from 'react';
import type { BuildOption } from '@sim/index';
import { Button, INTERACTIVE, cx } from '../components/index.js';

export interface BuildMenuProps {
  options: readonly BuildOption[];
  /** Screen position of the plot, in CSS pixels within the overlay. */
  at: { x: number; y: number };
  onBuild: (typeIdx: number) => void;
  onCancel: () => void;
  onHover: (typeIdx: number) => void;
}

/**
 * The build menu, arranged on an arc around the tapped plot.
 *
 * An arc rather than a list at the screen edge: on a phone the plot is already
 * under the thumb, and sending the player to a corner to choose a tower turns
 * every build into a two-handed operation (docs/GAME_DESIGN.md §17.1). The same
 * layout works with a mouse, where it simply means less travel.
 */
const ARC_RADIUS = 96;
/** Opens upward, so the choices are never hidden under the hand. */
const ARC_START = -Math.PI * 0.85;
const ARC_END = -Math.PI * 0.15;

export function BuildMenu({
  options,
  at,
  onBuild,
  onCancel,
  onHover,
}: BuildMenuProps): ReactElement {
  const count = Math.max(1, options.length);

  return (
    <div className="ui-build" style={{ left: at.x, top: at.y }}>
      {/* Catches a tap anywhere else, which is how the menu is dismissed. */}
      <div
        className={cx(INTERACTIVE, 'ui-build__scrim')}
        onPointerDown={onCancel}
        role="presentation"
      />

      {options.map((option, index) => {
        const t = count === 1 ? 0.5 : index / (count - 1);
        const angle = ARC_START + (ARC_END - ARC_START) * t;

        return (
          <div
            key={option.id}
            className="ui-build__slot"
            style={{
              transform: `translate(${Math.cos(angle) * ARC_RADIUS}px, ${Math.sin(angle) * ARC_RADIUS}px)`,
            }}
          >
            <Button
              variant={option.affordable ? 'primary' : 'secondary'}
              disabled={!option.affordable}
              onClick={() => onBuild(option.typeIdx)}
              onPointerEnter={() => onHover(option.typeIdx)}
              onFocus={() => onHover(option.typeIdx)}
              className="ui-build__card"
              aria-label={`Build ${option.id} for ${option.cost} gold`}
            >
              <span className={`ui-build__type ui-type--${option.stats.damageType}`} />
              <span className="ui-build__cost">{option.cost}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
