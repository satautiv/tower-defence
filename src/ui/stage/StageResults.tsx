import type { ReactElement } from 'react';
import type { StageResult } from '@sim/index';
import { Button, INTERACTIVE, Panel, cx } from '../components/index.js';
import { BINDINGS } from '../keys.js';

export interface StageResultsProps {
  result: StageResult;
  onRetry: () => void;
  onLeave: () => void;
}

/**
 * How the run went, over the board it ended on.
 *
 * Shown inside the stage rather than on a screen of its own, so the renderer
 * and the loaded stage survive it and Retry is the same instant reset as the
 * pause menu's Restart — one tap, no confirmation, no loading
 * (docs/GAME_DESIGN.md §17.3). A loss should cost the player nothing but the
 * time they already spent. The final board stays visible behind it.
 *
 * Not a Modal: a modal can be dismissed, and there is nothing to go back to.
 */
export function StageResults({ result, onRetry, onLeave }: StageResultsProps): ReactElement {
  const minutes = Math.floor(result.durationSeconds / 60);
  const seconds = Math.floor(result.durationSeconds % 60);

  return (
    <div className={cx(INTERACTIVE, 'ui-results')} data-testid="stage-results">
      <Panel
        className="ui-results__panel"
        title={result.won ? 'Stage cleared' : 'Defeat'}
        role="dialog"
        aria-label={result.won ? 'Stage cleared' : 'Defeat'}
      >
        <div className="ui-results__stars" aria-label={`${result.stars} of 3 stars`}>
          {[1, 2, 3].map((star) => (
            <span
              key={star}
              className={star <= result.stars ? 'ui-star ui-star--earned' : 'ui-star'}
            >
              ★
            </span>
          ))}
        </div>

        <div className="ui-stats">
          <div className="ui-stat">
            <span className="ui-stat__label">Lives</span>
            <span className="ui-stat__value">
              {result.livesRemaining} / {result.startingLives}
            </span>
          </div>
          <div className="ui-stat">
            <span className="ui-stat__label">Waves</span>
            <span className="ui-stat__value">
              {result.wavesCleared} / {result.totalWaves}
            </span>
          </div>
          <div className="ui-stat">
            <span className="ui-stat__label">Time</span>
            <span className="ui-stat__value">
              {minutes}:{String(seconds).padStart(2, '0')}
            </span>
          </div>
          <div className="ui-stat">
            <span className="ui-stat__label">Killed</span>
            <span className="ui-stat__value">{result.enemiesKilled}</span>
          </div>
          <div className="ui-stat">
            <span className="ui-stat__label">Leaked</span>
            <span className="ui-stat__value">{result.enemiesLeaked}</span>
          </div>
          <div className="ui-stat">
            <span className="ui-stat__label">Gold earned</span>
            <span className="ui-stat__value">{result.goldEarned}</span>
          </div>
        </div>

        <Button variant="primary" onClick={onRetry} autoFocus shortcut={BINDINGS.restart}>
          Retry
        </Button>
        <Button onClick={onLeave}>Stage select</Button>
      </Panel>
    </div>
  );
}
