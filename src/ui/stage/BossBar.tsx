import type { ReactElement } from 'react';
import type { BossInfo } from '@sim/index';
import { useThrottledValue } from '../hooks/useThrottledValue.js';

export interface BossBarProps {
  read: () => BossInfo | null;
  nameOf: (enemyId: string) => string;
}

/**
 * Health is the only thing that moves, and it moves every tick, so it is
 * rounded to the bar's own resolution before being compared. Without that the
 * panel re-renders at the poll rate for a change of a tenth of a pixel.
 */
function sameBoss(a: BossInfo | null, b: BossInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.entityId === b.entityId &&
    a.phase === b.phase &&
    Math.round((a.hp / a.maxHp) * 200) === Math.round((b.hp / b.maxHp) * 200)
  );
}

/**
 * The boss health bar, with its phase markers (#33, GAME_DESIGN §10).
 *
 * The markers are the point, and they are drawn from the start rather than as
 * each one arrives: a boss fight is a fight the player is meant to *pace* —
 * hold the Warden Power for the transition, move the rally flag before the
 * bite — and a threshold that appeared only once it was reached would tell
 * them after the decision mattered.
 *
 * At the top of the screen rather than over the boss, because the boss is
 * frequently under a soldier, a pool and four projectiles, and this is the one
 * number the player must never lose track of.
 */
export function BossBar({ read, nameOf }: BossBarProps): ReactElement | null {
  const boss = useThrottledValue(read, undefined, sameBoss);
  if (boss === null) return null;

  const fraction = boss.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, boss.hp / boss.maxHp));

  return (
    <div
      className="ui-boss"
      data-testid="boss-bar"
      role="progressbar"
      aria-label={`${nameOf(boss.enemyId)} health`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div className="ui-boss__head">
        <span className="ui-boss__name">{nameOf(boss.enemyId)}</span>
        {boss.thresholds.length > 0 && (
          <span className="ui-boss__phase">
            Phase {boss.phase + 1} / {boss.thresholds.length + 1}
          </span>
        )}
      </div>
      <div className="ui-boss__track">
        <div className="ui-boss__fill" style={{ width: `${fraction * 100}%` }} />
        {/* Left to right, so a marker's position on screen is where the bar
            will be when it fires — a threshold at 0.5 sits at the half way
            point, which is the only reading a player will make of it. */}
        {boss.thresholds.map((threshold, index) => (
          <span
            key={threshold}
            className={`ui-boss__marker${index < boss.phase ? ' ui-boss__marker--passed' : ''}`}
            style={{ left: `${threshold * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
