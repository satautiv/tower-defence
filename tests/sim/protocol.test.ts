import { describe, expect, it } from 'vitest';
import {
  CommandKind,
  CommandQueue,
  DamageFlag,
  DamageQueue,
  DeathList,
  EnemyFlag,
  GroundEffectPool,
  STATUS_COUNT,
  SimEventKind,
  SimEvents,
  SoldierPool,
  buildTower,
  callWave,
  castHeroAbility,
  castPower,
  emitCommandRejected,
  emitDamageDealt,
  emitEnemyDied,
  emitEnemyLeaked,
  emitEnemySpawned,
  emitLifeLost,
  emitProjectileFired,
  emitReactionTriggered,
  emitTowerBuilt,
  emitWaveCleared,
  emitWaveStarted,
  hasFlag,
  moveHero,
  sellTower,
  setRally,
  setSpeed,
  setTargetMode,
  specialiseTower,
  statusSlot,
  upgradeTower,
  useInteractable,
} from '@sim/index';

/**
 * Payloads are five untyped numbers in a preallocated record, which is what
 * makes them allocation-free — and also what makes a transposed argument
 * invisible. A reader taking `c` for a damage type and getting a y-coordinate
 * produces damage of the wrong element with no error anywhere.
 *
 * These tests pin the positional meaning of every command and event, so that
 * mistake fails here rather than surfacing as a balance oddity.
 */

describe('command payloads', () => {
  it.each<[string, (q: CommandQueue) => void, CommandKind, number[]]>([
    ['buildTower', (q) => buildTower(q, 5, 2), CommandKind.BuildTower, [5, 2, 0, 0, 0]],
    ['upgradeTower', (q) => upgradeTower(q, 9), CommandKind.UpgradeTower, [9, 0, 0, 0, 0]],
    ['specialiseTower', (q) => specialiseTower(q, 4, 1), CommandKind.Specialise, [4, 1, 0, 0, 0]],
    ['sellTower', (q) => sellTower(q, 3), CommandKind.SellTower, [3, 0, 0, 0, 0]],
    ['setTargetMode', (q) => setTargetMode(q, 6, 4), CommandKind.SetTargetMode, [6, 4, 0, 0, 0]],
    ['castPower', (q) => castPower(q, 1, 120, 340), CommandKind.CastPower, [1, 120, 340, 0, 0]],
    ['setRally', (q) => setRally(q, 2, 64, 128), CommandKind.SetRally, [2, 64, 128, 0, 0]],
    ['moveHero', (q) => moveHero(q, 300, 400), CommandKind.MoveHero, [300, 400, 0, 0, 0]],
    [
      'castHeroAbility',
      (q) => castHeroAbility(q, 2, 10, 20),
      CommandKind.CastHeroAbility,
      [2, 10, 20, 0, 0],
    ],
    ['callWave', (q) => callWave(q), CommandKind.CallWave, [0, 0, 0, 0, 0]],
    ['setSpeed', (q) => setSpeed(q, 3), CommandKind.SetSpeed, [3, 0, 0, 0, 0]],
    ['useInteractable', (q) => useInteractable(q, 0), CommandKind.UseInteractable, [0, 0, 0, 0, 0]],
  ])('%s writes its arguments to the documented slots', (_name, issue, kind, slots) => {
    const queue = new CommandQueue();
    issue(queue);

    const record = queue.at(0);
    expect(record.kind).toBe(kind);
    expect([record.a, record.b, record.c, record.d, record.e]).toEqual(slots);
  });

  it('gives every command a distinct kind', () => {
    const queue = new CommandQueue();
    buildTower(queue, 0, 0);
    upgradeTower(queue, 0);
    sellTower(queue, 0);
    callWave(queue);

    const kinds = [0, 1, 2, 3].map((i) => queue.at(i).kind);
    expect(new Set(kinds).size).toBe(4);
  });

  it('preserves order, so a replay applies them as the player issued them', () => {
    const queue = new CommandQueue();
    for (let i = 0; i < 10; i++) buildTower(queue, i, 0);
    for (let i = 0; i < 10; i++) expect(queue.at(i).a).toBe(i);
  });

  it('reports refusal once full rather than silently losing input', () => {
    const queue = new CommandQueue();
    let refused = 0;
    for (let i = 0; i < 200; i++) if (!buildTower(queue, i, 0)) refused++;

    expect(refused).toBeGreaterThan(0);
    expect(queue.dropped).toBe(refused);
  });

  it('clears between ticks but keeps the drop counter until reset', () => {
    const queue = new CommandQueue();
    for (let i = 0; i < 200; i++) buildTower(queue, i, 0);
    queue.clear();

    expect(queue.count).toBe(0);
    expect(queue.dropped).toBeGreaterThan(0);
    queue.reset();
    expect(queue.dropped).toBe(0);
  });
});

describe('event payloads', () => {
  it.each<[string, (ev: SimEvents) => void, SimEventKind, number[]]>([
    [
      'enemy spawned',
      (ev) => emitEnemySpawned(ev, 11, 2, 100, 200),
      SimEventKind.EnemySpawned,
      [11, 2, 100, 200],
    ],
    [
      'enemy died',
      (ev) => emitEnemyDied(ev, 12, 50, 60, 3),
      SimEventKind.EnemyDied,
      [12, 50, 60, 3],
    ],
    ['enemy leaked', (ev) => emitEnemyLeaked(ev, 13, 2), SimEventKind.EnemyLeaked, [13, 2, 0, 0]],
    [
      'damage dealt',
      (ev) => emitDamageDealt(ev, 14, 87, 1, 1),
      SimEventKind.DamageDealt,
      [14, 87, 1, 1],
    ],
    [
      'reaction triggered',
      (ev) => emitReactionTriggered(ev, 0, 320, 240, 76),
      SimEventKind.ReactionTriggered,
      [0, 320, 240, 76],
    ],
    ['tower built', (ev) => emitTowerBuilt(ev, 1, 0, 7), SimEventKind.TowerBuilt, [1, 0, 7, 0]],
    [
      'projectile fired',
      (ev) => emitProjectileFired(ev, 21, 4),
      SimEventKind.ProjectileFired,
      [21, 4, 0, 0],
    ],
    ['life lost', (ev) => emitLifeLost(ev, 19, 1), SimEventKind.LifeLost, [19, 1, 0, 0]],
    ['wave started', (ev) => emitWaveStarted(ev, 3), SimEventKind.WaveStarted, [3, 0, 0, 0]],
    ['wave cleared', (ev) => emitWaveCleared(ev, 3, 36), SimEventKind.WaveCleared, [3, 36, 0, 0]],
    [
      'command rejected',
      (ev) => emitCommandRejected(ev, CommandKind.BuildTower, 2),
      SimEventKind.CommandRejected,
      [CommandKind.BuildTower, 2, 0, 0],
    ],
  ])('%s writes its arguments to the documented slots', (_name, emit, kind, slots) => {
    const events = new SimEvents();
    emit(events);

    const record = events.at(0);
    expect(record.kind).toBe(kind);
    expect([record.a, record.b, record.c, record.d]).toEqual(slots);
  });

  /**
   * Not cleared by the pipeline. At 2x and 3x several ticks run per frame and
   * the view drains once afterwards, so clearing per tick would discard every
   * tick's events but the last.
   */
  it('accumulates across ticks until the consumer clears', () => {
    const events = new SimEvents();
    emitWaveStarted(events, 1);
    emitWaveStarted(events, 2);
    expect(events.count).toBe(2);

    events.clear();
    expect(events.count).toBe(0);
  });
});

describe('the damage queue', () => {
  it('records every field of an entry', () => {
    const queue = new DamageQueue();
    queue.push(4, 87.5, 2, 9, DamageFlag.IsReaction, 1, 3);

    expect(queue.count).toBe(1);
    expect(queue.target[0]).toBe(4);
    expect(queue.amount[0]).toBeCloseTo(87.5, 4);
    expect(queue.type[0]).toBe(2);
    expect(queue.source[0]).toBe(9);
    expect(queue.flags[0]).toBe(DamageFlag.IsReaction);
    expect(queue.statusId[0]).toBe(1);
    expect(queue.statusStacks[0]).toBe(3);
  });

  it('defaults to no status, using a sentinel rather than status zero', () => {
    const queue = new DamageQueue();
    queue.push(1, 10, 0, -1);
    /* Status 0 is a real status, so "none" cannot be represented by zero. */
    expect(queue.statusId[0]).toBe(255);
    expect(queue.statusStacks[0]).toBe(0);
  });

  it('combines flags', () => {
    const queue = new DamageQueue();
    queue.push(1, 10, 0, -1, DamageFlag.IsReaction | DamageFlag.True);

    expect(hasFlag(queue.flags[0] as number, DamageFlag.IsReaction)).toBe(true);
    expect(hasFlag(queue.flags[0] as number, DamageFlag.True)).toBe(true);
    expect(hasFlag(queue.flags[0] as number, DamageFlag.NoStatus)).toBe(false);
  });

  it('keeps insertion order, so resolution does not depend on the source', () => {
    const queue = new DamageQueue();
    for (let i = 0; i < 50; i++) queue.push(i, i, 0, -1);
    for (let i = 0; i < 50; i++) expect(queue.target[i]).toBe(i);
  });

  it('counts refusals when full', () => {
    const queue = new DamageQueue();
    let refused = 0;
    for (let i = 0; i < 4000; i++) if (!queue.push(0, 1, 0, -1)) refused++;

    expect(refused).toBeGreaterThan(0);
    expect(queue.dropped).toBe(refused);
  });

  it('clears entries between ticks and keeps drops until reset', () => {
    const queue = new DamageQueue();
    queue.push(1, 10, 0, -1);
    queue.clear();
    expect(queue.count).toBe(0);

    for (let i = 0; i < 4000; i++) queue.push(0, 1, 0, -1);
    queue.reset();
    expect(queue.dropped).toBe(0);
    expect(queue.count).toBe(0);
  });
});

describe('the death list', () => {
  it('records the slot and what killed it, for the death animation', () => {
    const deaths = new DeathList();
    deaths.push(7, 1);

    expect(deaths.count).toBe(1);
    expect(deaths.slots[0]).toBe(7);
    expect(deaths.killedBy[0]).toBe(1);
  });

  it('stops at capacity rather than writing past the end', () => {
    const deaths = new DeathList();
    for (let i = 0; i < deaths.slots.length + 100; i++) deaths.push(i, 0);
    expect(deaths.count).toBe(deaths.slots.length);
  });

  it('clears between ticks', () => {
    const deaths = new DeathList();
    deaths.push(1, 0);
    deaths.clear();
    expect(deaths.count).toBe(0);
  });
});

describe('helpers', () => {
  it('locates a status counter within an entity block', () => {
    expect(statusSlot(0, 0)).toBe(0);
    expect(statusSlot(0, 3)).toBe(3);
    expect(statusSlot(1, 0)).toBe(STATUS_COUNT);
    expect(statusSlot(4, 2)).toBe(4 * STATUS_COUNT + 2);
  });

  it('tests bit flags', () => {
    const flags = EnemyFlag.Alive | EnemyFlag.Flying;
    expect(hasFlag(flags, EnemyFlag.Alive)).toBe(true);
    expect(hasFlag(flags, EnemyFlag.Flying)).toBe(true);
    expect(hasFlag(flags, EnemyFlag.Burrowed)).toBe(false);
    expect(hasFlag(EnemyFlag.None, EnemyFlag.Alive)).toBe(false);
  });
});

describe('the remaining pools hand out clean slots', () => {
  it('gives a soldier no engagement and no owning barracks', () => {
    const pool = new SoldierPool();
    const slot = pool.alloc();

    expect(pool.engagedWith[slot]).toBe(-1);
    expect(pool.sourceTower[slot]).toBe(-1);
    expect(pool.hp[slot]).toBe(0);
    expect(pool.respawnIn[slot]).toBe(0);
  });

  it('gives a ground effect a neutral slow multiplier, not zero', () => {
    const pool = new GroundEffectPool();
    const slot = pool.alloc();

    /* Zero would stop every enemy that walked into a burning pool. */
    expect(pool.slowMultiplier[slot]).toBe(1);
    expect(pool.statusId[slot]).toBe(255);
    expect(pool.sourceTower[slot]).toBe(-1);
  });

  it('cleans a recycled soldier slot', () => {
    const pool = new SoldierPool();
    const slot = pool.alloc();
    pool.hp[slot] = 340;
    pool.engagedWith[slot] = 12;
    pool.free(slot);

    expect(pool.alloc()).toBe(slot);
    expect(pool.hp[slot]).toBe(0);
    expect(pool.engagedWith[slot]).toBe(-1);
  });
});
