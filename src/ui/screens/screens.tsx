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

/**
 * How the run went.
 *
 * Reads the result captured when the stage ended, since the session is torn
 * down with the stage screen. Retry is one tap and carries no penalty: a loss
 * should cost the player nothing but the time they already spent
 * (docs/GAME_DESIGN.md §17.3).
 */
export function ResultsScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);
  const result = useUiStore((state) => state.lastResult);

  const minutes = Math.floor((result?.durationSeconds ?? 0) / 60);
  const seconds = Math.floor((result?.durationSeconds ?? 0) % 60);

  return (
    <div className="ui-screen ui-screen--centred" data-testid="screen-results">
      <Panel title={result?.won === true ? 'Stage cleared' : 'Defeat'}>
        {result === null ? (
          <p className="ui-muted">No run to report.</p>
        ) : (
          <>
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
          </>
        )}

        <Button variant="primary" onClick={() => navigate('inStage')}>
          Retry
        </Button>
        <Button onClick={() => navigate('stageSelect')}>Stage select</Button>
      </Panel>
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
