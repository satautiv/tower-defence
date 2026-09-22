/// <reference types="vite/client" />
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Button, Panel } from '../components/index.js';
import { useUiStore } from '../store.js';

/**
 * Screen shells.
 *
 * Structure and navigation only — the visual design pass is #46, and stage
 * select gets real data from the save system in #39. What matters here is that
 * the router works and that the canvas exists on exactly one screen.
 */

export function SplashScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);

  /* Auto-advance, but stay skippable: the fastest route into a wave is the
     product goal (docs/GAME_DESIGN.md §22). */
  useEffect(() => {
    const timer = setTimeout(() => navigate('menu'), 900);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="ui-screen ui-screen--centred" data-testid="screen-splash">
      <h1 className="ui-splash__title">Aetherfall</h1>
      <Button variant="ghost" onClick={() => navigate('menu')}>
        Skip
      </Button>
    </div>
  );
}

export function MenuScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);

  return (
    <div className="ui-screen ui-screen--centred" data-testid="screen-menu">
      <h1 className="ui-menu__title">Aetherfall</h1>
      <nav className="ui-menu__actions">
        <Button variant="primary" onClick={() => navigate('regionMap')}>
          Campaign
        </Button>
        <Button onClick={() => navigate('settings')}>Settings</Button>
        {/* The only way into the editor, and it is not here in a production
            build: the condition is a literal after substitution, so this
            button and the screen behind it are both dropped (#34). */}
        {import.meta.env.DEV && <Button onClick={() => navigate('editor')}>Editor</Button>}
      </nav>
    </div>
  );
}

export function RegionMapScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);
  const goBack = useUiStore((state) => state.goBack);

  return (
    <div className="ui-screen" data-testid="screen-region-map">
      <Panel title="Regions">
        <Button variant="primary" onClick={() => navigate('stageSelect')}>
          Emberfall Ridge
        </Button>
        <Button disabled>The Sunken Reliquary — locked</Button>
      </Panel>
      <Button variant="ghost" onClick={goBack}>
        Back
      </Button>
    </div>
  );
}

export function StageSelectScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);
  const selectStage = useUiStore((state) => state.selectStage);
  const goBack = useUiStore((state) => state.goBack);

  const play = (stageId: string): void => {
    selectStage(stageId);
    navigate('inStage');
  };

  return (
    <div className="ui-screen" data-testid="screen-stage-select">
      <Panel title="Emberfall Ridge">
        <Button variant="primary" onClick={() => play('1-1')}>
          1-1
        </Button>
      </Panel>
      <Button variant="ghost" onClick={goBack}>
        Back
      </Button>
    </div>
  );
}

export function SettingsScreen(): ReactElement {
  const goBack = useUiStore((state) => state.goBack);

  return (
    <div className="ui-screen" data-testid="screen-settings">
      <Panel title="Settings">
        <p className="ui-muted">
          Audio, graphics and accessibility options arrive with #46 and #47.
        </p>
      </Panel>
      <Button variant="ghost" onClick={goBack}>
        Back
      </Button>
    </div>
  );
}
