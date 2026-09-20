import type { ReactElement } from 'react';
import type { PowerOption } from '@sim/index';
import { Button, INTERACTIVE, cx } from '../components/index.js';

export interface PowerBarProps {
  powers: readonly PowerOption[];
  /** Index of the power awaiting a target tap, or -1. */
  armed: number;
  onArm: (index: number) => void;
  /** Paused: the bar reads, nothing casts. */
  locked?: boolean;
  /** Resolves a power id to its display name. */
  name: (powerId: string) => string;
}

/**
 * The Warden Powers, along the bottom of the board.
 *
 * Every power is shown whether or not it can be cast, because the bar is how a
 * player learns what they have and what it costs. Greying one out teaches the
 * price; hiding it teaches nothing, and a player who has never seen Aether
 * Siphon will never save fifty Aether for it.
 *
 * The cost sits on the face rather than in a tooltip: tooltips do not exist on
 * touch, and "can I afford this yet" is the question being asked every few
 * seconds.
 */
export function PowerBar({
  powers,
  armed,
  onArm,
  locked = false,
  name,
}: PowerBarProps): ReactElement | null {
  if (powers.length === 0) return null;

  return (
    <div className={cx(INTERACTIVE, 'ui-powers')} data-testid="power-bar">
      {powers.map((power) => {
        const isArmed = armed === power.index;
        const cooling = power.cooldownRemaining > 0;

        return (
          <Button
            key={power.id}
            variant={isArmed ? 'primary' : 'secondary'}
            className="ui-powers__slot"
            disabled={!power.ready}
            aria-disabled={locked || undefined}
            aria-pressed={isArmed}
            title={locked ? 'Resume to cast' : undefined}
            onClick={() => {
              if (!locked && power.ready) onArm(power.index);
            }}
          >
            <span className="ui-powers__name">{name(power.id)}</span>
            {/* While it cools, the countdown replaces the price: what the
                player needs to know has changed, and showing both is noise. */}
            <span className={cx('ui-powers__cost', cooling && 'ui-powers__cost--cooling')}>
              {cooling ? `${power.cooldownRemaining}s` : `${power.cost} ae`}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
