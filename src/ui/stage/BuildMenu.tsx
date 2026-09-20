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
  /** Resolves a tower id to its display name. */
  name: (towerId: string) => string;
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
/** The second ring, for a roster too big to fit on one. */
const OUTER_RADIUS = 184;
/** Most cards one arc holds before a second ring reads better than a crush. */
const PER_RING = 4;
/** Opens upward, so the choices are never hidden under the hand. */
const ARC_START = -Math.PI * 0.85;
const ARC_END = -Math.PI * 0.15;

/**
 * Lays the options out on one arc or two.
 *
 * Three towers fitted on a single arc comfortably; eight do not, and naming
 * them made each card wider still. A larger radius would have kept one ring at
 * the cost of the thing the arc exists for — the plot is under the thumb, and
 * sending the player's hand 300px away turns every build into a two-handed
 * operation (§17.1). Two shorter rings keep it where the hand already is.
 */
export function arcLayout(count: number, index: number): { angle: number; radius: number } {
  const rings = count > PER_RING ? 2 : 1;
  const perRing = Math.ceil(count / rings);

  const ring = Math.floor(index / perRing);
  const within = index % perRing;
  /* The last ring may be short; it is spread across the same arc so the two
     read as concentric rather than as one arc and a gap. */
  const inRing = ring === rings - 1 ? count - perRing * ring : perRing;

  const t = inRing === 1 ? 0.5 : within / (inRing - 1);
  return {
    angle: ARC_START + (ARC_END - ARC_START) * t,
    radius: ring === 0 ? ARC_RADIUS : OUTER_RADIUS,
  };
}

/**
 * Room the arcs need above the plot before they will open upward.
 *
 * The radius plus the height of a button and its label. Below this the arc
 * flips downward instead: a playtester tapping a plot near the top of the
 * screen lost one option entirely and had the other two clipped, because the
 * arc always opened up and nothing clamped it to the viewport.
 */
const ARC_CLEARANCE = OUTER_RADIUS + 56;

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
  name,
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
        const { angle, radius } = arcLayout(count, index);

        return (
          <div
            key={option.id}
            className="ui-build__slot"
            style={{
              transform: `translate(${Math.cos(angle) * radius}px, ${Math.sin(angle) * radius * flip}px)`,
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
              {/* Named, because a coloured dot and a price is not a choice.
                  Both playtesters said the same thing unprompted: "the tower
                  choices have no name or description, just a colored dot" —
                  and that was with three towers, not eight. */}
              <span className="ui-build__name">{name(option.id)}</span>
              <span className={`ui-build__type ui-type--${option.stats.damageType}`} />
              <span className="ui-build__cost">{option.cost}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}
