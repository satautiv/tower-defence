// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, recordStageResult, useProfile } from '@app/profile';
import { MemorySaveAdapter } from '@platform/index';
import { setProfileStorage } from '@app/profile';
import { TalentsScreen } from '@ui/screens/TalentsScreen';
import type { StageResult } from '@sim/index';

/**
 * The tree as a player touches it.
 *
 * The rules live in `app/talents.ts` and are tested there; what is checked here
 * is that the screen spends the right stars, refuses with a reason a player can
 * act on, and never charges for a respec.
 */

function won(stars: 1 | 2 | 3): StageResult {
  return {
    won: true,
    stars,
    livesRemaining: 20,
    startingLives: 20,
    durationSeconds: 200,
    wavesCleared: 10,
    totalWaves: 10,
    enemiesKilled: 10,
    enemiesLeaked: 0,
    goldEarned: 100,
    towersBuilt: 3,
    reactionsTriggered: 1,
  };
}

beforeEach(() => {
  setProfileStorage(() => new MemorySaveAdapter());
  let profile = EMPTY_PROFILE;
  for (let i = 1; i <= 6; i++) profile = recordStageResult(profile, `1-${i}`, won(3));
  useProfile.setState({ profile, loaded: true });
});

afterEach(cleanup);

describe('the talent screen', () => {
  it('shows what has been earned and what is left', () => {
    render(<TalentsScreen />);
    expect(screen.getByTestId('talent-stars')).toHaveTextContent('18 of 18 stars unspent');
  });

  it('spends a star when a rank is taken', () => {
    render(<TalentsScreen />);
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    expect(screen.getByTestId('resonant_bloom-ranks')).toHaveTextContent('1 / 5');
    expect(screen.getByTestId('talent-stars')).toHaveTextContent('17 of 18');
  });

  it('gives the star back', () => {
    render(<TalentsScreen />);
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    fireEvent.click(screen.getByTestId('resonant_bloom-give'));
    expect(screen.getByTestId('resonant_bloom-ranks')).toHaveTextContent('0 / 5');
    expect(screen.getByTestId('talent-stars')).toHaveTextContent('18 of 18');
  });

  /* Naming the prerequisite rather than pointing at the layout: the first
     wording said "the node above", which is wrong for anything whose
     prerequisite is not directly above it. */
  it('names the prerequisite a locked node is waiting on', () => {
    render(<TalentsScreen />);
    expect(screen.getByTestId('cascade-why')).toHaveTextContent('Needs Resonant Bloom');
    expect(screen.getByTestId('cascade-take')).toBeDisabled();
  });

  it('unlocks the dependent once its prerequisite has a rank', () => {
    render(<TalentsScreen />);
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    expect(screen.getByTestId('cascade-take')).toBeEnabled();
    expect(screen.queryByTestId('cascade-why')).not.toBeInTheDocument();
  });

  it('refuses to strip a prerequisite that something still needs', () => {
    render(<TalentsScreen />);
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    fireEvent.click(screen.getByTestId('cascade-take'));
    expect(screen.getByTestId('resonant_bloom-give')).toBeDisabled();
  });

  it('switches branches', () => {
    render(<TalentsScreen />);
    expect(screen.queryByTestId('foundry_edge')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('branch-foundry'));
    expect(screen.getByTestId('foundry_edge')).toBeInTheDocument();
  });

  /* Pillar P5: respec is instant, free, and loses nothing. */
  it('hands every star back on respec, and asks first', () => {
    render(<TalentsScreen />);
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    expect(screen.getByTestId('talent-stars')).toHaveTextContent('16 of 18');

    fireEvent.click(screen.getByRole('button', { name: 'Respec' }));
    fireEvent.click(screen.getByTestId('respec-confirm'));

    expect(screen.getByTestId('talent-stars')).toHaveTextContent('18 of 18 stars unspent');
    expect(screen.getByTestId('resonant_bloom-ranks')).toHaveTextContent('0 / 5');
  });

  it('offers no respec when nothing has been spent', () => {
    render(<TalentsScreen />);
    expect(screen.getByRole('button', { name: 'Respec' })).toBeDisabled();
  });

  it('stops offering ranks the player cannot pay for', () => {
    useProfile.setState({ profile: recordStageResult(EMPTY_PROFILE, '1-1', won(1)), loaded: true });
    render(<TalentsScreen />);
    fireEvent.click(screen.getByTestId('resonant_bloom-take'));
    expect(screen.getByTestId('talent-stars')).toHaveTextContent('0 of 1');
    expect(screen.getByTestId('resonant_bloom-take')).toBeDisabled();
    expect(screen.getByTestId('resonant_bloom-why')).toHaveTextContent('Not enough stars');
  });
});
