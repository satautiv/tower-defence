import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { GAME_SPEEDS } from '@core/constants';
import type { GameSpeed } from '@core/constants';
import { shallowEqual, useThrottledValue } from '../hooks/useThrottledValue.js';
import { Button } from '../components/index.js';
import { BINDINGS } from '../keys.js';
import { useUiStore } from '../store.js';
import { placeholderHudSource } from './model.js';
import type { HudSource } from './model.js';

/** How long a first tap on Quit stays armed, waiting for the second. */
export const QUIT_CONFIRM_MS = 3000;

export interface HudProps {
  source?: HudSource;
  /** Asks for a speed. Omitted, the speed control is not shown. */
  onSpeed?: (speed: GameSpeed) => void;
  /** Offered while paused. Omitted, the button is not shown. */
  onRestart?: () => void;
  onQuit?: () => void;
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
 *
 * Paused, the bar is the pause menu. A menu over the board would hide the very
 * thing the player paused to study (docs/GAME_DESIGN.md §17.3), so restart and
 * quit take the place of the wave counter instead, and nothing covers the map.
 */
export function Hud({
  source = placeholderHudSource,
  onSpeed,
  onRestart,
  onQuit,
}: HudProps): ReactElement {
  const model = useThrottledValue(source, undefined, shallowEqual);
  /* Read from the store rather than the polled model, so the button answers
     the press at once instead of up to a poll later. */
  const paused = useUiStore((state) => state.openPanel === 'pause');
  const openPanel = useUiStore((state) => state.openPanelById);
  const closePanel = useUiStore((state) => state.closePanel);

  /* Quit takes two taps. On a phone the bar sits over the top row of build
     plots, and a paused player tapping one to plan must not abandon the run.
     Restart stays one tap, as §17.3 asks: it is meant to be instant. */
  const [quitArmed, setQuitArmed] = useState(false);
  useEffect(() => {
    if (!quitArmed) return;
    const id = setTimeout(() => setQuitArmed(false), QUIT_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [quitArmed]);
  useEffect(() => {
    if (!paused) setQuitArmed(false);
  }, [paused]);

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

      {paused ? (
        <div className="ui-hud__paused" role="status" data-testid="paused">
          <span className="ui-hud__paused-label">Paused</span>
          {onRestart !== undefined && (
            <Button variant="ghost" onClick={onRestart} shortcut={BINDINGS.restart}>
              Restart
            </Button>
          )}
          {onQuit !== undefined && (
            <Button
              variant={quitArmed ? 'danger' : 'ghost'}
              onClick={() => (quitArmed ? onQuit() : setQuitArmed(true))}
            >
              {quitArmed ? 'Quit?' : 'Quit'}
            </Button>
          )}
        </div>
      ) : (
        <div className="ui-hud__wave ui-interactive">
          Wave {model.wave} / {model.totalWaves}
        </div>
      )}

      <div className="ui-hud__controls">
        {onSpeed !== undefined && (
          <div
            className="ui-speed ui-interactive"
            role="group"
            aria-label="Game speed"
            aria-keyshortcuts={BINDINGS.speed.aria}
            title={`${BINDINGS.speed.label} steps through the speeds`}
          >
            {GAME_SPEEDS.map((speed) => (
              <Button
                key={speed}
                variant={model.speed === speed ? 'primary' : 'ghost'}
                className="ui-speed__option"
                aria-pressed={model.speed === speed}
                aria-label={`${speed}× speed`}
                aria-disabled={paused || undefined}
                title={paused ? 'Resume to change speed' : undefined}
                onClick={() => {
                  if (!paused) onSpeed(speed);
                }}
              >
                {speed}×
              </Button>
            ))}
            <kbd className="ui-kbd ui-speed__kbd" aria-hidden="true">
              {BINDINGS.speed.label}
            </kbd>
          </div>
        )}
        {paused ? (
          <Button
            variant="primary"
            onClick={closePanel}
            aria-label="Resume"
            shortcut={BINDINGS.pause}
          >
            ▶
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() => openPanel('pause')}
            aria-label="Pause"
            shortcut={BINDINGS.pause}
          >
            II
          </Button>
        )}
      </div>
    </div>
  );
}
