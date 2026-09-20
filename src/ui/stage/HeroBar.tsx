import type { ReactElement } from 'react';
import type { HeroInfo } from '@sim/index';
import { Button, INTERACTIVE, cx } from '../components/index.js';

export interface HeroBarProps {
  hero: HeroInfo | null;
  /** Index of the ability awaiting a target tap, or -1. */
  armed: number;
  onArm: (index: number) => void;
  /** Paused: the bar reads, nothing casts. */
  locked?: boolean;
  name: (heroId: string) => string;
  abilityName: (heroId: string, abilityId: string) => string;
}

/**
 * The hero's portrait, health and three abilities.
 *
 * Health is a bar rather than a number because the question it answers is
 * "should I pull them out", which is a shape question and not an arithmetic
 * one. While the hero is down the bar becomes the respawn countdown, which
 * §11 asks for by name: a player without their hero needs to know how long
 * they are without it, and guessing is the difference between holding a line
 * and abandoning it.
 */
export function HeroBar({
  hero,
  armed,
  onArm,
  locked = false,
  name,
  abilityName,
}: HeroBarProps): ReactElement | null {
  if (hero === null) return null;

  const health = hero.maxHp > 0 ? hero.hp / hero.maxHp : 0;

  return (
    <div className={cx(INTERACTIVE, 'ui-hero')} data-testid="hero-bar">
      <div className="ui-hero__who">
        <span className="ui-hero__name">{name(hero.id)}</span>
        <span className="ui-hero__level">Lv {hero.level}</span>
      </div>

      {hero.down ? (
        <div className="ui-hero__down" role="status">
          Returning in {hero.respawnIn}s
        </div>
      ) : (
        <div
          className="ui-hero__health"
          role="meter"
          aria-label="Hero health"
          aria-valuenow={Math.round(health * 100)}
        >
          <span
            className={cx('ui-hero__health-fill', health <= 0.4 && 'ui-hero__health-fill--low')}
            style={{ width: `${Math.max(0, health) * 100}%` }}
          />
        </div>
      )}

      <div className="ui-hero__abilities">
        {hero.abilities.map((ability) => {
          const isArmed = armed === ability.index;
          const cooling = ability.cooldownRemaining > 0;

          return (
            <Button
              key={ability.id}
              variant={isArmed ? 'primary' : 'secondary'}
              className="ui-hero__ability"
              disabled={!ability.ready}
              aria-disabled={locked || undefined}
              aria-pressed={isArmed}
              title={locked ? 'Resume to cast' : undefined}
              onClick={() => {
                if (!locked && ability.ready) onArm(ability.index);
              }}
            >
              <span className="ui-hero__ability-name">{abilityName(hero.id, ability.id)}</span>
              {/* Abilities cost no Aether (§11), so a ready one shows nothing
                  but its name — there is no price to weigh. */}
              {cooling && (
                <span className="ui-hero__ability-cool">{ability.cooldownRemaining}s</span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
