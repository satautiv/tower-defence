// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BossInfo } from '@sim/index';
import { BossBar } from '@ui/stage/BossBar';

/**
 * The boss health bar and its phase markers (#33, docs/GAME_DESIGN.md §10).
 *
 * The markers are the reason this is not the ordinary health bar: a boss fight
 * is one the player is meant to pace, and a threshold they cannot see coming
 * is a threshold they cannot prepare for.
 */

afterEach(cleanup);

const BOSS: BossInfo = {
  slot: 0,
  entityId: 7,
  enemyId: 'grendrix',
  hp: 9000,
  maxHp: 18000,
  phase: 0,
  thresholds: [0.5],
};

const NAMES: Record<string, string> = { grendrix: 'Grendrix, the Rift Maw' };

function bar(boss: BossInfo | null): HTMLElement {
  const { container } = render(<BossBar read={() => boss} nameOf={(id) => NAMES[id] ?? id} />);
  return container;
}

describe('the boss bar', () => {
  it('shows nothing at all when no boss is alive', () => {
    const container = bar(null);
    expect(container.querySelector('.ui-boss')).toBeNull();
  });

  it('names the boss rather than printing its id', () => {
    bar(BOSS);
    expect(screen.getByText('Grendrix, the Rift Maw')).toBeInTheDocument();
  });

  it('reports health as a percentage anything can read', () => {
    bar(BOSS);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  /* Drawn from the start, not as each one arrives: the player holding a Warden
     Power for the transition is reading how far away it is. */
  it('draws every threshold, including ones not yet reached', () => {
    const container = bar({ ...BOSS, hp: 18000, phase: 0, thresholds: [0.6, 0.3] });
    expect(container.querySelectorAll('.ui-boss__marker')).toHaveLength(2);
    expect(container.querySelectorAll('.ui-boss__marker--passed')).toHaveLength(0);
  });

  it('dims a threshold already crossed rather than removing it', () => {
    const container = bar({ ...BOSS, hp: 5000, phase: 1, thresholds: [0.6, 0.3] });
    expect(container.querySelectorAll('.ui-boss__marker')).toHaveLength(2);
    expect(container.querySelectorAll('.ui-boss__marker--passed')).toHaveLength(1);
  });

  it('puts a marker where its threshold actually is', () => {
    const container = bar({ ...BOSS, thresholds: [0.5] });
    const marker = container.querySelector('.ui-boss__marker') as HTMLElement;
    expect(marker.style.left).toBe('50%');
  });

  it('counts the phases so the player knows how much fight is left', () => {
    bar({ ...BOSS, phase: 1, thresholds: [0.6, 0.3] });
    expect(screen.getByText('Phase 2 / 3')).toBeInTheDocument();
  });

  /* An elite with no second phase gets a bar and no phase furniture — a
     "Phase 1 / 1" would be noise claiming to be information. */
  it('says nothing about phases for a boss that has none', () => {
    const container = bar({ ...BOSS, thresholds: [] });
    expect(container.querySelector('.ui-boss__phase')).toBeNull();
    expect(container.querySelectorAll('.ui-boss__marker')).toHaveLength(0);
  });

  it('never draws a fill outside the track', () => {
    const over = bar({ ...BOSS, hp: 20000 });
    expect((over.querySelector('.ui-boss__fill') as HTMLElement).style.width).toBe('100%');
    cleanup();
    const under = bar({ ...BOSS, hp: -5 });
    expect((under.querySelector('.ui-boss__fill') as HTMLElement).style.width).toBe('0%');
  });
});
