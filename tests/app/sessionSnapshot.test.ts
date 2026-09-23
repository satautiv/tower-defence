import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '@content/load';
import {
  SESSION_KEY,
  SessionError,
  clearSession,
  parseSession,
  readSession,
  resumeInto,
  serializeSession,
  sessionMatches,
  setSessionStorage,
  writeSession,
} from '@app/sessionSnapshot';
import {
  advance,
  buildTower,
  callWave,
  createWorldForStage,
  hashWorld,
  plotInfo,
} from '@sim/index';
import type { World } from '@sim/index';
import { FULL_ROSTER } from '../roster.js';

/**
 * The run in progress, across a backgrounding.
 *
 * The determinism suite already proves a snapshot restores bit for bit; what
 * is checked here is everything around it — that it reaches the store and
 * comes back, that a snapshot of the wrong stage is refused rather than
 * restored, and that a broken one is discarded rather than left to block every
 * later resume.
 */

const SEED = 20260922;
const registry = loadContent();

function world(stageId = '1-1'): World {
  const stage = registry.stages.get(stageId);
  if (stage === undefined) throw new Error(`no stage ${stageId}`);
  return createWorldForStage(registry, stage, SEED, FULL_ROSTER);
}

function played(stageId = '1-1', ticks = 1200): World {
  const w = world(stageId);
  const plots = plotInfo(w);
  const plot = plots[0];
  if (plot !== undefined) buildTower(w.commands, plot.id, 0);
  callWave(w.commands);
  advance(w, ticks);
  return w;
}

class MemoryAdapter {
  readonly data = new Map<string, string>();
  failGet = false;
  failSet = false;

  get(key: string): Promise<string | null> {
    if (this.failGet) return Promise.reject(new Error('unreadable'));
    return Promise.resolve(this.data.get(key) ?? null);
  }
  set(key: string, value: string): Promise<void> {
    if (this.failSet) return Promise.reject(new Error('quota'));
    this.data.set(key, value);
    return Promise.resolve();
  }
  remove(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
  keys(): Promise<string[]> {
    return Promise.resolve([...this.data.keys()]);
  }
  clear(): Promise<void> {
    this.data.clear();
    return Promise.resolve();
  }
}

let adapter: MemoryAdapter;

beforeEach(() => {
  adapter = new MemoryAdapter();
  setSessionStorage(() => adapter);
  vi.restoreAllMocks();
});

describe('saving and resuming a run', () => {
  it('comes back as the same world, and keeps playing the same way', async () => {
    const original = played();
    await writeSession(original, '1-1', 1_700_000_000_000);

    const saved = await readSession();
    expect(saved).not.toBeNull();
    expect(saved?.savedAtMs).toBe(1_700_000_000_000);

    const resumed = world();
    expect(resumeInto(resumed, saved!, '1-1')).toBe(true);
    expect(hashWorld(resumed)).toBe(hashWorld(original));

    /* The point of resuming is the rest of the run, not the frozen moment. */
    advance(original, 600);
    advance(resumed, 600);
    expect(hashWorld(resumed)).toBe(hashWorld(original));
  });

  it('is nothing at all before a run has been saved', async () => {
    expect(await readSession()).toBeNull();
  });

  it('writes under one key, so a later save replaces the earlier one', async () => {
    await writeSession(played(), '1-1', 1);
    await writeSession(played('1-1', 1800), '1-1', 2);
    expect([...adapter.data.keys()]).toEqual([SESSION_KEY]);
    expect((await readSession())?.savedAtMs).toBe(2);
  });

  it('is gone once discarded', async () => {
    await writeSession(played(), '1-1', 1);
    await clearSession();
    expect(await readSession()).toBeNull();
  });
});

/**
 * A snapshot is bytes written against one ruleset (#48).
 *
 * Nothing in the bag says whether these enemies were scaled for Veteran or had
 * their ward tripled by a Heroic challenge, so the mode travels beside the
 * seed and the progress stage — the two other things a world has to be *built*
 * with before the bytes can be written into it.
 */
describe('a saved run remembers how it was being played', () => {
  it('carries the mode it was started on', async () => {
    const veteran = createWorldForStage(registry, registry.stages.get('1-1')!, SEED, {
      ...FULL_ROSTER,
      difficulty: 'veteran',
    });
    advance(veteran, 60);
    await writeSession(veteran, '1-1', 1, undefined, 'veteran');

    const saved = await readSession();
    expect(saved?.snapshot.modeId).toBe('veteran');

    /* And the world it is restored into has to be built the same way, or the
       lives it comes back with are Normal's twenty rather than Veteran's
       fifteen. */
    const rebuilt = createWorldForStage(registry, registry.stages.get('1-1')!, SEED, {
      ...FULL_ROSTER,
      difficulty: saved?.snapshot.modeId,
    });
    expect(resumeInto(rebuilt, saved!, '1-1')).toBe(true);
    expect(hashWorld(rebuilt)).toBe(hashWorld(veteran));
    expect(rebuilt.config.lives).toBe(15);
  });

  it('says nothing when it was not told, and opens on the default', async () => {
    await writeSession(played(), '1-1', 1);
    expect((await readSession())?.snapshot.modeId).toBeUndefined();
  });
});

describe('a saved run that does not belong here', () => {
  it('is not offered for another stage', async () => {
    await writeSession(played('1-3'), '1-3', 1);
    const saved = await readSession();
    expect(sessionMatches(saved!, '1-3')).toBe(true);
    expect(sessionMatches(saved!, '1-1')).toBe(false);
  });

  /* Belt and braces: even if the caller ignored `sessionMatches`, restoring
     into the wrong stage must fail rather than half-fill the world. */
  it('refuses to restore into the wrong stage', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeSession(played('1-3'), '1-3', 1);
    const saved = await readSession();

    const wrong = world('1-1');
    const before = hashWorld(wrong);
    expect(resumeInto(wrong, saved!, '1-1')).toBe(false);
    expect(hashWorld(wrong)).toBe(before);
  });
});

describe('a saved run this build cannot read', () => {
  it.each([
    ['not JSON at all', 'half a fi'],
    ['JSON with no version', JSON.stringify({ savedAtMs: 1 })],
    ['a payload that is not a run', JSON.stringify({ version: 1, data: { savedAtMs: 1 } })],
    [
      'a run with no bag',
      JSON.stringify({ version: 1, data: { savedAtMs: 1, snapshot: { stageId: '1-1', seed: 1 } } }),
    ],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseSession(raw)).toThrow(SessionError);
  });

  /* Unlike the profile, a broken snapshot is discarded rather than kept: its
     only value was resuming, and keeping it would block every later resume. */
  it('is discarded rather than left to block the next one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.data.set(SESSION_KEY, 'not a saved run');

    expect(await readSession()).toBeNull();
    expect(adapter.data.has(SESSION_KEY)).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });

  it('refuses one written by a newer build', () => {
    const raw = JSON.stringify({ version: 99, data: { savedAtMs: 1, snapshot: {} } });
    expect(() => parseSession(raw)).toThrow(/newer build/);
  });

  it('round-trips through its own envelope', async () => {
    await writeSession(played(), '1-1', 42);
    const raw = adapter.data.get(SESSION_KEY) ?? '';
    expect(parseSession(raw).savedAtMs).toBe(42);
    expect(parseSession(serializeSession(parseSession(raw))).savedAtMs).toBe(42);
  });
});

describe('when the store misbehaves', () => {
  it('reports a write it could not make rather than throwing into the caller', async () => {
    adapter.failSet = true;
    await expect(writeSession(played(), '1-1', 1)).rejects.toThrow();
  });

  it('plays on when the store cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.failGet = true;
    expect(await readSession()).toBeNull();
  });
});
