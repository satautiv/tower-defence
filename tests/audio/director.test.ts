import { beforeEach, describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { AudioDirector, MIN_INTERVAL_MS } from '@audio/index';
import type { World } from '@sim/index';
import {
  STATUS_INDEX,
  applyStatus,
  createWorldForStage,
  enemyIndex,
  reactionSystem,
  spawnEnemy,
  targetingSystem,
} from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * The director, against a fake context.
 *
 * Nothing here checks what anything sounds like — that is not testable and not
 * the point. What is testable is that a reaction reaches the speaker at all,
 * that a chain does not become a wall of noise, and that a browser refusing to
 * give us audio does not take the game down with it.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

interface Started {
  type: string;
  frequency: number;
}

/**
 * Enough of the Web Audio API to record what was asked for.
 *
 * Hand-written rather than mocked wholesale: the director talks to a small,
 * stable corner of the API, and a fake that has to stay honest about that
 * corner is worth more than one that accepts anything.
 */
class FakeContext {
  readonly started: Started[] = [];
  readonly buffers: number[] = [];
  state = 'running';
  currentTime = 0;
  sampleRate = 48_000;
  destination = {};
  resumed = 0;
  closed = 0;

  createGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime: () => undefined,
        linearRampToValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
    };
  }

  createOscillator() {
    const record: Started = { type: '', frequency: 0 };
    return {
      set type(value: string) {
        record.type = value;
      },
      detune: { value: 0 },
      frequency: {
        setValueAtTime: (hz: number) => {
          record.frequency = hz;
        },
        exponentialRampToValueAtTime: () => undefined,
      },
      connect: () => undefined,
      start: () => this.started.push(record),
      stop: () => undefined,
    };
  }

  createBufferSource() {
    return {
      buffer: null,
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    };
  }

  createBuffer(_channels: number, frames: number) {
    this.buffers.push(frames);
    return { getChannelData: () => new Float32Array(frames) };
  }

  resume() {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }

  close() {
    this.closed++;
    return Promise.resolve();
  }
}

const directorWith = (context: FakeContext): AudioDirector =>
  new AudioDirector({ createContext: () => context as unknown as AudioContext });

/** A world holding one Thermal Shock, already resolved into the event buffer. */
function detonate(world: World, x = 500): void {
  const slot = spawnEnemy(world, enemyIndex(world, 'husk'), 0);
  world.enemies.hp[slot] = 10_000;
  world.enemies.maxHp[slot] = 10_000;
  world.enemies.x[slot] = x;
  world.enemies.y[slot] = 500;
  applyStatus(world, slot, STATUS_INDEX.scorch, 2);
  applyStatus(world, slot, STATUS_INDEX.chill, 1);
  targetingSystem(world);
  reactionSystem(world);
}

describe('unlocking', () => {
  let context: FakeContext;
  let audio: AudioDirector;
  beforeEach(() => {
    context = new FakeContext();
    audio = directorWith(context);
  });

  /**
   * Every mobile browser and most desktop ones refuse to start audio outside a
   * user gesture, and a context created too early is born suspended and stays
   * that way — which presents as a game with no sound and no error anywhere.
   */
  it('makes no sound before a gesture unlocks it', () => {
    const world = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    detonate(world);

    expect(audio.ready).toBe(false);
    audio.consume(world, 0);
    expect(context.started).toHaveLength(0);
  });

  it('is ready once unlocked', () => {
    audio.unlock();
    expect(audio.ready).toBe(true);
  });

  it('resumes a context the browser suspended', () => {
    context.state = 'suspended';
    audio.unlock();
    expect(context.resumed).toBe(1);
  });

  it('opens exactly one context however often it is unlocked', () => {
    for (let i = 0; i < 5; i++) audio.unlock();
    expect(context.buffers).toHaveLength(1);
  });

  /* A browser that cannot give us audio is not a browser that cannot run the
     game. It must give up quietly rather than throw into the render loop. */
  it('survives a browser that refuses to open a context', () => {
    const refusing = new AudioDirector({
      createContext: () => {
        throw new Error('no audio for you');
      },
    });
    const world = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    detonate(world);

    expect(() => refusing.unlock()).not.toThrow();
    expect(refusing.ready).toBe(false);
    expect(() => refusing.consume(world, 0)).not.toThrow();
  });
});

describe('reactions reach the speaker', () => {
  let context: FakeContext;
  let audio: AudioDirector;
  let world: World;
  beforeEach(() => {
    context = new FakeContext();
    audio = directorWith(context);
    audio.unlock();
    world = createWorldForStage(registry, stage, 1, FULL_ROSTER);
  });

  it('sounds a stinger when a reaction fires', () => {
    detonate(world);
    audio.consume(world, 0);
    expect(context.started.length).toBeGreaterThan(0);
  });

  it('says nothing when nothing reacted', () => {
    spawnEnemy(world, enemyIndex(world, 'husk'), 0);
    audio.consume(world, 0);
    expect(context.started).toHaveLength(0);
  });

  /* The whole reason this exists: a player watching their gold must still
     learn that a reaction happened. */
  it('plays the pitch the reaction`s own recipe asks for', () => {
    detonate(world);
    audio.consume(world, 0);
    /* Thermal Shock starts its sweep at 320Hz. */
    expect(context.started[0]?.frequency).toBe(320);
  });

  it('holds its tongue while muted', () => {
    audio.setMuted(true);
    detonate(world);
    audio.consume(world, 0);
    expect(context.started).toHaveLength(0);
  });

  it('speaks again when unmuted', () => {
    audio.setMuted(true);
    audio.setMuted(false);
    detonate(world);
    audio.consume(world, 0);
    expect(context.started.length).toBeGreaterThan(0);
  });
});

describe('a chain does not become a wall of noise', () => {
  it('throttles many of the same reaction in one frame', () => {
    const context = new FakeContext();
    const audio = directorWith(context);
    audio.unlock();

    const world = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    for (let i = 0; i < 40; i++) detonate(world, 400 + i * 200);
    audio.consume(world, 0);

    /* Forty reactions, at most one sound — they all arrived in the same frame
       and the interval has not lapsed between any of them. */
    expect(context.started.length).toBeLessThanOrEqual(2);
    expect(audio.suppressedCount).toBeGreaterThan(30);
  });

  it('sounds them again once the interval has lapsed', () => {
    const context = new FakeContext();
    const audio = directorWith(context);
    audio.unlock();

    let sounded = 0;
    for (let frame = 0; frame < 6; frame++) {
      const world = createWorldForStage(registry, stage, 1, FULL_ROSTER);
      detonate(world);
      audio.consume(world, frame * MIN_INTERVAL_MS);
      sounded = context.started.length;
    }
    expect(sounded).toBe(6);
  });

  it('forgets what it played between stages', () => {
    const context = new FakeContext();
    const audio = directorWith(context);
    audio.unlock();

    const first = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    detonate(first);
    audio.consume(first, 0);
    audio.reset();

    const second = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    detonate(second);
    audio.consume(second, 1);
    expect(context.started).toHaveLength(2);
  });
});

describe('teardown', () => {
  it('closes the context it opened', () => {
    const context = new FakeContext();
    const audio = directorWith(context);
    audio.unlock();
    audio.destroy();
    expect(context.closed).toBe(1);
  });

  it('closes nothing it never opened', () => {
    const context = new FakeContext();
    directorWith(context).destroy();
    expect(context.closed).toBe(0);
  });
});
