import { DAMAGE_BY_INDEX, DamageEventFlag, SimEventKind } from '@sim/index';
import type { World } from '@sim/index';

/**
 * Every source that hit one enemy, and what it actually did (#41).
 *
 * > Turns "why did that die so fast?" from a debugging session into a glance.
 *
 * The acceptance criterion is arithmetic rather than aesthetic — **the log
 * accounts for 100% of an enemy's lost HP** — and that is what shaped it. The
 * log is a pure consumer of the event buffer: `DamageDealt` already fires for
 * every resolved hit from every source, after armour, ward and every
 * multiplier, which is precisely the number that has to add up.
 *
 * Two things had to change in the simulation for the sum to close, and both
 * were gaps rather than features. A hit carries its **source tower** now, so
 * the log can name what hit rather than only total it; and a hit **partly**
 * swallowed by an overshield is reported, where before only a *wholly*
 * swallowed one was — the difference used to vanish, which is exactly the
 * "where did the other forty go" the log exists to answer.
 */

export interface DamageEntry {
  /** Tower slot, or -1 for a burn, a reaction, a soldier or the hero. */
  readonly source: number;
  readonly damageType: string;
  readonly fromReaction: boolean;
  /** Absorbed by an overshield: real damage that cost no health. */
  readonly absorbed: boolean;
  readonly hits: number;
  readonly total: number;
}

export interface DamageLog {
  /** Entity id of the enemy being watched, or -1 for none. */
  readonly enemyId: number;
  readonly entries: readonly DamageEntry[];
  /** Everything that landed, including what an overshield ate. */
  readonly dealt: number;
  /** What the overshield ate, which cost no health. */
  readonly absorbed: number;
  /** `dealt - absorbed`: the health this accounts for. */
  readonly toHealth: number;
}

export const EMPTY_LOG: DamageLog = {
  enemyId: -1,
  entries: [],
  dealt: 0,
  absorbed: 0,
  toHealth: 0,
};

/** Grouped by what dealt it and how, which is the question a player asks. */
function keyOf(source: number, damageType: string, flags: number): string {
  return `${source}:${damageType}:${flags}`;
}

/**
 * Accumulates hits on one enemy across frames.
 *
 * Across frames because the buffer is cleared every frame and a fight lasts
 * hundreds — a log that only ever showed the current frame would be empty
 * almost every time it was looked at.
 */
export class DamageWatcher {
  private watching = -1;
  private readonly totals = new Map<string, DamageEntry>();
  private dealt = 0;
  private absorbed = 0;

  /** Follows a different enemy, forgetting the last one. */
  watch(enemyId: number): void {
    if (enemyId === this.watching) return;
    this.watching = enemyId;
    this.totals.clear();
    this.dealt = 0;
    this.absorbed = 0;
  }

  get enemyId(): number {
    return this.watching;
  }

  consume(world: World): void {
    if (this.watching < 0) return;

    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind !== SimEventKind.DamageDealt || event.a !== this.watching) continue;

      const amount = event.b;
      const damageType = DAMAGE_BY_INDEX[event.c] ?? String(event.c);
      const flags = event.d;
      const source = event.e;

      const key = keyOf(source, damageType, flags);
      const before = this.totals.get(key);
      this.totals.set(key, {
        source,
        damageType,
        fromReaction: (flags & DamageEventFlag.FromReaction) !== 0,
        absorbed: (flags & DamageEventFlag.Absorbed) !== 0,
        hits: (before?.hits ?? 0) + 1,
        total: (before?.total ?? 0) + amount,
      });

      this.dealt += amount;
      if ((flags & DamageEventFlag.Absorbed) !== 0) this.absorbed += amount;
    }
  }

  /** Biggest contributor first, which is the order the question is asked in. */
  read(): DamageLog {
    if (this.watching < 0) return EMPTY_LOG;
    return {
      enemyId: this.watching,
      entries: [...this.totals.values()].sort((a, b) => b.total - a.total),
      dealt: this.dealt,
      absorbed: this.absorbed,
      toHealth: this.dealt - this.absorbed,
    };
  }

  reset(): void {
    this.watch(-1);
  }
}

/**
 * How much health an enemy has lost, for reconciling the log against.
 *
 * Returns -1 once the slot no longer holds that enemy: a recycled slot answers
 * confidently about somebody else, which is worse than not answering.
 */
export function healthLost(world: World, slot: number, enemyId: number): number {
  const enemies = world.enemies;
  if (!enemies.isAlive(slot) || (enemies.ids[slot] as number) !== enemyId) return -1;
  return (enemies.maxHp[slot] as number) - (enemies.hp[slot] as number);
}
