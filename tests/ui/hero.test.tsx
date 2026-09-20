// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { HeroBar } from '@ui/stage/HeroBar';
import type { HeroInfo } from '@sim/index';

/**
 * The hero's HUD (#25).
 *
 * §11 asks for a portrait, health, ability buttons with cooldowns and a
 * visible respawn timer. The timer is the part worth testing hardest: a player
 * without their hero needs to know how long they are without it.
 */

afterEach(cleanup);

const hero = (over: Partial<HeroInfo> = {}): HeroInfo => ({
  id: 'kaelen',
  level: 3,
  hp: 450,
  maxHp: 600,
  down: false,
  respawnIn: 0,
  abilities: [
    { index: 0, id: 'aether_bolt', ready: true, cooldownRemaining: 0 },
    { index: 1, id: 'ward_break', ready: false, cooldownRemaining: 9 },
    { index: 2, id: 'conduit_surge', ready: true, cooldownRemaining: 0 },
  ],
  ...over,
});

const bar = (info: HeroInfo | null, props: Record<string, unknown> = {}) =>
  render(
    <HeroBar
      hero={info}
      armed={-1}
      onArm={vi.fn()}
      name={(id) => id}
      abilityName={(_heroId, abilityId) => abilityId.replace(/_/g, ' ')}
      {...props}
    />,
  );

describe('the hero bar', () => {
  it('shows nothing when no hero is deployed', () => {
    bar(null);
    expect(screen.queryByTestId('hero-bar')).toBeNull();
  });

  it('names the hero and its level', () => {
    bar(hero());
    expect(screen.getByText('kaelen')).toBeInTheDocument();
    expect(screen.getByText('Lv 3')).toBeInTheDocument();
  });

  /* Health is a bar because the question it answers — "should I pull them
     out" — is a shape question, not an arithmetic one. */
  it('shows health as a proportion', () => {
    bar(hero());
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '75');
  });

  it('lists all three abilities', () => {
    bar(hero());
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('counts down an ability that is cooling', () => {
    bar(hero());
    expect(screen.getByText('9s')).toBeInTheDocument();
  });

  it('arms one that is ready', () => {
    const onArm = vi.fn();
    bar(hero(), { onArm });

    fireEvent.click(screen.getByRole('button', { name: /aether bolt/i }));
    expect(onArm).toHaveBeenCalledWith(0);
  });

  it('will not arm one that is cooling', () => {
    const onArm = vi.fn();
    bar(hero(), { onArm });

    fireEvent.click(screen.getByRole('button', { name: /ward break/i }));
    expect(onArm).not.toHaveBeenCalled();
  });

  it('says which one is waiting for a target', () => {
    bar(hero(), { armed: 0 });
    expect(screen.getByRole('button', { name: /aether bolt/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /* §11 asks for the respawn timer by name. */
  it('replaces the health bar with a countdown while the hero is down', () => {
    bar(hero({ down: true, respawnIn: 17, hp: 0 }));
    expect(screen.getByRole('status')).toHaveTextContent('Returning in 17s');
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('will not cast while the game is paused', () => {
    const onArm = vi.fn();
    bar(hero(), { onArm, locked: true });

    fireEvent.click(screen.getByRole('button', { name: /aether bolt/i }));
    expect(onArm).not.toHaveBeenCalled();
  });
});
