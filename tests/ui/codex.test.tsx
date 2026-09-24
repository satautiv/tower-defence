// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexView } from '@ui/codex/CodexView';
import { Hud } from '@ui/hud/Hud';
import type { HudModel } from '@ui/hud/model';

import { CodexScreen } from '@ui/screens/CodexScreen';
import { isPaused, useUiStore } from '@ui/store';
import { EMPTY_PROFILE, useProfile } from '@app/profile';
import { recordFindings } from '@app/codex';

/**
 * The Codex on screen (#38, docs/GAME_DESIGN.md §15).
 *
 * The maths is `tests/app/codex.test.ts`'s job. What is checked here is what a
 * player can actually reach: that an undiscovered entry keeps its row and
 * loses its contents, that search crosses the tabs, and that an enemy's
 * counter-play hint — the one line anybody opens this for — is on the page.
 */

const MODEL: HudModel = {
  lives: 20,
  gold: 600,
  aether: 0,
  wave: 3,
  totalWaves: 10,
  speed: 1,
  paused: false,
};

const known = recordFindings(EMPTY_PROFILE, {
  towers: ['frost_cairn'],
  enemies: ['bulwark_golem'],
  reactions: ['thermal_shock'],
});

beforeEach(() => {
  useProfile.setState({ profile: known, loaded: true });
  useUiStore.getState().reset();
});
afterEach(cleanup);

describe('what the Codex shows', () => {
  it('opens on reactions, the thing it exists to explain', () => {
    render(<CodexView />);
    expect(screen.getByTestId('codex-entry-thermal_shock')).toBeInTheDocument();
  });

  /* Discovery tracking only means something when the denominator is visible,
     so an unfound entry keeps its row and loses its contents. */
  it('keeps a row for what has not been found, without giving it away', () => {
    render(<CodexView />);
    const found = screen.getByTestId('codex-entry-thermal_shock');
    const unfound = screen.getByTestId('codex-entry-combustion');

    expect(found).toBeEnabled();
    expect(unfound).toBeDisabled();
    expect(unfound).toHaveTextContent('undiscovered');
    expect(unfound).not.toHaveTextContent('Combustion');
  });

  it('counts what is left to find', () => {
    render(<CodexView />);
    expect(screen.getByTestId('codex-progress')).toHaveTextContent('3 of');
  });

  it('opens an entry onto its stats and closes it again', () => {
    render(<CodexView />);
    expect(screen.queryByTestId('codex-detail-thermal_shock')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('codex-entry-thermal_shock'));
    const detail = screen.getByTestId('codex-detail-thermal_shock');
    /* The exact formula, which is the whole criterion. */
    expect(detail).toHaveTextContent('40');
    expect(detail).toHaveTextContent('12 per stack of scorch');

    fireEvent.click(screen.getByTestId('codex-entry-thermal_shock'));
    expect(screen.queryByTestId('codex-detail-thermal_shock')).not.toBeInTheDocument();
  });

  /* The one line a player came for. */
  it('tells a player how to fight an enemy they have killed', () => {
    render(<CodexView />);
    fireEvent.click(screen.getByTestId('codex-tab-enemies'));
    fireEvent.click(screen.getByTestId('codex-entry-bulwark_golem'));

    expect(screen.getByTestId('codex-counter-bulwark_golem')).toHaveTextContent('behind the road');
  });

  /* Statuses and damage types are reference, not reward: a player meeting
     Scorch for the first time has to be able to look it up. */
  it('opens the rules of the game to a player who has found nothing', () => {
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    render(<CodexView />);

    fireEvent.click(screen.getByTestId('codex-tab-statuses'));
    expect(screen.getByTestId('codex-entry-scorch')).toBeEnabled();

    fireEvent.click(screen.getByTestId('codex-tab-damage'));
    expect(screen.getByTestId('codex-entry-kinetic')).toBeEnabled();
  });
});

describe('search', () => {
  it('crosses the tabs rather than staying in one', () => {
    render(<CodexView />);
    fireEvent.click(screen.getByTestId('codex-tab-damage'));
    fireEvent.change(screen.getByTestId('codex-search'), { target: { value: 'chill' } });

    const list = within(screen.getByTestId('codex-list'));
    /* The status itself, and the reaction that eats it. */
    expect(list.getByTestId('codex-entry-chill')).toBeInTheDocument();
    expect(list.getByTestId('codex-entry-thermal_shock')).toBeInTheDocument();
  });

  it('finds an enemy by a trait rather than only by its name', () => {
    render(<CodexView />);
    fireEvent.change(screen.getByTestId('codex-search'), { target: { value: 'directional' } });
    expect(screen.getByTestId('codex-entry-bulwark_golem')).toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    render(<CodexView />);
    fireEvent.change(screen.getByTestId('codex-search'), { target: { value: 'qqzz' } });
    expect(screen.getByTestId('codex-empty')).toBeInTheDocument();
  });

  it('is cleared by choosing a tab', () => {
    render(<CodexView />);
    fireEvent.change(screen.getByTestId('codex-search'), { target: { value: 'chill' } });
    fireEvent.click(screen.getByTestId('codex-tab-towers'));
    expect(screen.getByTestId('codex-search')).toHaveValue('');
  });
});

describe('the screen from the menu', () => {
  it('is the same view, with a way back', () => {
    useUiStore.setState({ screen: 'codex' });
    render(<CodexScreen />);

    expect(screen.getByTestId('codex')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(useUiStore.getState().screen).toBe('menu');
  });
});

/**
 * The second acceptance criterion, and the one the design is specific about:
 *
 * > Accessible while paused during a stage, **without leaving the board**.
 *
 * "Without leaving" is not a phrasing choice. The in-stage screen owns the Pixi
 * application, so navigating to a Codex screen would unmount the renderer and
 * rebuild it on the way back — over a run the player had merely wanted to look
 * something up in. So the Codex opens as a *panel*, and the tests below check
 * the two things that makes true: the screen never changes, and the board stays
 * paused while it is open.
 */
describe('reaching it from a paused board', () => {
  it('is offered on the pause menu and opens a panel rather than a screen', () => {
    useUiStore.getState().openPanelById('pause');
    render(
      <Hud
        source={() => MODEL}
        onSpeed={() => {}}
        onCodex={() => useUiStore.getState().openPanelById('codex')}
      />,
    );

    fireEvent.click(screen.getByTestId('open-codex'));

    expect(useUiStore.getState().openPanel).toBe('codex');
    /* The whole point: still in the stage. */
    expect(useUiStore.getState().screen).not.toBe('codex');
  });

  /* Opening the Codex replaces the pause panel, so "paused" has to mean both
     — or the wave starts moving again behind the page a player opened to
     understand it. */
  it('leaves the board paused while it is open', () => {
    useUiStore.getState().openPanelById('codex');
    expect(isPaused(useUiStore.getState().openPanel)).toBe(true);
  });

  it('is not paused once the panel is closed', () => {
    useUiStore.getState().closePanel();
    expect(isPaused(useUiStore.getState().openPanel)).toBe(false);
  });

  it('does not offer the button when the stage does not pass one', () => {
    useUiStore.getState().openPanelById('pause');
    render(<Hud source={() => MODEL} onSpeed={() => {}} />);
    expect(screen.queryByTestId('open-codex')).not.toBeInTheDocument();
  });
});

/**
 * Order, which is a usability finding rather than a guess.
 *
 * Opening the Enemies tab after one run put the single Riftling that had
 * actually been killed sixteenth, under a wall of undiscovered rows. The list
 * puts what has been found first while there is anything left to find.
 */
describe('the order entries come in', () => {
  it('puts what has been discovered above what has not', () => {
    render(<CodexView />);
    fireEvent.click(screen.getByTestId('codex-tab-enemies'));

    const rows = screen.getAllByTestId(/^codex-entry-/);
    expect(rows[0]).toHaveAttribute('data-testid', 'codex-entry-bulwark_golem');
    expect(rows[1]).toHaveTextContent('undiscovered');
  });

  it('is alphabetical within a group, so a known list stays findable', () => {
    useProfile.setState({
      profile: recordFindings(EMPTY_PROFILE, {
        towers: [],
        enemies: ['riftling', 'husk', 'bulwark_golem'],
        reactions: [],
      }),
      loaded: true,
    });
    render(<CodexView />);
    fireEvent.click(screen.getByTestId('codex-tab-enemies'));

    const known = screen
      .getAllByTestId(/^codex-entry-/)
      .filter((row) => !row.textContent?.includes('undiscovered'))
      .map((row) => row.getAttribute('data-testid'));
    expect(known).toEqual([
      'codex-entry-bulwark_golem',
      'codex-entry-husk',
      'codex-entry-riftling',
    ]);
  });
});
