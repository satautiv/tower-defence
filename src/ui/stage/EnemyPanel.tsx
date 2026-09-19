import type { ReactElement } from 'react';
import type { EnemyInfo } from '@sim/index';
import type { AtlasIndex } from '@view/assets';
import { Button, Panel } from '../components/index.js';
import { SpriteIcon } from './SpriteIcon.js';
import { THREAT_LABEL } from './threats.js';

export interface EnemyPanelProps {
  enemy: EnemyInfo;
  atlas: AtlasIndex | null;
  nameOf: (enemyId: string) => string;
  statusOf: (statusId: string) => string;
  onClose: () => void;
}

const round = (value: number): string =>
  value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');

/** A value beside what it started as, when something has changed it. */
function Modified({ now, base }: { now: number; base: number }): ReactElement {
  if (Math.abs(now - base) < 0.005) return <>{round(now)}</>;
  return (
    <>
      <span className="ui-stat__changed">{round(now)}</span>
      <span className="ui-muted-inline"> of {round(base)}</span>
    </>
  );
}

/**
 * The selected enemy, as combat sees it right now.
 *
 * Built for the pause (docs/GAME_DESIGN.md §17.3) but open at any speed. Every
 * figure is live — armour after Corrode, speed after slows — because the
 * question being asked is "why is this one getting through", and the authored
 * stat block cannot answer it.
 */
export function EnemyPanel({
  enemy,
  atlas,
  nameOf,
  statusOf,
  onClose,
}: EnemyPanelProps): ReactElement {
  const name = nameOf(enemy.enemyId);
  const health = enemy.maxHp > 0 ? Math.max(0, enemy.hp / enemy.maxHp) : 0;

  return (
    <Panel className="ui-enemy-panel" aria-label={`${name} details`} data-testid="enemy-panel">
      <header className="ui-enemy-panel__head">
        <SpriteIcon atlas={atlas} frame={`enemy_${enemy.enemyId}`} size={32} label={name} />
        <h2 className="ui-enemy-panel__name">{name}</h2>
        {enemy.threats.map((threat) => (
          <span key={threat} className={`ui-wave__threat ui-wave__threat--${threat}`}>
            {THREAT_LABEL[threat]}
          </span>
        ))}
      </header>

      <div className="ui-enemy-panel__health" aria-hidden="true">
        <div
          className={`ui-enemy-panel__bar ${health > 0.4 ? '' : 'ui-enemy-panel__bar--low'}`}
          style={{ width: `${health * 100}%` }}
        />
      </div>

      <div className="ui-stats">
        <div className="ui-stat">
          <span className="ui-stat__label">Health</span>
          <span className="ui-stat__value" data-testid="enemy-hp">
            {Math.ceil(enemy.hp)} / {round(enemy.maxHp)}
          </span>
        </div>
        {enemy.overshield > 0 && (
          <div className="ui-stat">
            <span className="ui-stat__label">Overshield</span>
            <span className="ui-stat__value">{Math.ceil(enemy.overshield)}</span>
          </div>
        )}
        <div className="ui-stat">
          <span className="ui-stat__label">Armour</span>
          <span className="ui-stat__value" data-testid="enemy-armour">
            <Modified now={enemy.armour} base={enemy.baseArmour} />
          </span>
        </div>
        <div className="ui-stat">
          <span className="ui-stat__label">Ward</span>
          <span className="ui-stat__value">
            <Modified now={enemy.ward} base={enemy.baseWard} />
          </span>
        </div>
        <div className="ui-stat">
          <span className="ui-stat__label">Speed</span>
          <span className="ui-stat__value" data-testid="enemy-speed">
            {enemy.speed === 0 && enemy.baseSpeed > 0 ? (
              'Frozen'
            ) : (
              <>
                <Modified now={enemy.speed} base={enemy.baseSpeed} /> tiles/s
              </>
            )}
          </span>
        </div>
        <div className="ui-stat">
          <span className="ui-stat__label">Bounty</span>
          <span className="ui-stat__value">{enemy.bounty} gold</span>
        </div>
        <div className="ui-stat">
          <span className="ui-stat__label">If it gets through</span>
          <span className="ui-stat__value">
            −{enemy.livesCost} {enemy.livesCost === 1 ? 'life' : 'lives'}
          </span>
        </div>
      </div>

      {enemy.statuses.length > 0 && (
        <ul className="ui-enemy-panel__statuses" aria-label="Statuses">
          {enemy.statuses.map((status) => (
            <li key={status.id}>
              {statusOf(status.id)} ×{status.stacks}
              <span className="ui-muted-inline"> · {status.secondsLeft.toFixed(1)}s</span>
            </li>
          ))}
        </ul>
      )}

      <Button variant="ghost" onClick={onClose}>
        Close
      </Button>
    </Panel>
  );
}
