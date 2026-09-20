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
  /** Paused: the options still preview their range, but build nothing. */
  locked?: boolean;
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

/**
 * Room the arc needs above the plot before it will open upward.
 *
 * The radius plus the height of a button and its label. Below this the arc
 * flips downward instead: a playtester tapping a plot near the top of the
 * screen lost one option entirely and had the other two clipped, because the
 * arc always opened up and nothing clamped it to the viewport.
 */
const ARC_CLEARANCE = ARC_RADIUS + 56;

/** Whether the arc has to flip below the plot to stay on screen. */
export function opensDownward(plotY: number, clearance = ARC_CLEARANCE): boolean {
  return plotY < clearance;
}

export function BuildMenu({
  options,
  at,
  onBuild,
  onCancel,
  onHover,
  locked = false,
}: BuildMenuProps): ReactElement {
  const count = Math.max(1, options.length);
  /* Mirrored through the horizontal, so the order the player reads left to
     right is the same either way round. */
  const flip = opensDownward(at.y) ? -1 : 1;

  return (
    <div className="ui-build" style={{ left: at.x, top: at.y }}>
      {/* Catches a tap anywhere else, which is how the menu is dismissed. */}
      <div
        className={cx(INTERACTIVE, 'ui-build__scrim')}
        onPointerDown={onCancel}
        role="presentation"
      />

      {/* A rejected build must say why. Silence reads as a frozen game — a
          playtester paused to plan, clicked a tower, got nothing at all, and
          thought it had hung. The `title` alone did not carry: a tooltip does
          not exist on touch. */}
      {locked && (
        <div className="ui-build__locked" role="status">
          Paused — resume to build
        </div>
      )}

      {options.map((option, index) => {
        const t = count === 1 ? 0.5 : index / (count - 1);
        const angle = ARC_START + (ARC_END - ARC_START) * t;

        return (
          <div
            key={option.id}
            className="ui-build__slot"
            style={{
              transform: `translate(${Math.cos(angle) * ARC_RADIUS}px, ${Math.sin(angle) * ARC_RADIUS * flip}px)`,
            }}
          >
            <Button
              variant={option.affordable && !locked ? 'primary' : 'secondary'}
              disabled={!option.affordable}
              aria-disabled={locked || undefined}
              title={locked ? 'Resume to build' : undefined}
              onClick={() => {
                if (!locked) onBuild(option.typeIdx);
              }}
              onPointerEnter={() => onHover(option.typeIdx)}
              onFocus={() => onHover(option.typeIdx)}
              className="ui-build__card"
              shortcut={
                index < 9 ? { label: String(index + 1), aria: String(index + 1) } : undefined
              }
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
