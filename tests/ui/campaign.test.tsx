// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, campaignSummary, recordStageResult, useProfile } from '@app/profile';
import { RegionMapScreen, StageSelectScreen, formatClock } from '@ui/screens/screens';
import { modesFor } from '@app/modes';
import { useUiStore } from '@ui/store';
import type { StageResult } from '@sim/index';

/**
 * What the campaign says a player has done (#37, §14).
 *
 * Stages are deliberately not gated here. #37's unlock chain is about towers,
 * heroes, powers and specialisations; nothing in the design gates stage access,
 * and locking the region to its first stage would take the remaining playtests
 * (#19, #36) away from the people who still have to run them.
 */

function won(over: Partial<StageResult> = {}): StageResult {
  return {
    won: true,
    stars: 3,
    livesRemaining: 20,
    startingLives: 20,
    durationSeconds: 245,
    wavesCleared: 10,
    totalWaves: 10,
    enemiesKilled: 10,
    enemiesLeaked: 0,
    goldEarned: 100,
    towersBuilt: 3,
    reactionsTriggered: 1,
    ...over,
  };
}

beforeEach(() => useProfile.setState({ profile: EMPTY_PROFILE, loaded: true }));
afterEach(cleanup);

describe('the clock', () => {
  it.each([
    [0, '0:00'],
    [9, '0:09'],
    [65, '1:05'],
    [245, '4:05'],
    [600, '10:00'],
  ])('reads %ss as %s', (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected);
  });
});

describe('the campaign summary', () => {
  it('is empty before anything is played', () => {
    expect(campaignSummary(EMPTY_PROFILE, ['1-1', '1-2'])).toEqual({
      stars: 0,
      maxStars: 22,
      cleared: 0,
      total: 2,
      bestTotalSeconds: 0,
      complete: false,
    });
  });

  it('adds up stars, clears and best times', () => {
    let profile = recordStageResult(
      EMPTY_PROFILE,
      '1-1',
      'normal',
      won({ stars: 3, durationSeconds: 200 }),
    );
    profile = recordStageResult(profile, '1-2', 'normal', won({ stars: 2, durationSeconds: 300 }));

    expect(campaignSummary(profile, ['1-1', '1-2'])).toMatchObject({
      stars: 5,
      cleared: 2,
      bestTotalSeconds: 500,
      complete: true,
    });
  });

  it('is not complete while a stage is unwon', () => {
    const profile = recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won());
    expect(campaignSummary(profile, ['1-1', '1-2']).complete).toBe(false);
  });

  /* A stage attempted and lost contributes nothing but is still counted in the
     total, or the denominator would shrink as a player struggled. */
  it('counts a lost stage in the total and not in the clears', () => {
    const profile = recordStageResult(
      EMPTY_PROFILE,
      '1-2',
      'normal',
      won({ won: false, stars: 0 }),
    );
    expect(campaignSummary(profile, ['1-1', '1-2'])).toMatchObject({ cleared: 0, total: 2 });
  });
});

describe('the region map', () => {
  it('reports the region at a glance', () => {
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won({ stars: 3 }));
    profile = recordStageResult(profile, '1-2', 'normal', won({ stars: 2 }));
    useProfile.setState({ profile, loaded: true });

    render(<RegionMapScreen />);
    expect(screen.getByTestId('region-1-stars')).toHaveTextContent('5 / 110');
    expect(screen.getByTestId('region-1-progress')).toHaveTextContent('2 of 10 stages cleared');
  });

  it('says nothing about a best run until the region is finished', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won()),
      loaded: true,
    });
    render(<RegionMapScreen />);
    expect(screen.getByTestId('region-1-progress')).not.toHaveTextContent('best run');
  });

  it('starts at nothing earned', () => {
    render(<RegionMapScreen />);
    expect(screen.getByTestId('region-1-stars')).toHaveTextContent('0 / 110');
  });
});

describe('the stage list', () => {
  it('shows a best time only for a stage that has been won', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won({ durationSeconds: 245 })),
      loaded: true,
    });

    render(<StageSelectScreen />);
    expect(screen.getByTestId('best-1-1')).toHaveTextContent('4:05');
    expect(screen.queryByTestId('best-1-2')).not.toBeInTheDocument();
  });

  it('carries the region total', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won({ stars: 2 })),
      loaded: true,
    });
    render(<StageSelectScreen />);
    expect(screen.getByTestId('region-total')).toHaveTextContent('2 of 110 stars');
  });

  /* Deliberate, and stated so a later reader does not take it for an oversight. */
  it('leaves every stage playable', () => {
    render(<StageSelectScreen />);
    for (const id of ['1-1', '1-5', '1-10']) {
      expect(screen.getByTestId(`stars-${id}`)).toBeInTheDocument();
    }
    const buttons = screen.getAllByRole('button', { name: /Emberfall|Watchfire|Rift Maw/ });
    for (const button of buttons) expect(button).toBeEnabled();
  });
});

/**
 * Choosing how to play (#48).
 *
 * The rule the screen exists to keep: **a mode is never entered by accident.**
 * Iron is one life and Impossible is a different game, and a single tap that
 * launched whichever mode happened to be remembered would drop a player into
 * one of them with nothing on screen having said so. Tapping a stage opens its
 * modes; nothing starts until one of those is tapped too.
 */
describe('the mode picker', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('shows no modes until a stage is chosen', () => {
    render(<StageSelectScreen />);
    expect(screen.queryByTestId('modes-1-1')).not.toBeInTheDocument();
  });

  it('opens a stage without starting it', () => {
    render(<StageSelectScreen />);

    fireEvent.click(screen.getByTestId('stage-1-1'));

    expect(screen.getByTestId('modes-1-1')).toBeInTheDocument();
    expect(useUiStore.getState().screen).not.toBe('inStage');
    expect(useUiStore.getState().selectedModeId).toBeNull();
  });

  it('offers every mode the stage has', () => {
    render(<StageSelectScreen />);
    fireEvent.click(screen.getByTestId('stage-1-1'));

    for (const mode of modesFor('1-1')) {
      expect(screen.getByTestId(`mode-1-1-${mode.id}`)).toBeInTheDocument();
    }
  });

  it('starts the run only on the second tap', () => {
    render(<StageSelectScreen />);

    fireEvent.click(screen.getByTestId('stage-1-1'));
    fireEvent.click(screen.getByTestId('mode-1-1-veteran'));

    expect(useUiStore.getState()).toMatchObject({
      screen: 'inStage',
      selectedStageId: '1-1',
      selectedModeId: 'veteran',
    });
  });

  /* Opening another stage must not carry the last stage's mode with it. */
  it('forgets the mode when a different stage is opened', () => {
    render(<StageSelectScreen />);

    fireEvent.click(screen.getByTestId('stage-1-1'));
    fireEvent.click(screen.getByTestId('mode-1-1-veteran'));
    expect(useUiStore.getState().selectedModeId).toBe('veteran');

    useUiStore.getState().selectStage('1-2');
    expect(useUiStore.getState().selectedModeId).toBeNull();
  });

  it('shows what each mode has paid', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'veteran', won({ stars: 2 })),
      loaded: true,
    });
    render(<StageSelectScreen />);
    fireEvent.click(screen.getByTestId('stage-1-1'));

    expect(screen.getByTestId('status-veteran')).toHaveTextContent('★★☆');
    expect(screen.getByTestId('status-normal')).toHaveTextContent('☆☆☆');
    expect(screen.getByTestId('stars-1-1')).toHaveTextContent('2 / 11');
  });

  /* A challenge is one star for solving it, and Endless has no stars at all —
     only how far you got. */
  it('scores a challenge as solved and Endless by wave', () => {
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', 'heroic_1_1', won({ stars: 3 }), 1);
    profile = recordStageResult(
      profile,
      '1-1',
      'endless_1_1',
      won({ won: false, stars: 0, wavesCleared: 61 }),
      0,
    );
    useProfile.setState({ profile, loaded: true });

    render(<StageSelectScreen />);
    fireEvent.click(screen.getByTestId('stage-1-1'));

    expect(screen.getByTestId('status-heroic_1_1')).toHaveTextContent('solved');
    expect(screen.getByTestId('status-endless_1_1')).toHaveTextContent('wave 61');
    /* One star from the Heroic, and none from Endless however far it went. */
    expect(screen.getByTestId('stars-1-1')).toHaveTextContent('1 / 11');
  });
});
