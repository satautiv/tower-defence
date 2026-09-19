import type { ReactElement } from 'react';
import { GAME_SPEEDS } from '@core/constants';
import type { GameSpeed } from '@core/constants';
import { shallowEqual, useThrottledValue } from '../hooks/useThrottledValue.js';
import { Button } from '../components/index.js';
import { useUiStore } from '../store.js';
import { placeholderHudSource } from './model.js';
import type { HudSource } from './model.js';

export interface HudProps {
  source?: HudSource;
  /** Asks for a speed. Omitted, the speed control is not shown. */
  onSpeed?: (speed: GameSpeed) => void;
}

/**
 * The in-stage top bar.
 *
 * Polls the simulation at ~10Hz and re-renders only when a number actually
 * changes. Counters use a monospace face so they do not reflow as digits
 * change, which is distracting in peripheral vision while the player is
 * watching the board.
 *
 * The speed control shows the speed the simulation is running at, not the
 * last button pressed: a request is a command, applied at the next tick, and
 * the highlight moves when the world says it has.
 */
export function Hud({ source = placeholderHudSource, onSpeed }: HudProps): ReactElement {
  const model = useThrottledValue(source, undefined, shallowEqual);
  const openPanel = useUiStore((state) => state.openPanelById);

  return (
    <div className="ui-hud" data-testid="hud">
      <div className="ui-hud__resources ui-interactive">
        <span className="ui-hud__stat ui-hud__stat--lives" title="Lives">
          {model.lives}
        </span>
        <span className="ui-hud__stat ui-hud__stat--gold" title="Gold">
          {model.gold}
        </span>
        <span className="ui-hud__stat ui-hud__stat--aether" title="Aether Charge">
          {model.aether}
        </span>
      </div>

      <div className="ui-hud__wave ui-interactive">
        Wave {model.wave} / {model.totalWaves}
      </div>

      <div className="ui-hud__controls">
        {onSpeed !== undefined && (
          <div className="ui-speed ui-interactive" role="group" aria-label="Game speed">
            {GAME_SPEEDS.map((speed) => (
              <Button
                key={speed}
                variant={model.speed === speed ? 'primary' : 'ghost'}
                className="ui-speed__option"
                aria-pressed={model.speed === speed}
                aria-label={`${speed}× speed`}
                onClick={() => onSpeed(speed)}
              >
                {speed}×
              </Button>
            ))}
          </div>
        )}
        <Button variant="ghost" onClick={() => openPanel('pause')} aria-label="Pause">
          II
        </Button>
      </div>
    </div>
  );
}
