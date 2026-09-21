import type { ReactElement } from 'react';
import type { TierStats, TowerInfo } from '@sim/index';
import { Button, Panel } from '../components/index.js';
import { BINDINGS } from '../keys.js';

export interface TowerPanelProps {
  tower: TowerInfo;
  undoSeconds: number;
  onUpgrade: () => void;
  onSpecialise: (branch: 0 | 1) => void;
  onSell: () => void;
  onUndo: () => void;
  onClose: () => void;
  /** Changes which enemy this tower prefers. */
  onTargetMode?: (mode: number) => void;
  /** Offered only for a tower with soldiers. Arms tap-to-place for the flag. */
  onRally?: () => void;
  /** True while the next tap on the board will move this tower's rally flag. */
  rallyArmed?: boolean;
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

/**
 * The five targeting modes, in the order the design lists them.
 *
 * Named rather than iconified: "Strongest" is unambiguous and a icon of it is
 * not, and this panel is where a player works out what their board is doing
 * (pillar P2, readable depth).
 */
const TARGET_MODES = ['First', 'Last', 'Strongest', 'Weakest', 'Closest'] as const;

/**
 * What each damage type is for, in one line each.
 *
 * Reachable from the panel rather than from a menu, because the moment a
 * player wants it is the moment they are looking at a tower and wondering why
 * it is not working. "No stat that only exists in a wiki" (§2, P2) cuts both
 * ways: the stat has to be in the game *and* so does what it means.
 */
const DAMAGE_NOTES: Readonly<Record<string, string>> = {
  kinetic: 'Blocked by Armour. Ignores Ward.',
  pyro: 'Applies Scorch — burns over time.',
  cryo: 'Applies Chill — slows, and freezes at five.',
  volt: 'Applies Charge — lengthens chains.',
  toxic: 'Applies Corrode — eats Armour and Ward.',
  arcane: 'Ignores Armour. Blocked by Ward. Applies Unravel.',
  true: 'Ignores everything.',
};

function DamageNote({ type }: { type: string }): ReactElement | null {
  const note = DAMAGE_NOTES[type];
  if (note === undefined) return null;
  return (
    <p className="ui-tower-panel__note">
      <span className={`ui-type--${type}`}>{type}</span> — {note}
    </p>
  );
}

/**
 * What the ground under this tower is doing for it (docs/GAME_DESIGN.md §5).
 *
 * Deliberately without numbers. The bonus is already folded into the stats
 * above — the range row reads the longer range, the DPS row the faster rate —
 * so quoting "+20%" here would be a second copy of a balance number that lives
 * in `tuning.json`, and the copy is the one that would go stale.
 */
const LEY_NOTES: Readonly<Record<string, string>> = {
  flux: 'Flux — this plot makes it fire faster.',
  depth: 'Depth — this plot makes it reach further.',
  resonance: 'Resonance — its hits land an extra status stack.',
  surge: 'Surge — reactions it sets off hit harder.',
};

function LeyNote({ node }: { node: string | null }): ReactElement | null {
  if (node === null) return null;
  const note = LEY_NOTES[node];
  if (note === undefined) return null;
  return (
    <p className={`ui-tower-panel__note ui-ley--${node}`}>
      <span className="ui-ley__dot" /> {note}
    </p>
  );
}

function Targeting({
  mode,
  onChange,
  disabled,
}: {
  mode: number;
  onChange: (mode: number) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div className="ui-tower-panel__section">
      <span className="ui-stat__label">Targets</span>
      <div className="ui-targeting" role="radiogroup" aria-label="Targeting mode">
        {TARGET_MODES.map((label, index) => (
          <Button
            key={label}
            variant={index === mode ? 'primary' : 'secondary'}
            className="ui-targeting__mode"
            role="radio"
            aria-checked={index === mode}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) onChange(index);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * What this tower has actually contributed.
 *
 * The one thing a player cannot work out by looking at the board, and the
 * thing that turns "is this worth upgrading" from a guess into a reading.
 */
function Contribution({ kills, damage }: { kills: number; damage: number }): ReactElement {
  return (
    <div className="ui-stats">
      <div className="ui-stat">
        <span className="ui-stat__label">Kills</span>
        <span className="ui-stat__value">{kills}</span>
      </div>
      <div className="ui-stat">
        <span className="ui-stat__label">Damage done</span>
        <span className="ui-stat__value">{Math.round(damage)}</span>
      </div>
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
  onTargetMode,
  onRally,
  rallyArmed = false,
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

      <DamageNote type={tower.current.damageType} />
      <LeyNote node={tower.leyNode} />
      <Contribution kills={tower.kills} damage={tower.damageDealt} />

      {/* Only for towers that choose. A barracks has no target to prefer, and
          offering it one would be a control that does nothing. */}
      {onTargetMode !== undefined && tower.soldierCount === 0 && (
        <Targeting mode={tower.targetMode} onChange={onTargetMode} disabled={locked} />
      )}

      {/* A garrison's strength is the thing a player checks before deciding
          whether it can hold, so it sits above the upgrade rather than below
          it. Towers that shoot never show this at all. */}
      {tower.soldierCount > 0 && (
        <div className="ui-tower-panel__section">
          <div className="ui-stat">
            <span className="ui-stat__label">Soldiers</span>
            <span className="ui-stat__value">
              {tower.soldiersAlive} / {tower.soldierCount}
            </span>
          </div>
          {onRally !== undefined && (
            <Button
              variant={rallyArmed ? 'primary' : 'secondary'}
              onClick={guard(onRally)}
              {...lock}
            >
              {rallyArmed ? 'Tap the board' : 'Move rally'}
            </Button>
          )}
        </div>
      )}

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
            shortcut={BINDINGS.upgrade}
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
          <Button variant="primary" onClick={guard(onUndo)} shortcut={BINDINGS.undo} {...lock}>
            Undo ({undoSeconds.toFixed(1)}s)
          </Button>
        ) : (
          <Button variant="danger" onClick={guard(onSell)} shortcut={BINDINGS.sell} {...lock}>
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
