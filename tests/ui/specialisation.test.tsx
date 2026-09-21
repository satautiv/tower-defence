// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TierStats, TowerInfo } from '@sim/index';
import { TowerPanel } from '@ui/stage/TowerPanel';

/**
 * The tier-4 choice, side by side (#27, #32).
 *
 * The one irreversible decision a player makes about a tower, and the two
 * branches routinely land within a few points of each other on DPS — so the
 * panel has to put them next to each other and say what each one *does*,
 * or it is offering a coin flip with extra steps.
 */

afterEach(cleanup);

const STATS: TierStats = {
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

const TOWER: TowerInfo = {
  slot: 0,
  id: 'arbalest_post',
  nameKey: 'tower.arbalest_post.name',
  tier: 2,
  specialisation: -1,
  current: STATS,
  invested: 208,
  sellValue: 145,
  targetMode: 0,
  upgrade: null,
  specialisations: [
    {
      branch: 0,
      id: 'sniper_nest',
      nameKey: 'tower.sniper_nest.name',
      cost: 360,
      affordable: true,
      after: { ...STATS, dps: 49.5, rangeTiles: 14 },
      perkKeys: ['tower.sniper_nest.perk.pierce'],
    },
    {
      branch: 1,
      id: 'repeater_battery',
      nameKey: 'tower.repeater_battery.name',
      cost: 360,
      affordable: false,
      after: { ...STATS, dps: 52, rangeTiles: 8, multiTarget: true },
      perkKeys: ['tower.repeater_battery.perk.rate'],
    },
  ],
  undoable: false,
  leyNode: null,
  rallyRangeTiles: 0,
  soldiersAlive: 0,
  soldierCount: 0,
  kills: 0,
  damageDealt: 0,
};

const NAMES: Record<string, string> = {
  'tower.sniper_nest.name': 'Sniper Nest',
  'tower.repeater_battery.name': 'Repeater Battery',
};
const PERKS: Record<string, string> = {
  'tower.sniper_nest.perk.pierce': 'Half of any armour in the way counts for nothing.',
  'tower.repeater_battery.perk.rate': 'No trick — just no gap between shots.',
};

function panel(over: Partial<TowerInfo> = {}, props: Record<string, unknown> = {}): HTMLElement {
  const { container } = render(
    <TowerPanel
      tower={{ ...TOWER, ...over }}
      undoSeconds={0}
      onUpgrade={vi.fn()}
      onSpecialise={vi.fn()}
      onSell={vi.fn()}
      onUndo={vi.fn()}
      onClose={vi.fn()}
      text={(key) => NAMES[key] ?? PERKS[key] ?? key}
      {...props}
    />,
  );
  return container;
}

describe('the tier-4 branch comparison', () => {
  /* Both options used to carry the *tower's* id, so every tower on the board
     offered "Arbalest Post" against "Arbalest Post". */
  it('names each branch as itself', () => {
    panel();
    expect(screen.getByText('Sniper Nest')).toBeInTheDocument();
    expect(screen.getByText('Repeater Battery')).toBeInTheDocument();
  });

  it('puts the two in columns, not in a list', () => {
    const container = panel();
    expect(container.querySelectorAll('.ui-branches')).toHaveLength(1);
    expect(container.querySelectorAll('.ui-branch')).toHaveLength(2);
  });

  it('says what each branch does, in words', () => {
    panel();
    expect(screen.getByText(PERKS['tower.sniper_nest.perk.pierce']!)).toBeInTheDocument();
    expect(screen.getByText(PERKS['tower.repeater_battery.perk.rate']!)).toBeInTheDocument();
  });

  /* The numbers a player compares are the ones that differ, and they have to
     be readable in both columns at once rather than by tapping through. */
  it('shows each branch its own stats', () => {
    panel();
    expect(screen.getByText('49.5')).toBeInTheDocument();
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('DPS (per target)')).toBeInTheDocument();
  });

  it('takes the branch the player picks', () => {
    const onSpecialise = vi.fn();
    panel({}, { onSpecialise });
    fireEvent.click(screen.getAllByRole('button', { name: /Choose/ })[0]!);
    expect(onSpecialise).toHaveBeenCalledWith(0);
  });

  it('will not sell a branch the player cannot afford', () => {
    const onSpecialise = vi.fn();
    panel({}, { onSpecialise });
    fireEvent.click(screen.getAllByRole('button', { name: /Choose/ })[1]!);
    expect(onSpecialise).not.toHaveBeenCalled();
  });

  it('offers nothing at all when there is no branch point', () => {
    const container = panel({ specialisations: [] });
    expect(container.querySelector('.ui-branches')).toBeNull();
  });
});
