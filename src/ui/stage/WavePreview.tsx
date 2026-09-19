import type { ReactElement } from 'react';
import { THREAT_TAGS } from '@sim/index';
import type { NextWave, ThreatTag } from '@sim/index';
import type { AtlasIndex } from '@view/assets';
import { Button, Panel } from '../components/index.js';
import { useThrottledValue } from '../hooks/useThrottledValue.js';
import { SpriteIcon } from './SpriteIcon.js';
import { BINDINGS } from '../keys.js';
import { THREAT_LABEL, THREAT_SHORT } from './threats.js';

export interface WavePreviewProps {
  read: () => NextWave | null;
  /** Null until the atlas has loaded; icons fall back to initials meanwhile. */
  atlas: AtlasIndex | null;
  nameOf: (enemyId: string) => string;
  onCall: () => void;
  /** Paused: the wave still reads, but cannot be called. */
  locked?: boolean;
}

const ICON_SIZE = 28;
const FULL_BOARD = 'Too many waves already in play.';

/**
 * Composition is fixed by the wave index, so only the figures that tick need
 * comparing. Anything else would re-render ten times a second for a panel that
 * changes about once a second.
 */
function sameWave(a: NextWave | null, b: NextWave | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.index === b.index &&
    a.startsInSeconds === b.startsInSeconds &&
    a.callBonus === b.callBonus &&
    a.canCall === b.canCall
  );
}

function ThreatChip({ threat, short }: { threat: ThreatTag; short: boolean }): ReactElement {
  const className = `ui-wave__threat ui-wave__threat--${threat}`;
  return short ? (
    <abbr className={className} title={THREAT_LABEL[threat]}>
      {THREAT_SHORT[threat]}
    </abbr>
  ) : (
    <span className={className}>{THREAT_LABEL[threat]}</span>
  );
}

/**
 * What is coming next, when, and what calling it early pays.
 *
 * Always on screen rather than behind a button, because a loss the player
 * could have seen coming is fair and one they could not is not
 * (docs/GAME_DESIGN.md §17.3). The call button lives here, beside the wave it
 * calls, so the player weighs the bonus against what they have just read.
 *
 * Threats are marked twice, and the stylesheet shows one: beside the enemy
 * that brings them where there is room, and gathered into the heading on a
 * phone, where a tag per enemy would widen the panel over the build plots.
 */
export function WavePreview({
  read,
  atlas,
  nameOf,
  onCall,
  locked = false,
}: WavePreviewProps): ReactElement {
  const wave = useThrottledValue(read, undefined, sameWave);

  if (wave === null) {
    return (
      <Panel className="ui-wave" aria-label="Next wave" data-testid="wave-preview">
        <p className="ui-wave__final">Final wave — nothing left to come.</p>
      </Panel>
    );
  }

  const number = wave.index + 1;
  const bonus = wave.callBonus;
  const threats = THREAT_TAGS.filter((threat) =>
    wave.enemies.some((enemy) => enemy.threats.includes(threat)),
  );

  return (
    <Panel className="ui-wave" aria-label="Next wave" data-testid="wave-preview">
      <header className="ui-wave__head">
        <span>
          <span className="ui-wave__wordy">Next wave </span>
          <span className="ui-wave__number">
            {number}/{wave.total}
          </span>
        </span>
        {threats.length > 0 && (
          <span className="ui-wave__threats ui-wave__threats--gathered">
            {threats.map((threat) => (
              <ThreatChip key={threat} threat={threat} short />
            ))}
          </span>
        )}
        <span className="ui-wave__timer" data-testid="wave-timer">
          {wave.startsInSeconds > 0 ? `in ${wave.startsInSeconds}s` : 'due'}
        </span>
      </header>

      <ul className="ui-wave__enemies">
        {wave.enemies.map((enemy) => {
          const name = nameOf(enemy.enemyId);
          return (
            <li key={enemy.enemyId} className="ui-wave__enemy">
              <SpriteIcon
                atlas={atlas}
                frame={`enemy_${enemy.enemyId}`}
                size={ICON_SIZE}
                label={name}
              />
              <span className="ui-wave__count">×{enemy.count}</span>
              <span className="ui-wave__name" title={name}>
                {name}
              </span>
              {enemy.threats.length > 0 && (
                <span className="ui-wave__threats ui-wave__threats--each">
                  {enemy.threats.map((threat) => (
                    <ThreatChip key={threat} threat={threat} short={false} />
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <Button
        variant="primary"
        className="ui-wave__call"
        shortcut={BINDINGS.callWave}
        onClick={() => {
          if (!locked) onCall();
        }}
        disabled={!wave.canCall}
        aria-disabled={locked || undefined}
        title={!wave.canCall ? FULL_BOARD : locked ? 'Resume to call' : undefined}
        aria-label={
          bonus > 0 ? `Call wave ${number} now for ${bonus} bonus gold` : `Call wave ${number} now`
        }
      >
        <span>
          Call<span className="ui-wave__wordy"> now</span>
        </span>
        {bonus > 0 && <span className="ui-wave__bonus">+{bonus}</span>}
      </Button>
      {!wave.canCall && <p className="ui-wave__note">{FULL_BOARD}</p>}
    </Panel>
  );
}
