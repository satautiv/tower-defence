import { beforeEach, describe, expect, it } from 'vitest';
import { TICK_HZ, TILE_SIZE } from '@core/constants';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  DAMAGE_INDEX,
  EnemyFlag,
  STATUS_INDEX,
  SimEventKind,
  advance,
  applyStatus,
  createWorldForStage,
  damageResolutionSystem,
  effectiveDefence,
  enemyIndex,
  hashWorld,
  reactionSystem,
  spawnEnemy,
  statusSystem,
  targetingSystem,
  tick,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * The Aether Reaction system (#22, docs/GAME_DESIGN.md §4).
 *
 * The most important system in the game, so the numbers are checked exactly
 * rather than approximately — and every expected figure is computed from the
 * authored content, so a retune of reactions.json moves the assertions with it
 * instead of breaking them.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

const freshWorld = (seed = 1): World => createWorldForStage(registry, stage, seed, FULL_ROSTER);

const reaction = (id: string) => {
  const found = registry.reactions.get(id);
  if (found === undefined) throw new Error(`reaction ${id} missing`);
  return found;
};

const rowOf = (world: World, id: string): number => world.rules.reactions.ids.indexOf(id);

/**
 * An enemy with no defences and plenty of health.
 *
 * Armour and ward are zeroed so a reaction's damage arrives unreduced and can
 * be compared against the authored figure directly; the formula itself is
 * tests/sim/damage.test.ts's job.
 */
function target(world: World, x = 500, y = 500): number {
  const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
  world.enemies.hp[slot] = 10_000;
  world.enemies.maxHp[slot] = 10_000;
  world.enemies.armour[slot] = 0;
  world.enemies.ward[slot] = 0;
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = y;
  return slot;
}

const apply = (world: World, slot: number, status: string, count: number): void =>
  applyStatus(world, slot, STATUS_INDEX[status as keyof typeof STATUS_INDEX], count);

const stacks = (world: World, slot: number, status: string): number =>
  world.enemies.stacksOf(slot, STATUS_INDEX[status as keyof typeof STATUS_INDEX]);

const hpLost = (world: World, slot: number): number =>
  (world.enemies.maxHp[slot] as number) - (world.enemies.hp[slot] as number);

/**
 * Runs the reaction step against positions the spatial index knows about.
 *
 * The indexes are rebuilt at step 7 and reactions run at step 3, so a test that
 * places enemies by hand has to seed the index before anything can be found
 * near anything else.
 */
function react(world: World): void {
  targetingSystem(world);
  reactionSystem(world);
  damageResolutionSystem(world);
}

function reactionEvents(world: World): Array<{ row: number; magnitude: number }> {
  const out: Array<{ row: number; magnitude: number }> = [];
  for (let i = 0; i < world.events.count; i++) {
    const event = world.events.at(i);
    if (event.kind === SimEventKind.ReactionTriggered) {
      out.push({ row: event.a, magnitude: event.d });
    }
  }
  return out;
}

describe('the matrix is authored, not coded', () => {
  it('carries every reaction the design names', () => {
    const world = freshWorld();
    expect([...world.rules.reactions.ids]).toEqual([
      'thermal_shock',
      'superconduct',
      'electrolysis',
      'combustion',
      'amplify',
    ]);
  });

  /* Authored order is priority order, and Amplify must come last or it would
     pre-empt every real reaction on any enemy carrying Unravel. */
  it('keeps amplify at the bottom of the priority order', () => {
    const world = freshWorld();
    expect(rowOf(world, 'amplify')).toBe(world.rules.reactions.count - 1);
  });

  it('locks every damaging reaction behind the same 1.2s cooldown', () => {
    for (const id of ['thermal_shock', 'superconduct', 'electrolysis', 'combustion']) {
      expect(reaction(id).cooldownSeconds).toBe(1.2);
    }
    expect(reaction('amplify').cooldownSeconds).toBe(4);
  });
});

describe('thermal shock', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  /** `40 + 12 × ScorchStacks` Arcane, from the authored figures. */
  const expected = (scorch: number): number =>
    reaction('thermal_shock').baseDamage + reaction('thermal_shock').damagePerStack * scorch;

  it.each([1, 2, 3, 4, 5])('deals 40 + 12 per scorch stack at %i stacks', (count) => {
    apply(world, slot, 'scorch', count);
    apply(world, slot, 'chill', 1);

    react(world);
    expect(hpLost(world, slot)).toBeCloseTo(expected(count), 2);
  });

  it('consumes both statuses', () => {
    apply(world, slot, 'scorch', 3);
    apply(world, slot, 'chill', 2);

    react(world);
    expect(stacks(world, slot, 'scorch')).toBe(0);
    expect(stacks(world, slot, 'chill')).toBe(0);
  });

  /* Arcane ignores armour and is met by ward, which is what makes a warded
     enemy a puzzle rather than a stat wall (§4.3). */
  it('arrives as arcane, so armour does not blunt it', () => {
    world.enemies.armour[slot] = 200;
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);

    react(world);
    expect(hpLost(world, slot)).toBeCloseTo(expected(1), 2);
  });

  it('is reduced by ward', () => {
    world.enemies.ward[slot] = registry.tuning.defenceHalfPoint;
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);

    react(world);
    expect(hpLost(world, slot)).toBeCloseTo(expected(1) / 2, 2);
  });

  it('catches everything inside its radius', () => {
    const near = target(world, 500 + TILE_SIZE, 500);
    const far = target(world, 500 + TILE_SIZE * 4, 500);
    apply(world, slot, 'scorch', 2);
    apply(world, slot, 'chill', 1);

    react(world);
    expect(hpLost(world, near)).toBeCloseTo(expected(2), 2);
    expect(hpLost(world, far)).toBe(0);
  });

  it('is scaled by reaction power', () => {
    world.reactionPower = 2;
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);

    react(world);
    expect(hpLost(world, slot)).toBeCloseTo(expected(1) * 2, 2);
  });
});

describe('superconduct', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
    world.enemies.armour[slot] = 100;
    world.enemies.ward[slot] = 100;
  });

  const softened = (base: number): number => base * reaction('superconduct').defenceMultiplier;

  it('strips armour and ward by the authored fraction', () => {
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'charge', 1);
    react(world);

    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(softened(100), 3);
    expect(effectiveDefence(world, slot, false, 0, 0, 0)).toBeCloseTo(softened(100), 3);
  });

  it('holds for the authored duration and then lapses', () => {
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'charge', 1);
    react(world);

    const ticks = reaction('superconduct').defenceSeconds * TICK_HZ;
    advance(world, ticks - 2);
    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(softened(100), 3);

    advance(world, 3);
    expect(effectiveDefence(world, slot, true, 0, 0, 0)).toBeCloseTo(100, 3);
  });

  it('softens every enemy in its radius, not only the one that reacted', () => {
    const near = target(world, 500 + TILE_SIZE, 500);
    world.enemies.armour[near] = 100;
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'charge', 1);

    react(world);
    expect(effectiveDefence(world, near, true, 0, 0, 0)).toBeCloseTo(softened(100), 3);
  });

  it('deals no damage of its own', () => {
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'charge', 1);
    react(world);
    expect(hpLost(world, slot)).toBe(0);
  });

  /**
   * The reason reactions run at step 3 and damage at step 11: a Superconduct
   * has to strip the armour in time for this very tick's volley to land on the
   * softened target, not the next one's.
   */
  it('strips armour in time for the same tick`s damage', () => {
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'charge', 1);

    targetingSystem(world);
    reactionSystem(world);
    world.damage.push(slot, 100, DAMAGE_INDEX.kinetic, -1);
    damageResolutionSystem(world);

    const half = registry.tuning.defenceHalfPoint;
    const defence = softened(100);
    expect(hpLost(world, slot)).toBeCloseTo(100 * (1 - defence / (defence + half)), 2);
  });
});

describe('electrolysis', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  const charge = (s: number): void => {
    apply(world, s, 'charge', 1);
    apply(world, s, 'corrode', 1);
  };

  it('arcs to the authored number of neighbours for the authored damage', () => {
    const neighbours: number[] = [];
    for (let i = 1; i <= 6; i++) neighbours.push(target(world, 500 + i * 16, 500));
    charge(slot);

    react(world);

    const struck = neighbours.filter((n) => hpLost(world, n) > 0);
    expect(struck).toHaveLength(reaction('electrolysis').jumps);
    for (const n of struck) {
      expect(hpLost(world, n)).toBeCloseTo(reaction('electrolysis').baseDamage, 2);
    }
  });

  /* Nearest first, so the arc reads as travelling outward rather than picking
     whichever enemy the spatial hash listed first. */
  it('takes the nearest neighbours', () => {
    const near: number[] = [];
    for (let i = 1; i <= 4; i++) near.push(target(world, 500 + i * 12, 500));
    const distant = target(world, 500 + TILE_SIZE * 2, 500);
    charge(slot);

    react(world);
    for (const n of near) expect(hpLost(world, n)).toBeGreaterThan(0);
    expect(hpLost(world, distant)).toBe(0);
  });

  it('leaves a stack of corrode on everything it strikes', () => {
    const neighbour = target(world, 516, 500);
    charge(slot);

    react(world);
    expect(stacks(world, neighbour, 'corrode')).toBe(
      reaction('electrolysis').appliesStatus?.stacks,
    );
  });

  /* Electrolysis is the crowd answer in the matrix; the enemy that detonated is
     the source of the arc, not one of its targets. */
  it('does not damage the enemy that reacted', () => {
    target(world, 516, 500);
    charge(slot);

    react(world);
    expect(hpLost(world, slot)).toBe(0);
  });

  it('does nothing at all with no neighbours to reach', () => {
    charge(slot);
    react(world);
    expect(hpLost(world, slot)).toBe(0);
    expect(reactionEvents(world)).toHaveLength(1);
  });
});

describe('combustion', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  it('deals its damage over the authored seconds rather than at once', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'corrode', 1);
    react(world);

    /* Nothing lands on the tick it triggers; the burn starts next tick. */
    expect(hpLost(world, slot)).toBe(0);

    const seconds = reaction('combustion').damageOverSeconds;
    advance(world, seconds * TICK_HZ);
    expect(hpLost(world, slot)).toBeCloseTo(reaction('combustion').baseDamage, 0);
  });

  it('stops burning once the authored window closes', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'corrode', 1);
    react(world);

    advance(world, reaction('combustion').damageOverSeconds * TICK_HZ + 120);
    expect(hpLost(world, slot)).toBeCloseTo(reaction('combustion').baseDamage, 0);
    expect(world.enemies.burnPerTick[slot]).toBe(0);
  });

  it('ignites neighbours with the authored scorch', () => {
    const neighbour = target(world, 500 + TILE_SIZE, 500);
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'corrode', 1);

    react(world);
    expect(stacks(world, neighbour, 'scorch')).toBe(reaction('combustion').appliesStatus?.stacks);
  });

  /**
   * The ignition is explicitly something that happens to the enemies *around*
   * the one that detonated. Re-scorching the target it just took Scorch from
   * would be a loop looking for somewhere to start.
   */
  it('does not re-scorch the enemy that reacted', () => {
    target(world, 500 + TILE_SIZE, 500);
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'corrode', 1);

    react(world);
    expect(stacks(world, slot, 'scorch')).toBe(0);
  });
});

describe('amplify', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  it('adds the authored stacks to the status it matched', () => {
    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'scorch', 1);

    react(world);
    expect(stacks(world, slot, 'scorch')).toBe(1 + reaction('amplify').bonusStacks);
  });

  it('consumes nothing', () => {
    apply(world, slot, 'unravel', 2);
    apply(world, slot, 'scorch', 1);

    react(world);
    expect(stacks(world, slot, 'unravel')).toBe(2);
  });

  it('extends that status by the authored multiplier', () => {
    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'scorch', 1);

    react(world);
    const base = registry.statuses.get('scorch')!.durationSeconds * TICK_HZ;
    const at = slot * 7 + STATUS_INDEX.scorch;
    expect(world.enemies.statusExpiry[at]).toBe(
      world.tick + Math.round(base * reaction('amplify').durationMultiplier),
    );
  });

  /* Fracture is the pure-physical build's own scaling lane and is marked
     non-reactive, so it must never be what Amplify grabs. */
  it('never matches fracture', () => {
    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'fracture', 1);

    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
    expect(stacks(world, slot, 'fracture')).toBe(1);
  });

  it('does not fire on unravel alone', () => {
    apply(world, slot, 'unravel', 3);
    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
  });

  /* A real reaction always beats Amplify, because the matrix is authored in
     priority order and Amplify is last. */
  it('yields to a real reaction when both could fire', () => {
    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);

    react(world);
    expect(reactionEvents(world)[0]?.row).toBe(rowOf(world, 'thermal_shock'));
  });

  /* Amplifying a fourth stack of Chill into a fifth freezes, exactly as a Frost
     Cairn's fifth hit would — because it goes through the one applier. */
  it('can push chill over the line into a freeze', () => {
    apply(world, slot, 'chill', 3);
    apply(world, slot, 'unravel', 1);

    react(world);
    expect(stacks(world, slot, 'freeze')).toBe(1);
  });
});

describe('the per-enemy cooldown', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  const detonate = (): void => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    react(world);
    world.events.clear();
  };

  /**
   * The anti-spam rule. Without it a Flame Vent beside a Frost Cairn would
   * machine-gun Thermal Shocks and trivialise the game (§4.3), so this is a
   * balance guarantee rather than an optimisation.
   */
  it('refuses a second reaction before the lockout lapses', () => {
    detonate();
    const ticks = reaction('thermal_shock').cooldownSeconds * TICK_HZ;

    for (let i = 0; i < ticks - 2; i++) {
      apply(world, slot, 'scorch', 1);
      apply(world, slot, 'chill', 1);
      react(world);
      expect(reactionEvents(world)).toHaveLength(0);
      world.events.clear();
    }
  });

  it('allows one again the moment it does', () => {
    detonate();
    advance(world, reaction('thermal_shock').cooldownSeconds * TICK_HZ);

    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    react(world);
    expect(reactionEvents(world)).toHaveLength(1);
  });

  /* The pair is still there while the lockout runs, so the reaction fires the
     tick it lapses rather than waiting for some unrelated status to land. */
  it('fires as soon as it lapses, without needing a fresh application', () => {
    detonate();
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);

    /* One past the lockout, so the tick that runs *at* the ready tick has
       happened rather than merely been reached. */
    advance(world, reaction('thermal_shock').cooldownSeconds * TICK_HZ + 1);
    expect(stacks(world, slot, 'scorch')).toBe(0);
    expect(world.stats.reactionsTriggered).toBe(2);
  });

  it('gives amplify its own longer lockout', () => {
    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'scorch', 1);
    react(world);
    world.events.clear();

    const shortCooldown = reaction('thermal_shock').cooldownSeconds * TICK_HZ;
    advance(world, shortCooldown + 2);

    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'scorch', 1);
    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
  });

  it('is per enemy, not global', () => {
    const other = target(world, 2000, 2000);
    detonate();

    apply(world, other, 'scorch', 1);
    apply(world, other, 'chill', 1);
    react(world);
    expect(reactionEvents(world)).toHaveLength(1);
  });

  it('resolves at most one reaction per enemy per tick', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    apply(world, slot, 'charge', 1);
    apply(world, slot, 'corrode', 1);

    react(world);
    expect(reactionEvents(world)).toHaveLength(1);
  });
});

describe('chains cannot run away', () => {
  /**
   * The acceptance criterion, and the reason the cooldown exists at all. A
   * Combustion ignites its neighbours, whose Scorch can meet their Chill and
   * detonate in turn — which must terminate, and must stay bounded however
   * tightly the enemies are packed.
   */
  it('bounds a packed crowd to one reaction per enemy per tick', () => {
    const world = freshWorld();
    const slots: number[] = [];
    for (let i = 0; i < 40; i++) {
      const slot = target(world, 500 + (i % 8) * 8, 500 + Math.floor(i / 8) * 8);
      slots.push(slot);
      applyStatus(world, slot, STATUS_INDEX.scorch, 5);
      applyStatus(world, slot, STATUS_INDEX.corrode, 5);
    }

    targetingSystem(world);
    reactionSystem(world);
    expect(world.stats.reactionsTriggered).toBeLessThanOrEqual(slots.length);
  });

  /**
   * Combustion is the chaining reaction: it ignites its neighbours with Scorch,
   * which can meet their Corrode and combust in turn. Packed tight enough that
   * every blast covers the whole crowd, so if anything can accelerate away this
   * is the shape that does it.
   */
  it('settles rather than accelerating, left to run', () => {
    const world = freshWorld();
    const count = 40;
    for (let i = 0; i < count; i++) {
      const slot = target(world, 500 + (i % 8) * 8, 500 + Math.floor(i / 8) * 8);
      applyStatus(world, slot, STATUS_INDEX.scorch, 5);
      applyStatus(world, slot, STATUS_INDEX.corrode, 5);
    }

    let previous = 0;
    let worst = 0;
    for (let second = 0; second < 10; second++) {
      for (let t = 0; t < TICK_HZ; t++) {
        advance(world, 1);
        /* Drained every frame, as the view and audio layers do — the pipeline
           deliberately leaves the buffer for the consumer to clear. */
        world.events.clear();
      }
      const inSecond = world.stats.reactionsTriggered - previous;
      previous = world.stats.reactionsTriggered;
      if (inSecond > worst) worst = inSecond;
    }

    /* Consecutive reactions on one enemy are 1.2s apart, so no one-second
       window can hold two of them: the ceiling is one per enemy, whatever the
       chain does. Exceeding it means the cooldown is not holding. */
    expect(worst).toBeLessThanOrEqual(count);
    expect(world.stats.reactionsTriggered).toBeGreaterThan(0);
    expect(world.damage.dropped).toBe(0);
    expect(world.events.dropped).toBe(0);
  });
});

describe('throughput under the worst case', () => {
  /**
   * Three hundred enemies is the budget's worst case (docs/TECH_DESIGN.md
   * §14.1), and a board that reaction-heavy is exactly where the mechanic would
   * cost the most. Two things are asserted: the work per tick is bounded by the
   * cooldown rather than by how densely enemies are packed, and nothing is
   * silently dropped from a buffer when it is.
   */
  function crowd(world: World, count: number): number[] {
    const slots: number[] = [];
    for (let i = 0; i < count; i++) {
      /* Twenty across, packed a third of a tile apart, so every blast overlaps
         many neighbours and the chain has somewhere to go. */
      const slot = target(world, 300 + (i % 20) * 20, 300 + Math.floor(i / 20) * 20);
      if (slot < 0) break;
      slots.push(slot);
      applyStatus(world, slot, STATUS_INDEX.scorch, 5);
      applyStatus(world, slot, STATUS_INDEX.chill, 5);
      applyStatus(world, slot, STATUS_INDEX.charge, 5);
      applyStatus(world, slot, STATUS_INDEX.corrode, 5);
      applyStatus(world, slot, STATUS_INDEX.unravel, 5);
    }
    return slots;
  }

  it('never resolves more reactions in a tick than there are enemies', () => {
    const world = freshWorld();
    const slots = crowd(world, 300);
    expect(slots).toHaveLength(300);

    let worst = 0;
    let previous = 0;
    for (let t = 0; t < TICK_HZ * 10; t++) {
      advance(world, 1);
      const inTick = world.stats.reactionsTriggered - previous;
      previous = world.stats.reactionsTriggered;
      if (inTick > worst) worst = inTick;
      world.events.clear();
    }

    expect(worst).toBeLessThanOrEqual(slots.length);
    expect(world.stats.reactionsTriggered).toBeGreaterThan(0);
  });

  it('drops nothing from the damage queue or the event buffer', () => {
    const world = freshWorld();
    crowd(world, 300);

    for (let t = 0; t < TICK_HZ * 10; t++) {
      advance(world, 1);
      expect(world.damage.dropped, `damage overflowed on tick ${t}`).toBe(0);
      expect(world.events.dropped, `events overflowed on tick ${t}`).toBe(0);
      world.events.clear();
    }
  });

  /* A measurement rather than a guarantee, so the threshold is generous: the
     sim's whole budget is 4ms a tick and reactions are one of fifteen steps. */
  it('stays far inside the tick budget', () => {
    const world = freshWorld();
    crowd(world, 300);
    /* Warm up, so the first tick's chain is not being timed against a cold
       JIT — and so the measurement is of the steady state. */
    for (let t = 0; t < 120; t++) {
      advance(world, 1);
      world.events.clear();
    }

    const started = performance.now();
    for (let t = 0; t < 600; t++) {
      advance(world, 1);
      world.events.clear();
    }
    const perTick = (performance.now() - started) / 600;

    expect(perTick).toBeLessThan(4);
  });

  it('allocates nothing while resolving them', () => {
    const world = freshWorld();
    crowd(world, 300);
    const watermark = world.enemies.watermark;

    for (let t = 0; t < TICK_HZ * 5; t++) {
      advance(world, 1);
      world.events.clear();
    }
    expect(world.enemies.watermark).toBe(watermark);
  });
});

describe('reactions pay out and report themselves', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  it('counts towards the stage stats', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    react(world);
    expect(world.stats.reactionsTriggered).toBe(1);
  });

  it('charges aether by the authored amount', () => {
    const before = world.resources.aether;
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    react(world);
    expect(world.resources.aether - before).toBeCloseTo(registry.tuning.aetherPerReaction, 5);
  });

  /* The view and audio layers read this to place the VFX and name the reaction
     on its first occurrence in a stage (§4.5). */
  it('emits its identity, position and magnitude', () => {
    apply(world, slot, 'scorch', 3);
    apply(world, slot, 'chill', 1);
    react(world);

    const events = reactionEvents(world);
    expect(events).toHaveLength(1);
    expect(events[0]?.row).toBe(rowOf(world, 'thermal_shock'));
    expect(events[0]?.magnitude).toBeCloseTo(
      reaction('thermal_shock').baseDamage + reaction('thermal_shock').damagePerStack * 3,
      2,
    );
  });

  it('reports its damage as coming from a reaction', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    react(world);

    let fromReaction = 0;
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind === SimEventKind.DamageDealt && event.d === 1) fromReaction++;
    }
    expect(fromReaction).toBeGreaterThan(0);
  });
});

describe('what does not react', () => {
  let world: World;
  let slot: number;
  beforeEach(() => {
    world = freshWorld();
    slot = target(world);
  });

  it('leaves a single status alone', () => {
    apply(world, slot, 'scorch', 5);
    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
    expect(stacks(world, slot, 'scorch')).toBe(5);
  });

  it.each([
    ['scorch', 'fracture'],
    ['chill', 'fracture'],
    ['corrode', 'fracture'],
  ])('leaves %s beside %s alone', (a, b) => {
    apply(world, slot, a, 2);
    apply(world, slot, b, 2);
    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
  });

  it('does not react on a corpse', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Dying;

    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
  });

  it('does not react on an enemy that has leaked', () => {
    apply(world, slot, 'scorch', 1);
    apply(world, slot, 'chill', 1);
    world.enemies.flags[slot] = (world.enemies.flags[slot] as number) | EnemyFlag.Leaked;

    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
  });

  /* Only enemies whose statuses changed are examined, which is what keeps a
     dense wave from re-scanning three hundred unchanged enemies every tick. */
  it('ignores an enemy whose statuses have not moved', () => {
    world.enemies.statusStacks[slot * 7 + STATUS_INDEX.scorch] = 3;
    world.enemies.statusStacks[slot * 7 + STATUS_INDEX.chill] = 3;
    world.enemies.statusExpiry[slot * 7 + STATUS_INDEX.scorch] = 10_000;
    world.enemies.statusExpiry[slot * 7 + STATUS_INDEX.chill] = 10_000;
    world.enemies.statusDirty[slot] = 0;

    react(world);
    expect(reactionEvents(world)).toHaveLength(0);
  });
});

describe('reactions are deterministic', () => {
  /**
   * Same seed, same reactions, in the same order. This is what makes a bug
   * report reducible to a seed and the balance simulator's output mean
   * anything — and reactions are the most order-sensitive thing in the tick.
   */
  function burningRun(seed: number): { hash: string; reactions: number } {
    const world = freshWorld(seed);
    for (let i = 0; i < 60; i++) {
      const slot = target(world, 400 + (i % 10) * 24, 400 + Math.floor(i / 10) * 24);
      applyStatus(world, slot, STATUS_INDEX.scorch, (i % 5) + 1);
      applyStatus(world, slot, STATUS_INDEX.chill, (i % 3) + 1);
      applyStatus(world, slot, STATUS_INDEX.charge, i % 4);
      applyStatus(world, slot, STATUS_INDEX.corrode, i % 2);
    }
    advance(world, 600);
    return { hash: hashWorld(world), reactions: world.stats.reactionsTriggered };
  }

  it('produces an identical world from an identical run', () => {
    const first = burningRun(9);
    const second = burningRun(9);
    expect(second.hash).toBe(first.hash);
    expect(first.reactions).toBeGreaterThan(0);
  });

  it('runs a stage at 3x to the same state as at 1x', () => {
    const slow = freshWorld(4);
    const fast = freshWorld(4);
    for (const world of [slow, fast]) {
      for (let i = 0; i < 20; i++) {
        const slot = target(world, 400 + i * 20, 400);
        applyStatus(world, slot, STATUS_INDEX.scorch, 4);
        applyStatus(world, slot, STATUS_INDEX.corrode, 3);
      }
    }

    /* 99 ticks, so both runs land on the same tick exactly: the fast one takes
       them three at a time, which must not change a single number. */
    for (let frame = 0; frame < 99; frame++) advance(slow, 1);
    for (let frame = 0; frame < 33; frame++) advance(fast, 3);

    expect(fast.tick).toBe(slow.tick);
    expect(hashWorld(fast)).toBe(hashWorld(slow));
    expect(slow.stats.reactionsTriggered).toBeGreaterThan(0);
  });
});

describe('shatter', () => {
  /**
   * The sixth row of the matrix, which lives in the damage formula rather than
   * here: it is a property of a hit landing on a frozen target, not of two
   * statuses meeting. Checked here so the matrix is covered in one place.
   */
  it('is authored in tuning rather than in code', () => {
    expect(registry.tuning.shatterMultiplier).toBe(2.5);
    expect(registry.tuning.shatterThreshold).toBe(40);
  });
});

describe('a reaction in the full pipeline', () => {
  it('resolves through a plain tick, with no help from the test', () => {
    const world = freshWorld();
    const slot = target(world);
    apply(world, slot, 'scorch', 2);
    apply(world, slot, 'chill', 1);

    tick(world);

    expect(world.stats.reactionsTriggered).toBe(1);
    expect(stacks(world, slot, 'scorch')).toBe(0);
    expect(hpLost(world, slot)).toBeGreaterThan(0);
  });

  it('runs before movement, so a freeze this tick stops this tick', () => {
    const world = freshWorld();
    const slot = target(world);
    apply(world, slot, 'chill', 3);
    apply(world, slot, 'unravel', 1);

    const before = world.enemies.pathDist[slot] as number;
    tick(world);
    expect(stacks(world, slot, 'freeze')).toBe(1);
    expect(world.enemies.pathDist[slot]).toBe(before);
  });

  it('leaves the status system to age what it did not consume', () => {
    const world = freshWorld();
    const slot = target(world);
    apply(world, slot, 'unravel', 1);
    apply(world, slot, 'scorch', 1);

    statusSystem(world);
    reactionSystem(world);
    /* Amplify consumed nothing, so both are still here and still ageing. */
    expect(stacks(world, slot, 'unravel')).toBe(1);
    expect(stacks(world, slot, 'scorch')).toBe(1 + reaction('amplify').bonusStacks);
  });
});
