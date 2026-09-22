import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  DamageFlag,
  EnemyFlag,
  STATUS_BY_INDEX,
  STATUS_COUNT,
  STATUS_INDEX,
  SimEventKind,
  advance,
  applyStatus,
  createWorldForStage,
  damageResolutionSystem,
  enemyIndex,
  enemyInfo,
  spawnEnemy,
  speedMultiplier,
  statusSystem,
  tick,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * The status substrate (#21, docs/GAME_DESIGN.md §4.2).
 *
 * Every expected number here is read back out of the authored content rather
 * than typed in, so these tests check that the code honours the data — not that
 * two copies of the same constant agree. A balance edit to statuses.json moves
 * the assertions with it; a code change that stops reading the table fails.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

const authored = (id: string) => {
  const status = registry.statuses.get(id);
  if (status === undefined) throw new Error(`status ${id} missing`);
  return status;
};

/**
 * A husk tough enough to survive anything below, but no tougher.
 *
 * Health is a Float32Array, so its resolution shrinks as the number grows — at
 * a million the gap between representable values is 0.0625, which is most of a
 * single tick of Corrode. Ten thousand keeps a burn measurable.
 */
function target(world: World, id = 'husk'): number {
  const slot = spawnEnemy(world, enemyIndex(world, id), 0);
  world.enemies.hp[slot] = 10_000;
  world.enemies.maxHp[slot] = 10_000;
  world.enemies.armour[slot] = 0;
  world.enemies.ward[slot] = 0;
  return slot;
}

const stacks = (world: World, slot: number, status: string): number =>
  world.enemies.stacksOf(slot, STATUS_INDEX[status as keyof typeof STATUS_INDEX]);

const expiryOf = (world: World, slot: number, status: string): number =>
  world.enemies.statusExpiry[
    slot * STATUS_COUNT + STATUS_INDEX[status as keyof typeof STATUS_INDEX]
  ] as number;

const apply = (world: World, slot: number, status: string, count: number): void =>
  applyStatus(world, slot, STATUS_INDEX[status as keyof typeof STATUS_INDEX], count);

const hpLost = (world: World, slot: number): number =>
  (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

/** One full tick of ageing followed by resolution, without the rest of the board. */
function statusTick(world: World): void {
  statusSystem(world);
  damageResolutionSystem(world);
  /* The pipeline leaves this to the consumer, which drains once per frame. */
  world.events.clear();
  world.tick++;
}

/**
 * Runs the world forward to a given tick.
 *
 * Expiry is stated as the tick a status is gone on, so the tests that check it
 * are clearest when they can step to exactly that tick and one past it, rather
 * than counting ticks relative to whenever the status happened to land.
 */
function advanceTo(world: World, targetTick: number): void {
  advance(world, Math.max(0, targetTick - world.tick));
}

describe('applying a status', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  it.each(['scorch', 'chill', 'charge', 'corrode', 'unravel', 'fracture'])(
    'puts %s on an enemy for its authored duration',
    (id) => {
      apply(world, slot, id, 1);
      expect(stacks(world, slot, id)).toBe(1);
      expect(expiryOf(world, slot, id)).toBe(
        world.tick + Math.round(authored(id).durationSeconds * TICK_HZ),
      );
    },
  );

  it.each(['scorch', 'charge', 'corrode', 'unravel', 'fracture'])(
    'stacks %s up to its cap and no further',
    (id) => {
      const max = authored(id).maxStacks;
      for (let i = 0; i < max + 5; i++) apply(world, slot, id, 1);
      expect(stacks(world, slot, id)).toBe(max);
    },
  );

  it('adds several stacks at once', () => {
    apply(world, slot, 'scorch', 3);
    expect(stacks(world, slot, 'scorch')).toBe(3);
  });

  /* "4s (refreshing)" — a second hit restarts the whole block rather than
     ageing two timers side by side, which is all one expiry per pair can hold. */
  it('refreshes the duration on reapplication', () => {
    apply(world, slot, 'scorch', 1);
    const first = expiryOf(world, slot, 'scorch');

    advance(world, 60);
    apply(world, slot, 'scorch', 1);

    expect(expiryOf(world, slot, 'scorch')).toBe(first + 60);
    expect(stacks(world, slot, 'scorch')).toBe(2);
  });

  it('ignores a zero or negative application', () => {
    apply(world, slot, 'scorch', 0);
    apply(world, slot, 'scorch', -3);
    expect(stacks(world, slot, 'scorch')).toBe(0);
  });

  it('does nothing to a free slot', () => {
    world.enemies.free(slot);
    apply(world, slot, 'scorch', 2);
    expect(stacks(world, slot, 'scorch')).toBe(0);
  });

  it('announces the resulting stack count, not the number applied', () => {
    apply(world, slot, 'scorch', 4);
    world.events.clear();
    /* Four already on, cap of five: this hit adds one, and the icon must read 5. */
    apply(world, slot, 'scorch', 3);

    const event = world.events.at(0);
    expect(event.kind).toBe(SimEventKind.StatusApplied);
    expect(event.b).toBe(STATUS_INDEX.scorch);
    expect(event.c).toBe(authored('scorch').maxStacks);
  });

  it('marks the enemy for the reaction system to re-examine', () => {
    world.enemies.statusDirty[slot] = 0;
    apply(world, slot, 'scorch', 1);
    expect(world.enemies.statusDirty[slot]).toBe(1);
  });
});

describe('decay and expiry', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  /**
   * One presence rule, checked at the boundary: a status is on the enemy for
   * exactly the ticks where `tick < expiry`. Off by one here and every damage
   * total, slow window and reaction pairing shifts with it.
   */
  it.each(['scorch', 'chill', 'charge', 'corrode', 'unravel', 'fracture'])(
    'holds %s until its deadline, then drops every stack together',
    (id) => {
      apply(world, slot, id, 2);
      const deadline = expiryOf(world, slot, id);
      expect(deadline).toBe(Math.round(authored(id).durationSeconds * TICK_HZ));

      /* Survives every sweep before its deadline... */
      advanceTo(world, deadline);
      expect(stacks(world, slot, id)).toBe(2);

      /* ...and goes on the first sweep at it. */
      advanceTo(world, deadline + 1);
      expect(stacks(world, slot, id)).toBe(0);
      expect(expiryOf(world, slot, id)).toBe(0);
    },
  );

  /* Chill lasts 3s and fracture 6s, so there is a window where only one holds.
     Fracture is the partner precisely because it does not react: Chill beside
     Scorch would detonate into a Thermal Shock and consume them both. */
  it('expires statuses independently of one another', () => {
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'fracture', 1);

    advanceTo(world, expiryOf(world, slot, 'chill') + 1);
    expect(stacks(world, slot, 'chill')).toBe(0);
    expect(stacks(world, slot, 'fracture')).toBe(1);
  });

  it('marks the enemy dirty when a status lapses, as an application would', () => {
    apply(world, slot, 'scorch', 1);
    advanceTo(world, expiryOf(world, slot, 'scorch'));

    world.enemies.statusDirty[slot] = 0;
    /* Read between step 2 and step 3. The reaction system consumes this flag,
       so a whole tick would have cleared it again before the test looked. */
    statusSystem(world);
    expect(world.enemies.statusDirty[slot]).toBe(1);
  });
});

describe('damage over time', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  /**
   * The burn goes into the shared queue, not straight onto health. That is what
   * lets a kill by fire award bounty and split a Chitin Mother through exactly
   * the path a projectile's kill takes.
   */
  it('queues onto the one damage queue rather than touching health', () => {
    apply(world, slot, 'scorch', 2);
    world.tick++;

    statusSystem(world);
    expect(world.damage.count).toBe(1);
    expect(hpLost(world, slot)).toBe(0);

    damageResolutionSystem(world);
    expect(hpLost(world, slot)).toBeGreaterThan(0);
  });

  /* Measured where it is queued rather than where it lands: health is float32,
     and a single tick of Corrode is finer than that array's resolution. */
  it.each([
    ['scorch', 1],
    ['scorch', 5],
    ['corrode', 1],
    ['corrode', 5],
  ])('burns %s at the authored rate for %i stacks', (id, count) => {
    apply(world, slot, id, count);
    const perTick = authored(id).damagePerSecondPerStack / TICK_HZ;

    world.tick++;
    statusSystem(world);
    expect(world.damage.count).toBe(1);
    expect(world.damage.amount[0]).toBeCloseTo(perTick * count, 5);
  });

  /**
   * Burns on exactly the ticks it is present for, and not one more.
   *
   * Applied here before the first sweep, so it burns on all 240 ticks of a 4s
   * Scorch. Arriving on a hit it would burn 239 times, because a status applied
   * at step 11 has already missed step 2 of that tick — a shortfall of one tick
   * that is the same for every status and every source.
   */
  it('burns on every tick it is present for, then stops', () => {
    apply(world, slot, 'scorch', 3);
    const lifetime = Math.round(authored('scorch').durationSeconds * TICK_HZ);
    const perTick = (authored('scorch').damagePerSecondPerStack / TICK_HZ) * 3;

    let burns = 0;
    for (let i = 0; i < lifetime + 30; i++) {
      statusSystem(world);
      burns += world.damage.count;
      damageResolutionSystem(world);
      world.events.clear();
      world.tick++;
    }

    expect(burns).toBe(lifetime);
    expect(stacks(world, slot, 'scorch')).toBe(0);
    expect(hpLost(world, slot)).toBeCloseTo(perTick * lifetime, 1);
  });

  it('deals no damage for a status that has none', () => {
    apply(world, slot, 'chill', 5);
    world.tick++;
    statusSystem(world);
    expect(world.damage.count).toBe(0);
  });

  /* Scorch is Pyro's status and Corrode is Toxic's, so their burns are reduced
     by ward like any other non-physical damage — never by armour. */
  it.each([
    ['scorch', DAMAGE_INDEX.pyro],
    ['corrode', DAMAGE_INDEX.toxic],
  ])('burns %s as its own element', (id, expected) => {
    apply(world, slot, id, 1);
    world.tick++;
    statusSystem(world);
    expect(world.damage.type[0]).toBe(expected);
  });

  /* Being on fire is not something you dodge — that is what makes damage over
     time the answer to an evasive enemy. */
  it('cannot be evaded', () => {
    apply(world, slot, 'scorch', 1);
    world.tick++;
    statusSystem(world);
    expect((world.damage.flags[0] as number) & DamageFlag.Evadable).toBe(0);
  });

  it('does not burn an enemy already dying or leaked', () => {
    apply(world, slot, 'scorch', 3);
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Dying;

    world.tick++;
    statusSystem(world);
    expect(world.damage.count).toBe(0);
  });
});

describe('chill escalating into freeze', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  it('does not freeze below the cap', () => {
    apply(world, slot, 'chill', authored('chill').maxStacks - 1);
    expect(stacks(world, slot, 'freeze')).toBe(0);
  });

  it('freezes at exactly the authored cap, however the stacks arrive', () => {
    const max = authored('chill').maxStacks;
    for (let i = 1; i < max; i++) {
      apply(world, slot, 'chill', 1);
      expect(stacks(world, slot, 'freeze')).toBe(0);
    }
    apply(world, slot, 'chill', 1);
    expect(stacks(world, slot, 'freeze')).toBe(1);
  });

  it('freezes on a single overwhelming application too', () => {
    apply(world, slot, 'chill', 99);
    expect(stacks(world, slot, 'freeze')).toBe(1);
  });

  /* Five chill and a freeze must never be observable together: the conversion
     happens the instant the last stack lands. */
  it('drops chill to the authored remainder as it converts', () => {
    apply(world, slot, 'chill', authored('chill').maxStacks);
    expect(stacks(world, slot, 'chill')).toBe(authored('chill').stacksAfterEscalation);
  });

  it('freezes for the authored duration and then thaws', () => {
    apply(world, slot, 'chill', authored('chill').maxStacks);
    const deadline = expiryOf(world, slot, 'freeze');
    expect(deadline).toBe(Math.round(authored('freeze').durationSeconds * TICK_HZ));

    advanceTo(world, deadline);
    expect(speedMultiplier(world, slot)).toBe(0);

    advanceTo(world, deadline + 1);
    expect(stacks(world, slot, 'freeze')).toBe(0);
    expect(speedMultiplier(world, slot)).toBeGreaterThan(0);
  });

  it('immobilises while it holds', () => {
    apply(world, slot, 'chill', authored('chill').maxStacks);
    const before = world.enemies.pathDist[slot] as number;
    advanceTo(world, expiryOf(world, slot, 'freeze'));
    expect(world.enemies.pathDist[slot]).toBe(before);
  });

  /* Reaching the cap again after thawing must re-freeze: the second freeze is
     what a dedicated Cryo board is buying. */
  it('freezes again the next time chill is driven back to the cap', () => {
    const max = authored('chill').maxStacks;
    apply(world, slot, 'chill', max);
    advanceTo(world, expiryOf(world, slot, 'freeze') + 1);
    expect(stacks(world, slot, 'freeze')).toBe(0);

    apply(world, slot, 'chill', max);
    expect(stacks(world, slot, 'freeze')).toBe(1);
  });
});

describe('bosses provably cannot be frozen', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
    world.enemies.flags[slot] =
      (world.enemies.flags[slot] as number) | EnemyFlag.Boss | EnemyFlag.FreezeImmune;
  });

  it('refuses freeze applied directly', () => {
    apply(world, slot, 'freeze', 1);
    expect(stacks(world, slot, 'freeze')).toBe(0);
  });

  it('refuses freeze arriving through chill escalation', () => {
    apply(world, slot, 'chill', 99);
    expect(stacks(world, slot, 'freeze')).toBe(0);
  });

  /**
   * And keeps the full slow instead. An immunity that also cost the boss three
   * stacks of chill would reward it twice for the same trait.
   */
  it('holds chill at the cap rather than converting it away', () => {
    apply(world, slot, 'chill', 99);
    expect(stacks(world, slot, 'chill')).toBe(authored('chill').maxStacks);
  });

  it('never stops moving, however much chill it carries', () => {
    apply(world, slot, 'chill', 99);
    expect(speedMultiplier(world, slot)).toBeGreaterThan(0);
  });

  /* Slow capped at 25% for a boss (docs/GAME_DESIGN.md §10), where five stacks
     of chill would otherwise take 60%. */
  it('caps the slow at a quarter', () => {
    apply(world, slot, 'chill', 99);
    expect(speedMultiplier(world, slot)).toBeCloseTo(0.75, 5);
  });

  it('still takes every status that is not hard control', () => {
    for (const id of ['scorch', 'charge', 'corrode', 'unravel', 'fracture']) {
      apply(world, slot, id, 2);
      expect(stacks(world, slot, id)).toBe(2);
    }
  });
});

describe('statuses arriving on a hit', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  const hit = (status: number, count: number, flags = DamageFlag.None): void => {
    world.damage.push(slot, 1, DAMAGE_INDEX.cryo, -1, flags, status, count);
    damageResolutionSystem(world);
  };

  /* The whole point of routing on-hit statuses through the one applier: a Frost
     Cairn stacking a target to five freezes it, without the firing code
     knowing that Freeze exists. */
  it('escalates a hit-applied chill into freeze at the cap', () => {
    hit(STATUS_INDEX.chill, authored('chill').maxStacks);
    expect(stacks(world, slot, 'freeze')).toBe(1);
    expect(stacks(world, slot, 'chill')).toBe(authored('chill').stacksAfterEscalation);
  });

  it('respects freeze immunity on a hit-applied chill', () => {
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.FreezeImmune;
    hit(STATUS_INDEX.chill, 99);
    expect(stacks(world, slot, 'freeze')).toBe(0);
  });

  it('applies nothing when the hit is flagged not to', () => {
    hit(STATUS_INDEX.chill, 2, DamageFlag.NoStatus);
    expect(stacks(world, slot, 'chill')).toBe(0);
  });
});

describe('the pipeline runs statuses in the right place', () => {
  /**
   * Statuses age at step 2 and reactions resolve at step 3, so what the
   * reaction system sees is the state as of now — an expired chill cannot
   * detonate against a scorch that outlived it (#22).
   */
  it('has aged statuses by the time the rest of the tick runs', () => {
    const world = freshWorld();
    const slot = target(world);
    apply(world, slot, 'chill', 1);

    advanceTo(world, expiryOf(world, slot, 'chill'));
    expect(stacks(world, slot, 'chill')).toBe(1);

    /* The sweep at the deadline is step 2, so by the time the rest of this tick
       runs — reactions included — the chill is already gone. */
    tick(world);
    expect(stacks(world, slot, 'chill')).toBe(0);
  });

  it('burns through the queue during a full tick', () => {
    const world = freshWorld();
    const slot = target(world);
    apply(world, slot, 'scorch', 4);

    tick(world);
    expect(hpLost(world, slot)).toBeCloseTo(
      (authored('scorch').damagePerSecondPerStack / TICK_HZ) * 4,
      2,
    );
  });
});

describe('the inspect panel reads the same statuses', () => {
  it('reports stacks and the time left on each', () => {
    const world = freshWorld();
    const slot = target(world);
    const id = world.enemies.ids[slot] as number;

    apply(world, slot, 'scorch', 3);
    advance(world, 60);

    const info = enemyInfo(world, slot, id);
    const scorch = info?.statuses.find((s) => s.id === 'scorch');
    expect(scorch?.stacks).toBe(3);
    expect(scorch?.secondsLeft).toBeCloseTo(authored('scorch').durationSeconds - 1, 3);
  });

  it('lists nothing once everything has lapsed', () => {
    const world = freshWorld();
    const slot = target(world);
    const id = world.enemies.ids[slot] as number;

    apply(world, slot, 'scorch', 3);
    advanceTo(world, expiryOf(world, slot, 'scorch') + 1);
    expect(enemyInfo(world, slot, id)?.statuses).toEqual([]);
  });
});

describe('charge lengthens a chain', () => {
  /**
   * "+1 chain target per 2 stacks" (docs/GAME_DESIGN.md §4.2), which is the
   * only thing Charge does on its own — the rest of its value is the reactions
   * it pairs into. Authored as 0.5 per stack, floored, so an odd stack alone
   * buys nothing and the player can count the pairs.
   */
  it('is authored as half a target per stack', () => {
    const world = freshWorld();
    expect(world.rules.statuses.chainTargetsPerStack[STATUS_INDEX.charge]).toBeCloseTo(0.5, 6);
  });

  it.each([
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
  ])('adds %i stacks of charge to %i extra jumps', (count, expected) => {
    const world = freshWorld();
    const slot = target(world);
    apply(world, slot, 'charge', count);

    const per = world.rules.statuses.chainTargetsPerStack[STATUS_INDEX.charge] as number;
    expect(Math.floor(per * stacks(world, slot, 'charge'))).toBe(expected);
  });

  /* Every other status has to leave a chain's reach alone, or Scorch would
     quietly be doing Charge's job. */
  it('is the only status that lengthens one', () => {
    const world = freshWorld();
    for (const id of STATUS_BY_INDEX) {
      const per = world.rules.statuses.chainTargetsPerStack[STATUS_INDEX[id]] as number;
      expect(per).toBe(id === 'charge' ? 0.5 : 0);
    }
  });
});

describe('the status table is complete', () => {
  /* A status in the content enum with no authored definition would silently
     have a zero duration, expiring the instant it landed. */
  it('has a definition for every status the simulation indexes', () => {
    expect(STATUS_BY_INDEX).toHaveLength(STATUS_COUNT);
    for (const id of STATUS_BY_INDEX) {
      expect(registry.statuses.get(id)).toBeDefined();
      expect(registry.statuses.get(id)!.durationSeconds).toBeGreaterThan(0);
    }
  });

  /* Fracture is the physical build's own scaling lane and deliberately does not
     react (docs/GAME_DESIGN.md §4.2). */
  it('keeps fracture out of the reaction matrix', () => {
    const world = freshWorld();
    expect(world.rules.statuses.reactive[STATUS_INDEX.fracture]).toBe(0);
    for (const id of ['scorch', 'chill', 'charge', 'corrode', 'unravel']) {
      expect(world.rules.statuses.reactive[STATUS_INDEX[id as keyof typeof STATUS_INDEX]]).toBe(1);
    }
  });
});

describe('ageing statuses allocates nothing', () => {
  /**
   * Three hundred burning enemies is the worst case the budget is written
   * around (docs/TECH_DESIGN.md §14.1). Garbage produced here lands in the
   * frame budget on a mid-range phone.
   */
  it('leaves the pools untouched through a full burn across a crowd', () => {
    const world = freshWorld();
    const slots: number[] = [];
    for (let i = 0; i < 300; i++) {
      const slot = target(world);
      if (slot < 0) break;
      slots.push(slot);
      apply(world, slot, 'scorch', 5);
      apply(world, slot, 'corrode', 5);
      apply(world, slot, 'unravel', 5);
    }

    expect(slots.length).toBe(300);
    const watermark = world.enemies.watermark;

    for (let i = 0; i < 400; i++) statusTick(world);

    expect(world.enemies.watermark).toBe(watermark);
    expect(world.damage.dropped).toBe(0);
    expect(world.events.dropped).toBe(0);
    for (const slot of slots) expect(stacks(world, slot, 'scorch')).toBe(0);
  });
});
