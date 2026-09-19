// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { createWorldForStage, nextWave } from '@sim/index';
import type { NextWave } from '@sim/index';
import type { AtlasIndex } from '@view/assets';
import { INTERACTIVE } from '@ui/components/index';
import { UI_POLL_HZ } from '@ui/hooks/useThrottledValue';
import { SpriteIcon } from '@ui/stage/SpriteIcon';
import { WavePreview } from '@ui/stage/WavePreview';
import { enemyName } from '@ui/text';

/**
 * The wave preview panel (#28). Layout is the Playwright pass's job (#53);
 * what is checked here is that the panel says what the simulation says, and
 * that the call it offers is the call it makes.
 */

afterEach(cleanup);

const WAVE: NextWave = {
  index: 4,
  total: 10,
  enemies: [
    { enemyId: 'husk', count: 8, threats: [] },
    { enemyId: 'rift_bat', count: 4, threats: ['air'] },
  ],
  startsInSeconds: 12,
  callBonus: 18,
  canCall: true,
};

const names = (id: string): string => ({ husk: 'Husk', rift_bat: 'Rift Bat' })[id] ?? id;

function show(wave: NextWave | null, onCall = vi.fn()): { onCall: ReturnType<typeof vi.fn> } {
  render(<WavePreview read={() => wave} atlas={null} nameOf={names} onCall={onCall} />);
  return { onCall };
}

describe('what the panel says', () => {
  it('names the wave, its place in the stage, and when it starts', () => {
    show(WAVE);
    expect(screen.getByTestId('wave-preview')).toHaveTextContent('Next wave 5/10');
    expect(screen.getByTestId('wave-timer')).toHaveTextContent('in 12s');
  });

  it('lists every enemy with its count', () => {
    show(WAVE);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('×8Husk');
    expect(rows[1]).toHaveTextContent('×4Rift Bat');
  });

  it('spells out threats in words, on the enemy that brings them', () => {
    show(WAVE);
    const [husk, bat] = screen.getAllByRole('listitem');
    expect(bat).toHaveTextContent('Air');
    expect(husk).not.toHaveTextContent('Air');
  });

  /* A phone has no room for a tag per enemy, so the heading carries them all. */
  it('gathers every threat into the heading, most pressing first', () => {
    show({
      ...WAVE,
      enemies: [
        { enemyId: 'ironclad_revenant', count: 2, threats: ['armoured'] },
        { enemyId: 'rift_bat', count: 3, threats: ['air'] },
        { enemyId: 'wyrm', count: 1, threats: ['boss', 'air'] },
      ],
    });
    const gathered = screen
      .getByTestId('wave-preview')
      .querySelectorAll('.ui-wave__threats--gathered abbr');
    expect([...gathered].map((chip) => chip.getAttribute('title'))).toEqual([
      'Boss',
      'Air',
      'Armoured',
    ]);
    expect([...gathered].map((chip) => chip.textContent)).toEqual(['Boss', 'Air', 'Arm']);
  });

  it('says so once no wave is left to come, and offers no call', () => {
    show(null);
    expect(screen.getByTestId('wave-preview')).toHaveTextContent('Final wave');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('takes pointer input, although the overlay around it does not', () => {
    show(WAVE);
    expect(screen.getByTestId('wave-preview')).toHaveClass(INTERACTIVE);
  });
});

describe('calling the wave', () => {
  it('shows the bonus a call pays, and calls when pressed', () => {
    const { onCall } = show(WAVE);
    const button = screen.getByRole('button', { name: 'Call wave 5 now for 18 bonus gold' });
    expect(button).toHaveTextContent('+18');

    fireEvent.click(button);
    expect(onCall).toHaveBeenCalledTimes(1);
  });

  it('promises nothing when the timer has run out', () => {
    show({ ...WAVE, callBonus: 0 });
    const button = screen.getByRole('button', { name: 'Call wave 5 now' });
    expect(button).not.toHaveTextContent('+');
  });

  it('refuses, and says why, while the board is full', () => {
    const { onCall } = show({ ...WAVE, canCall: false });
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('wave-preview')).toHaveTextContent('Too many waves');

    fireEvent.click(button);
    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('keeping up with the simulation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('follows the countdown and the next wave as they change', () => {
    let current: NextWave | null = WAVE;
    render(<WavePreview read={() => current} atlas={null} nameOf={names} onCall={vi.fn()} />);

    current = { ...WAVE, startsInSeconds: 11, callBonus: 16 };
    act(() => vi.advanceTimersByTime(1000 / UI_POLL_HZ));
    expect(screen.getByTestId('wave-timer')).toHaveTextContent('in 11s');
    expect(screen.getByRole('button')).toHaveTextContent('+16');

    current = null;
    act(() => vi.advanceTimersByTime(1000 / UI_POLL_HZ));
    expect(screen.getByTestId('wave-preview')).toHaveTextContent('Final wave');
  });
});

describe('against a real stage', () => {
  it('shows wave one of 1-1 by name, from the shipped content', () => {
    const registry = buildRegistry(readContentFromDisk());
    const stage = registry.stages.get('1-1');
    if (stage === undefined) throw new Error('stage 1-1 missing');
    const world = createWorldForStage(registry, stage, 1);

    render(
      <WavePreview read={() => nextWave(world)} atlas={null} nameOf={enemyName} onCall={vi.fn()} />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('×5Riftling');
    expect(screen.getByTestId('wave-preview')).toHaveTextContent('Next wave 1/10');
  });
});

describe('enemy icons', () => {
  const atlas: AtlasIndex = {
    image: 'assets/atlas/game.png',
    width: 264,
    height: 210,
    frames: new Map([['enemy_husk', { x: 127, y: 143, w: 48, h: 48 }]]),
  };

  it('cuts the sprite out of the atlas, scaled to the icon', () => {
    render(<SpriteIcon atlas={atlas} frame="enemy_husk" size={24} label="Husk" />);
    const icon = screen.getByRole('img', { name: 'Husk' });

    /* 48px frame into 24px: everything halves. */
    expect(icon.style.width).toBe('24px');
    expect(icon.style.backgroundSize).toBe('132px 105px');
    expect(icon.style.backgroundPosition).toBe('-63.5px -71.5px');
    expect(icon.style.backgroundImage).toContain('assets/atlas/game.png');
  });

  /* A wrong picture would say a different enemy is coming. */
  it('shows an initial rather than a wrong picture for an unknown frame', () => {
    render(<SpriteIcon atlas={atlas} frame="enemy_wyrm" size={24} label="Dread Wyrm" />);
    const icon = screen.getByRole('img', { name: 'Dread Wyrm' });
    expect(icon).toHaveTextContent('D');
    expect(icon.style.backgroundImage).toBe('');
  });

  it('shows an initial until the atlas has loaded', () => {
    render(<SpriteIcon atlas={null} frame="enemy_husk" size={24} label="Husk" />);
    expect(screen.getByRole('img', { name: 'Husk' })).toHaveTextContent('H');
  });
});
