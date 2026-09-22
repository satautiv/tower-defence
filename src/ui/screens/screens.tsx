/// <reference types="vite/client" />
import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { loadContent } from '@content/load';
import { compareStageIds } from '@content/stages';
import { Button, Panel } from '../components/index.js';
import { text } from '../text.js';
import { useUiStore } from '../store.js';
import { stageRecord, useProfile } from '@app/profile';

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
  const profile = useProfile((state) => state.profile);

  const play = (stageId: string): void => {
    selectStage(stageId);
    navigate('inStage');
  };

  /* Read from the content rather than listed here, so #36's ten stages —
     and every region after — appear by existing. Sorted by `compareStageIds`
     because string order puts 1-10 before 1-5, which is exactly the bug a
     campaign list must not have.
     Every stage stays playable. #39 records what has been earned and this
     shows it, but *gating* the campaign on it belongs with the region map
     (#37), which is where a locked stage has somewhere to say why. */
  const stages = [...loadContent().stages.values()]
    .filter((stage) => stage.region === 1)
    .sort((a, b) => compareStageIds(a.id, b.id));

  return (
    <div className="ui-screen" data-testid="screen-stage-select">
      <Panel title="Emberfall Ridge">
        <div className="ui-stages">
          {stages.map((stage) => {
            const record = stageRecord(profile, stage.id);
            return (
              <Button
                key={stage.id}
                variant="primary"
                className="ui-stage"
                onClick={() => play(stage.id)}
              >
                <span className="ui-stage__name">
                  {stage.id} &middot; {text(stage.nameKey)}
                </span>
                <span
                  className="ui-stage__stars"
                  aria-label={`${record.stars} of 3 stars`}
                  data-testid={`stars-${stage.id}`}
                >
                  {'\u2605'.repeat(record.stars)}
                  {'\u2606'.repeat(3 - record.stars)}
                </span>
              </Button>
            );
          })}
        </div>
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
