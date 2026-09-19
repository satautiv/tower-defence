// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildOption, EnemyInfo, NextWave, TowerInfo } from '@sim/index';
import { Hud, QUIT_CONFIRM_MS } from '@ui/hud/Hud';
import type { HudModel } from '@ui/hud/model';
import { BuildMenu } from '@ui/stage/BuildMenu';
import { EnemyPanel } from '@ui/stage/EnemyPanel';
import { TowerPanel } from '@ui/stage/TowerPanel';
import { WavePreview } from '@ui/stage/WavePreview';
import { useUiStore } from '@ui/store';

/**
 * A real pause (#28, docs/GAME_DESIGN.md §17.3): the board stays readable —
 * towers, enemies, the next wave, a tower's range — while nothing that would
 * change the world can be done until play resumes.
 */

beforeEach(() => useUiStore.getState().reset());
afterEach(cleanup);

const pause = (): void => act(() => useUiStore.getState().openPanelById('pause'));

const MODEL: HudModel = {
  lives: 20,
  gold: 600,
  aether: 0,
  wave: 3,
  totalWaves: 10,
  speed: 1,
  paused: false,
};

const STATS = {
  damage: 10,
  rangeTiles: 3,
  fireRate: 1,
  dps: 10,
  damageType: 'kinetic',
  status: null,
  hitsAir: true,
  hitsGround: true,
  multiTarget: false,
};

describe('the top bar while paused', () => {
  it('becomes the pause menu, in place of the wave counter', () => {
    render(<Hud source={() => MODEL} onRestart={vi.fn()} onQuit={vi.fn()} />);
    expect(screen.getByText('Wave 3 / 10')).toBeInTheDocument();

    pause();
    expect(screen.getByTestId('paused')).toHaveTextContent('Paused');
    expect(screen.queryByText('Wave 3 / 10')).toBeNull();
  });

  /* §17.3: instant restart, one tap, no confirmation. */
  it('restarts on a single tap', () => {
    const onRestart = vi.fn();
    render(<Hud source={() => MODEL} onRestart={onRestart} onQuit={vi.fn()} />);
    pause();

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  /* On a phone the bar covers the top row of plots; a tap meant for one must
     not abandon the run. */
  it('quits only on a second tap', () => {
    const onQuit = vi.fn();
    render(<Hud source={() => MODEL} onRestart={vi.fn()} onQuit={onQuit} />);
    pause();

    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(onQuit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Quit?' }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('turns the pause button into resume, which unpauses at once', () => {
    render(<Hud source={() => MODEL} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(useUiStore.getState().openPanel).toBe('pause');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(useUiStore.getState().openPanel).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('locks the speed control', () => {
    const onSpeed = vi.fn();
    render(<Hud source={() => MODEL} onSpeed={onSpeed} />);
    pause();

    const fast = screen.getByRole('button', { name: '3× speed' });
    expect(fast).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(fast);
    expect(onSpeed).not.toHaveBeenCalled();
  });
});

describe('an armed quit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('disarms itself if the second tap does not come', () => {
    const onQuit = vi.fn();
    render(<Hud source={() => MODEL} onRestart={vi.fn()} onQuit={onQuit} />);
    pause();

    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    act(() => vi.advanceTimersByTime(QUIT_CONFIRM_MS));
    fireEvent.click(screen.getByRole('button', { name: 'Quit' }));
    expect(onQuit).not.toHaveBeenCalled();
  });
});

describe('actions locked by the pause', () => {
  it('lets the build menu preview a range, but not build', () => {
    const onBuild = vi.fn();
    const onHover = vi.fn();
    const option: BuildOption = {
      typeIdx: 0,
      id: 'arbalest_post',
      cost: 100,
      affordable: true,
      stats: STATS,
    };
    render(
      <BuildMenu
        options={[option]}
        at={{ x: 0, y: 0 }}
        onBuild={onBuild}
        onCancel={vi.fn()}
        onHover={onHover}
        locked
      />,
    );

    const button = screen.getByRole('button', { name: /Build arbalest_post/ });
    fireEvent.pointerEnter(button);
    fireEvent.click(button);
    expect(onHover).toHaveBeenCalledWith(0);
    expect(onBuild).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a tower in full, but will not upgrade or sell it', () => {
    const onUpgrade = vi.fn();
    const onSell = vi.fn();
    const tower: TowerInfo = {
      slot: 0,
      id: 'arbalest_post',
      tier: 0,
      specialisation: -1,
      current: STATS,
      invested: 100,
      sellValue: 70,
      targetMode: 0,
      upgrade: { cost: 80, affordable: true, before: STATS, after: { ...STATS, dps: 14 } },
      specialisations: [],
      undoable: false,
    };
    render(
      <TowerPanel
        tower={tower}
        undoSeconds={0}
        onUpgrade={onUpgrade}
        onSpecialise={vi.fn()}
        onSell={onSell}
        onUndo={vi.fn()}
        onClose={vi.fn()}
        locked
      />,
    );

    /* The upgrade's before-and-after still reads, for planning. */
    expect(screen.getByText('14')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Upgrade/ }));
    fireEvent.click(screen.getByRole('button', { name: /Sell/ }));
    expect(onUpgrade).not.toHaveBeenCalled();
    expect(onSell).not.toHaveBeenCalled();
  });

  it('shows the next wave, but will not call it', () => {
    const onCall = vi.fn();
    const wave: NextWave = {
      index: 2,
      total: 10,
      enemies: [{ enemyId: 'husk', count: 5, threats: [] }],
      startsInSeconds: 9,
      callBonus: 13,
      canCall: true,
    };
    render(
      <WavePreview read={() => wave} atlas={null} nameOf={(id) => id} onCall={onCall} locked />,
    );

    expect(screen.getByTestId('wave-preview')).toHaveTextContent('×5');
    fireEvent.click(screen.getByRole('button', { name: /Call wave 3/ }));
    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('reading an enemy', () => {
  const ENEMY: EnemyInfo = {
    slot: 3,
    entityId: 41,
    enemyId: 'ironclad_revenant',
    hp: 183.4,
    maxHp: 260,
    overshield: 0,
    armour: 24,
    baseArmour: 40,
    ward: 0,
    baseWard: 0,
    speed: 0.7,
    baseSpeed: 0.7,
    statuses: [{ id: 'corrode', stacks: 2, secondsLeft: 3.25 }],
    threats: ['armoured'],
    bounty: 14,
    livesCost: 1,
  };

  function show(enemy: EnemyInfo = ENEMY): void {
    render(
      <EnemyPanel
        enemy={enemy}
        atlas={null}
        nameOf={() => 'Ironclad Revenant'}
        statusOf={() => 'Corrode'}
        onClose={vi.fn()}
      />,
    );
  }

  it('names it and shows its health', () => {
    show();
    expect(screen.getByRole('heading')).toHaveTextContent('Ironclad Revenant');
    expect(screen.getByTestId('enemy-hp')).toHaveTextContent('184 / 260');
  });

  /* "Why is this one getting through" needs the live number, and what it was. */
  it('shows armour as it stands now, beside what it started as', () => {
    show();
    expect(screen.getByTestId('enemy-armour')).toHaveTextContent('24 of 40');
  });

  it('shows an untouched stat once, without a comparison', () => {
    show();
    expect(screen.getByTestId('enemy-speed')).toHaveTextContent(/^0\.7 tiles\/s$/);
  });

  it('says frozen rather than a speed of nought', () => {
    show({ ...ENEMY, speed: 0 });
    expect(screen.getByTestId('enemy-speed')).toHaveTextContent('Frozen');
  });

  it('lists statuses with stacks and time left, and the threat it poses', () => {
    show();
    expect(screen.getByRole('list', { name: 'Statuses' })).toHaveTextContent('Corrode ×2 · 3.3s');
    expect(screen.getByTestId('enemy-panel')).toHaveTextContent('Armoured');
    expect(screen.getByTestId('enemy-panel')).toHaveTextContent('14 gold');
  });
});
