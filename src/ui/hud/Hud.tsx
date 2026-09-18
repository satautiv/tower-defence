import type { ReactElement } from 'react';
import { shallowEqual, useThrottledValue } from '../hooks/useThrottledValue.js';
import { Button } from '../components/index.js';
import { useUiStore } from '../store.js';
import { placeholderHudSource } from './model.js';
import type { HudSource } from './model.js';

export interface HudProps {
  source?: HudSource;
}

/**
 * The in-stage top bar.
 *
 * Polls the simulation at ~10Hz and re-renders only when a number actually
 * changes. Counters use a monospace face so they do not reflow as digits
 * change, which is distracting in peripheral vision while the player is
 * watching the board.
 */
export function Hud({ source = placeholderHudSource }: HudProps): ReactElement {
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
        <Button variant="ghost" onClick={() => openPanel('pause')} aria-label="Pause">
          II
        </Button>
      </div>
    </div>
  );
}
