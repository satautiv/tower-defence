import type { ReactElement } from 'react';
import type { TierStats, TowerInfo } from '@sim/index';
import { Button, Panel } from '../components/index.js';

export interface TowerPanelProps {
  tower: TowerInfo;
  undoSeconds: number;
  onUpgrade: () => void;
  onSpecialise: (branch: 0 | 1) => void;
  onSell: () => void;
  onUndo: () => void;
  onClose: () => void;
  /** Paused: everything reads, nothing changes the tower. */
  locked?: boolean;
}

const round = (value: number): string =>
  value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, '');

/** Shows what a stat becomes, only when it actually changes. */
function Delta({
  label,
  before,
  after,
}: {
  label: string;
  before: number;
  after: number;
}): ReactElement | null {
  if (Math.abs(after - before) < 0.005) return null;
  return (
    <div className="ui-stat">
      <span className="ui-stat__label">{label}</span>
      <span className="ui-stat__value">
        {round(before)}
        <span className="ui-stat__arrow"> → </span>
        <span className="ui-stat__after">{round(after)}</span>
      </span>
    </div>
  );
}

function Stats({ stats }: { stats: TierStats }): ReactElement {
  return (
    <div className="ui-stats">
      <div className="ui-stat">
        <span className="ui-stat__label">DPS{stats.multiTarget ? ' (per target)' : ''}</span>
        <span className="ui-stat__value">{round(stats.dps)}</span>
      </div>
      <div className="ui-stat">
        <span className="ui-stat__label">Range</span>
        <span className="ui-stat__value">{round(stats.rangeTiles)}</span>
      </div>
      <div className="ui-stat">
        <span className="ui-stat__label">Damage</span>
        <span className={`ui-stat__value ui-type--${stats.damageType}`}>{stats.damageType}</span>
      </div>
      {stats.status !== null && (
        <div className="ui-stat">
          <span className="ui-stat__label">Applies</span>
          <span className="ui-stat__value">
            {stats.status.id} &times;{stats.status.stacks}
          </span>
        </div>
      )}
      <div className="ui-stat">
        <span className="ui-stat__label">Targets</span>
        <span className="ui-stat__value">
          {stats.hitsGround && stats.hitsAir ? 'ground + air' : stats.hitsAir ? 'air' : 'ground'}
        </span>
      </div>
    </div>
  );
}

/**
 * The selected tower.
 *
 * Upgrades are shown as a before-and-after rather than a description, because
 * "what does this actually buy me" is the question the player is asking and a
 * paragraph of flavour text is not an answer. Only changed stats appear, so
 * the diff is the message.
 */
export function TowerPanel({
  tower,
  undoSeconds,
  onUpgrade,
  onSpecialise,
  onSell,
  onUndo,
  onClose,
  locked = false,
}: TowerPanelProps): ReactElement {
  /* Locked controls stay visible, so the player can still see what an upgrade
     costs and buys while planning. */
  const guard =
    (action: () => void): (() => void) =>
    () => {
      if (!locked) action();
    };
  const lock = {
    'aria-disabled': locked || undefined,
    title: locked ? 'Resume to act' : undefined,
  };

  return (
    <Panel className="ui-tower-panel" title={tower.id.replace(/_/g, ' ')}>
      <Stats stats={tower.current} />

      {tower.upgrade !== null && (
        <div className="ui-tower-panel__section">
          <Delta label="DPS" before={tower.upgrade.before.dps} after={tower.upgrade.after.dps} />
          <Delta
            label="Range"
            before={tower.upgrade.before.rangeTiles}
            after={tower.upgrade.after.rangeTiles}
          />
          <Button
            variant="primary"
            disabled={!tower.upgrade.affordable}
            onClick={guard(onUpgrade)}
            {...lock}
          >
            Upgrade &mdash; {tower.upgrade.cost}
          </Button>
        </div>
      )}

      {tower.specialisations.length > 0 && (
        <div className="ui-tower-panel__section">
          <p className="ui-muted">
            A specialisation is permanent. Changing it costs full price again.
          </p>
          {tower.specialisations.map((option) => (
            <Button
              key={option.branch}
              disabled={!option.affordable}
              onClick={guard(() => onSpecialise(option.branch))}
              {...lock}
            >
              Branch {option.branch + 1} &mdash; {option.cost}
            </Button>
          ))}
        </div>
      )}

      <div className="ui-tower-panel__actions">
        {/* A full refund while the window is open: a misplaced tap on a
            touchscreen is a slip, not a change of mind. */}
        {tower.undoable && undoSeconds > 0 ? (
          <Button variant="primary" onClick={guard(onUndo)} {...lock}>
            Undo ({undoSeconds.toFixed(1)}s)
          </Button>
        ) : (
          <Button variant="danger" onClick={guard(onSell)} {...lock}>
            Sell &mdash; {tower.sellValue}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </Panel>
  );
}
