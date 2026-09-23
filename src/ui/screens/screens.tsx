/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { loadContent } from '@content/load';
import { compareStageIds } from '@content/stages';
import { Button, Panel } from '../components/index.js';
import { text } from '../text.js';
import { useUiStore } from '../store.js';
import {
  SCORING_MODE_IDS,
  bestTimeFor,
  modeRecord,
  stageCleared,
  stageStars,
  campaignSummary,
  totalStars,
  useProfile,
} from '@app/profile';
import { maxStarsFor, modesFor } from '@app/modes';
import type { PlayMode } from '@app/modes';
import { clearAllSaveData, exportFileName, exportSaveData, importSaveData } from '@app/saveData';

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
        <Button onClick={() => navigate('talents')}>Warden Talents</Button>
        <Button onClick={() => navigate('settings')}>Settings</Button>
        {/* The only way into the editor, and it is not here in a production
            build: the condition is a literal after substitution, so this
            button and the screen behind it are both dropped (#34). */}
        {import.meta.env.DEV && <Button onClick={() => navigate('editor')}>Editor</Button>}
      </nav>
    </div>
  );
}

/** Seconds as m:ss, the way the results screen already reads a clock. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/** Stage ids of one region, in the order a campaign runs them. */
function regionStageIds(region: number): string[] {
  return [...loadContent().stages.values()]
    .filter((stage) => stage.region === region)
    .sort((a, b) => compareStageIds(a.id, b.id))
    .map((stage) => stage.id);
}

export function RegionMapScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);
  const goBack = useUiStore((state) => state.goBack);
  const profile = useProfile((state) => state.profile);

  /* What a stage is worth comes from the modes it actually offers (§12.4's
     eleven), read from the first stage: every stage in a region carries the
     same three difficulties and the same three variants. */
  const region1 = regionStageIds(1);
  const summary = campaignSummary(
    profile,
    region1,
    region1.length === 0 ? 0 : maxStarsFor(region1[0] as string),
  );

  return (
    <div className="ui-screen" data-testid="screen-region-map">
      <Panel title="Regions">
        <Button
          variant="primary"
          className="ui-stage"
          onClick={() => navigate('stageSelect')}
          data-testid="region-1"
        >
          <span className="ui-stage__name">Emberfall Ridge</span>
          <span className="ui-stage__stars" data-testid="region-1-stars">
            {summary.stars} / {summary.maxStars} &#9733;
          </span>
        </Button>
        <p className="ui-muted" data-testid="region-1-progress">
          {summary.cleared} of {summary.total} stages cleared
          {summary.complete ? ` · best run ${formatClock(summary.bestTotalSeconds)}` : ''}
        </p>

        <Button disabled>The Sunken Reliquary — locked</Button>
        {/* Regions 2-5 are M7 content (#58). The lock is real and the region
            does not exist yet, which is why it says so rather than pretending
            to a star count. */}
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
  const selectMode = useUiStore((state) => state.selectMode);
  const selectedStageId = useUiStore((state) => state.selectedStageId);
  const goBack = useUiStore((state) => state.goBack);
  const profile = useProfile((state) => state.profile);

  /**
   * Choosing a stage opens its modes; nothing starts until a mode is chosen
   * too (#48).
   *
   * That second tap is the whole of "a mode must never be entered by
   * accident". Iron is one life and Impossible is a different game, and a
   * single tap that launched whichever mode happened to be remembered would
   * throw a player into one of them with no way to tell before the first wave.
   */
  const open = (stageId: string): void => {
    selectStage(selectedStageId === stageId ? null : stageId);
  };

  const play = (stageId: string, mode: PlayMode): void => {
    selectStage(stageId);
    selectMode(mode.id);
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
  const stageIds = stages.map((stage) => stage.id);
  const regionSummary = campaignSummary(
    profile,
    stageIds,
    stageIds.length === 0 ? 0 : maxStarsFor(stageIds[0] as string),
  );

  return (
    <div className="ui-screen" data-testid="screen-stage-select">
      <Panel title="Emberfall Ridge">
        <p className="ui-muted" data-testid="region-total">
          {regionSummary.stars} of {regionSummary.maxStars} stars &middot; {regionSummary.cleared}{' '}
          of {regionSummary.total} cleared
        </p>
        <div className="ui-stages">
          {stages.map((stage) => {
            const stars = stageStars(profile, stage.id);
            const most = maxStarsFor(stage.id);
            const best = bestTimeFor(profile, stage.id, SCORING_MODE_IDS);
            const expanded = selectedStageId === stage.id;

            return (
              <div key={stage.id} className="ui-stage-row">
                <Button
                  variant="primary"
                  className="ui-stage"
                  onClick={() => open(stage.id)}
                  aria-expanded={expanded}
                  data-testid={`stage-${stage.id}`}
                >
                  <span className="ui-stage__name">
                    {stage.id} &middot; {text(stage.nameKey)}
                  </span>
                  {/* The best clear, which §13 calls "no reward, pure pride" —
                      so it sits beside the stars rather than above them. */}
                  {best !== undefined && (
                    <span className="ui-stage__time" data-testid={`best-${stage.id}`}>
                      {formatClock(best)}
                    </span>
                  )}
                  <span
                    className="ui-stage__stars"
                    aria-label={`${stars} of ${most} stars`}
                    data-testid={`stars-${stage.id}`}
                  >
                    {stars} / {most} &#9733;
                  </span>
                </Button>

                {expanded && (
                  <ul className="ui-modes" data-testid={`modes-${stage.id}`}>
                    {modesFor(stage.id).map((mode) => (
                      <li key={mode.id}>
                        <Button
                          variant="ghost"
                          className="ui-mode"
                          onClick={() => play(stage.id, mode)}
                          data-testid={`mode-${stage.id}-${mode.id}`}
                        >
                          {/* Score beside the name, sentence underneath: the
                              grid places children in order, and putting the
                              description second pushed the score onto a third
                              row of its own. */}
                          <span className="ui-mode__name">{text(mode.nameKey)}</span>
                          <span className="ui-mode__status" data-testid={`status-${mode.id}`}>
                            {modeStatus(profile, stage.id, mode)}
                          </span>
                          <span className="ui-mode__desc">{text(mode.descriptionKey)}</span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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

/**
 * What one mode says about itself on the stage list.
 *
 * Stars where a mode pays them, the furthest wave where it does not — Endless
 * has no other score, and a row reading "0 of 0 stars" would say nothing about
 * a run that reached wave sixty.
 */
function modeStatus(
  profile: Parameters<typeof stageStars>[0],
  stageId: string,
  mode: PlayMode,
): string {
  const record = modeRecord(profile, stageId, mode.id);

  if (mode.maxStars === 0) {
    return record.bestWave > 0 ? `wave ${record.bestWave}` : 'not yet played';
  }
  if (mode.maxStars === 1) return record.stars > 0 ? 'solved \u2605' : 'unsolved';
  return `${'\u2605'.repeat(record.stars)}${'\u2606'.repeat(mode.maxStars - record.stars)}`;
}

export function SettingsScreen(): ReactElement {
  const goBack = useUiStore((state) => state.goBack);
  const profile = useProfile((state) => state.profile);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const stars = totalStars(profile);
  const cleared = Object.keys(profile.stages).filter((id) => stageCleared(profile, id)).length;

  /* A download rather than a copy box: a save is a file, and a player moving
     one to another device wants something they can put in a folder. */
  const save = (): void => {
    const blob = new Blob([exportSaveData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportFileName(new Date().toISOString());
    link.click();
    /* Revoked on the next turn of the loop: revoking it immediately races the
       download on some browsers. */
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice('Save exported.');
  };

  const load = async (file: File): Promise<void> => {
    try {
      const imported = importSaveData(await file.text());
      const parts = [
        imported.profile === null ? null : 'progress',
        imported.settings === null ? null : 'settings',
      ].filter((part) => part !== null);
      setNotice(`Restored ${parts.join(' and ')}.`);
    } catch (error) {
      /* Named rather than swallowed: a player who picks the wrong file needs to
         know nothing happened to the save they still have. */
      setNotice(
        error instanceof Error
          ? `That file could not be read (${error.message}). Nothing has changed.`
          : 'That file could not be read. Nothing has changed.',
      );
    }
  };

  const wipe = (): void => {
    void clearAllSaveData().then(() => {
      setConfirmingClear(false);
      setNotice('All saved data has been cleared.');
    });
  };

  return (
    <div className="ui-screen" data-testid="screen-settings">
      <Panel title="Settings">
        <p className="ui-muted">
          Audio, graphics and accessibility options arrive with #46 and #47.
        </p>
      </Panel>

      <Panel title="Saved data">
        <p className="ui-muted" data-testid="save-summary">
          {cleared} {cleared === 1 ? 'stage' : 'stages'} cleared &middot; {stars}{' '}
          {stars === 1 ? 'star' : 'stars'}
        </p>

        <div className="ui-savedata">
          <Button variant="primary" onClick={save}>
            Export save
          </Button>
          <Button variant="primary" onClick={() => fileRef.current?.click()}>
            Import save
          </Button>
          {/* Off-screen rather than hidden: a display:none input cannot be
              opened by a click on some browsers. */}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="ui-visually-hidden"
            data-testid="import-file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              /* Cleared so picking the same file twice fires again. */
              event.target.value = '';
              if (file !== undefined) void load(file);
            }}
          />
        </div>

        {confirmingClear ? (
          <div className="ui-savedata">
            <p className="ui-muted">
              This erases every star, every best time and the run in progress. It cannot be undone.
            </p>
            <Button variant="danger" onClick={wipe} data-testid="clear-confirm">
              Erase everything
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingClear(false)}>
              Keep my save
            </Button>
          </div>
        ) : (
          <div className="ui-savedata">
            <Button variant="ghost" onClick={() => setConfirmingClear(true)}>
              Clear saved data
            </Button>
          </div>
        )}

        {notice !== null && (
          <p className="ui-notice" role="status" data-testid="save-notice">
            {notice}
          </p>
        )}
      </Panel>

      <Button variant="ghost" onClick={goBack}>
        Back
      </Button>
    </div>
  );
}
