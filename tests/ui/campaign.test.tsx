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
 * The campaign gates sequentially (#81): a stage opens when the one before it
 * in the region has been cleared, on any mode or difficulty. Cleared rather
 * than starred — a 1-star scrape on Relaxed has finished the lesson and earned
 * the next one, and gating on mastery would punish exactly the player the
 * talent tree exists to help.
 *
 * Every stage is still listed. A locked row that says what opens it is a
 * signpost; a hidden one is a region that appears to end early.
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

  /* Listed, not hidden: a locked row says what opens it. */
  it('lists every stage in the region, open or not', () => {
    render(<StageSelectScreen />);
    for (const id of ['1-1', '1-5', '1-10']) {
      expect(screen.getByTestId(`stage-${id}`)).toBeInTheDocument();
    }
  });
});

/**
 * The campaign gate (#81).
 *
 * The region's design is exactly one new thing per stage, and that spine only
 * works in order: a player who opens 1-9 first meets the elites having never
 * met Ward or armour, loses, and concludes the game is unfair — which is a
 * pillar P4 failure rather than a player failure.
 */
describe('sequential unlocking', () => {
  beforeEach(() => useUiStore.getState().reset());

  it('opens the first stage of the region and nothing else', () => {
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    render(<StageSelectScreen />);

    expect(screen.getByTestId('stage-1-1')).toBeEnabled();
    expect(screen.getByTestId('stage-1-2')).toBeDisabled();
    expect(screen.getByTestId('stage-1-10')).toBeDisabled();
  });

  it('says what opens a locked stage rather than showing it no score', () => {
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    render(<StageSelectScreen />);

    expect(screen.getByTestId('lock-1-2')).toHaveTextContent('Clear 1-1 to unlock');
    expect(screen.queryByTestId('stars-1-2')).not.toBeInTheDocument();
    /* The open stage still shows what it has paid. */
    expect(screen.getByTestId('stars-1-1')).toBeInTheDocument();
    expect(screen.queryByTestId('lock-1-1')).not.toBeInTheDocument();
  });

  it('opens the next stage when the one before it is cleared', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won()),
      loaded: true,
    });
    render(<StageSelectScreen />);

    expect(screen.getByTestId('stage-1-2')).toBeEnabled();
    expect(screen.getByTestId('stage-1-3')).toBeDisabled();
  });

  /* Relaxed pays no stars at all, which is exactly why the gate reads clears. */
  it('counts a clear on any mode, including one that pays no stars', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'relaxed', won({ stars: 0 }), 0),
      loaded: true,
    });
    render(<StageSelectScreen />);

    expect(screen.getByTestId('stage-1-2')).toBeEnabled();
  });

  it('does not open a stage on a loss', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won({ won: false, stars: 0 })),
      loaded: true,
    });
    render(<StageSelectScreen />);

    expect(screen.getByTestId('stage-1-2')).toBeDisabled();
  });

  it('cannot open the mode picker on a locked stage', () => {
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    render(<StageSelectScreen />);

    fireEvent.click(screen.getByTestId('stage-1-2'));

    expect(screen.queryByTestId('modes-1-2')).not.toBeInTheDocument();
    expect(useUiStore.getState().screen).not.toBe('inStage');
  });

  /* A stale selection must not leave a locked stage expanded. */
  it('keeps a locked stage shut even when it is the selected one', () => {
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    useUiStore.getState().selectStage('1-7');
    render(<StageSelectScreen />);

    expect(screen.queryByTestId('modes-1-7')).not.toBeInTheDocument();
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

  /* §14.2 gates Endless on 3-starring the stage, and it is the only mode
     gated at all. A two-hundred-wave leaderboard in front of a player still
     learning the road is not a reward. */
  it('locks Endless until the stage has been three-starred', () => {
    render(<StageSelectScreen />);
    fireEvent.click(screen.getByTestId('stage-1-1'));

    const button = screen.getByTestId('mode-1-1-endless_1_1');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('3-star this stage to unlock');
    expect(screen.getByTestId('mode-1-1-impossible')).toBeEnabled();

    fireEvent.click(button);
    expect(useUiStore.getState().screen).not.toBe('inStage');
  });

  it('opens Endless once it has been', () => {
    useProfile.setState({
      profile: recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won({ stars: 3 })),
      loaded: true,
    });
    render(<StageSelectScreen />);
    fireEvent.click(screen.getByTestId('stage-1-1'));

    expect(screen.getByTestId('mode-1-1-endless_1_1')).toBeEnabled();
  });

  /* A challenge is one star for solving it, and Endless has no stars at all —
     only how far you got. */
  it('scores a challenge as solved and Endless by wave', () => {
    /* Three-starred on Normal so Endless is open, which is what §14.2 asks. */
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', 'normal', won({ stars: 3 }));
    profile = recordStageResult(profile, '1-1', 'heroic_1_1', won({ stars: 3 }), 1);
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
    /* Three from Normal and one from the Heroic; none from Endless however
       far it went. */
    expect(screen.getByTestId('stars-1-1')).toHaveTextContent('4 / 11');
  });
});
