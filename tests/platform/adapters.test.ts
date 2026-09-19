// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFIX,
  IndexedDbAdapter,
  LocalStorageAdapter,
  MemorySaveAdapter,
  SaveError,
} from '@platform/index';
import type { SaveAdapter } from '@platform/types';

/**
 * One contract, every implementation.
 *
 * The save system (#39) will be written against SaveAdapter, so any adapter
 * that satisfies this suite can be substituted without the game noticing —
 * which is the entire point of the interface. Running the same tests against
 * all three is what makes that claim true rather than hoped for.
 */
function describeSaveAdapter(name: string, make: () => SaveAdapter): void {
  describe(`${name} satisfies the SaveAdapter contract`, () => {
    let adapter: SaveAdapter;

    beforeEach(async () => {
      adapter = make();
      await adapter.clear();
    });

    it('round-trips a value', async () => {
      await adapter.set('profile', '{"stars":12}');
      expect(await adapter.get('profile')).toBe('{"stars":12}');
    });

    it('returns null for a key that was never set', async () => {
      expect(await adapter.get('absent')).toBeNull();
    });

    it('overwrites on a second set', async () => {
      await adapter.set('k', 'first');
      await adapter.set('k', 'second');
      expect(await adapter.get('k')).toBe('second');
    });

    it('removes a value', async () => {
      await adapter.set('k', 'v');
      await adapter.remove('k');
      expect(await adapter.get('k')).toBeNull();
    });

    it('treats removing an absent key as a no-op', async () => {
      await expect(adapter.remove('never-existed')).resolves.toBeUndefined();
    });

    it('lists its keys, sorted', async () => {
      await adapter.set('charlie', '3');
      await adapter.set('alpha', '1');
      await adapter.set('bravo', '2');
      expect(await adapter.keys()).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('empties on clear', async () => {
      await adapter.set('a', '1');
      await adapter.set('b', '2');
      await adapter.clear();
      expect(await adapter.keys()).toEqual([]);
      expect(await adapter.get('a')).toBeNull();
    });

    /* Save payloads are JSON with player-entered content and unicode in
       localised strings; a store that mangles them corrupts saves silently. */
    it('preserves the value byte for byte', async () => {
      const awkward = JSON.stringify({
        text: 'Ünïcödé — "quotes", \\backslashes\\, \n newlines \t tabs',
        emoji: '⚡❄☣',
        nested: { array: [1, 2, null, true] },
      });
      await adapter.set('awkward', awkward);
      expect(await adapter.get('awkward')).toBe(awkward);
    });

    it('stores an empty string as distinct from absent', async () => {
      await adapter.set('empty', '');
      expect(await adapter.get('empty')).toBe('');
      expect(await adapter.get('missing')).toBeNull();
    });

    it('handles a snapshot-sized value', async () => {
      const large = 'x'.repeat(200_000);
      await adapter.set('snapshot', large);
      expect((await adapter.get('snapshot'))?.length).toBe(large.length);
    });
  });
}

describeSaveAdapter('MemorySaveAdapter', () => new MemorySaveAdapter());
describeSaveAdapter(
  'LocalStorageAdapter',
  () => new LocalStorageAdapter(globalThis.localStorage, 'test:'),
);
describeSaveAdapter('IndexedDbAdapter', () => new IndexedDbAdapter('test-db', 'test-store'));

describe('LocalStorageAdapter namespacing', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('prefixes its keys so it cannot collide with another app on the origin', async () => {
    const adapter = new LocalStorageAdapter(globalThis.localStorage);
    await adapter.set('profile', 'v');
    expect(globalThis.localStorage.getItem(`${DEFAULT_PREFIX}profile`)).toBe('v');
  });

  /* On GitHub Pages every project shares an origin, so an unprefixed clear()
     would wipe unrelated sites' data. */
  it('leaves foreign keys alone when listing and clearing', async () => {
    globalThis.localStorage.setItem('someone-elses-key', 'keep me');
    const adapter = new LocalStorageAdapter(globalThis.localStorage);
    await adapter.set('mine', 'v');

    expect(await adapter.keys()).toEqual(['mine']);
    await adapter.clear();
    expect(globalThis.localStorage.getItem('someone-elses-key')).toBe('keep me');
  });

  it('keeps two adapters with different prefixes separate', async () => {
    const profile = new LocalStorageAdapter(globalThis.localStorage, 'p:');
    const session = new LocalStorageAdapter(globalThis.localStorage, 's:');
    await profile.set('k', 'profile value');
    await session.set('k', 'session value');

    expect(await profile.get('k')).toBe('profile value');
    expect(await session.get('k')).toBe('session value');
  });
});

describe('LocalStorageAdapter availability', () => {
  it('detects a working store', () => {
    expect(LocalStorageAdapter.isAvailable(globalThis.localStorage)).toBe(true);
  });

  it('treats a missing store as unavailable', () => {
    expect(LocalStorageAdapter.isAvailable(undefined)).toBe(false);
  });

  /* Safari in private mode exposes localStorage and then throws on every write,
     so presence is not availability — the probe has to actually write. */
  it('treats a store that throws on write as unavailable', () => {
    const hostile = {
      setItem: () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    expect(LocalStorageAdapter.isAvailable(hostile)).toBe(false);
  });
});

describe('storage failures are reported, not swallowed', () => {
  it('reports a full store as a quota failure the player can act on', async () => {
    const full = {
      setItem: () => {
        throw new DOMException('exceeded', 'QuotaExceededError');
      },
      getItem: () => null,
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;

    const adapter = new LocalStorageAdapter(full);
    await expect(adapter.set('k', 'v')).rejects.toBeInstanceOf(SaveError);
    await expect(adapter.set('k', 'v')).rejects.toMatchObject({ reason: 'quota', key: 'k' });
  });

  it('distinguishes an ordinary failure from a quota failure', async () => {
    const broken = {
      setItem: () => {
        throw new Error('disk on fire');
      },
      getItem: () => null,
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;

    await expect(new LocalStorageAdapter(broken).set('k', 'v')).rejects.toMatchObject({
      reason: 'failed',
    });
  });

  it('keeps the original error as the cause, so a bug report has the real reason', async () => {
    const original = new Error('underlying');
    const broken = {
      setItem: () => {
        throw original;
      },
      getItem: () => null,
      removeItem: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;

    await expect(new LocalStorageAdapter(broken).set('k', 'v')).rejects.toMatchObject({
      cause: original,
    });
  });
});

describe('IndexedDb failures map onto reasons the save system can act on', () => {
  /**
   * A store that rejects every request. idb-keyval calls it with a transaction
   * callback; failing before that runs is enough to exercise the mapping.
   */
  const failingStore = (error: unknown) =>
    (() => Promise.reject(error)) as unknown as ConstructorParameters<typeof IndexedDbAdapter>[0];

  it('reports a full store as a quota failure', async () => {
    const adapter = new IndexedDbAdapter(
      failingStore(new DOMException('exceeded', 'QuotaExceededError')),
    );
    await expect(adapter.set('snapshot', 'x')).rejects.toMatchObject({
      reason: 'quota',
      key: 'snapshot',
    });
  });

  it('reports anything else as an ordinary failure', async () => {
    const adapter = new IndexedDbAdapter(failingStore(new Error('database is closing')));
    await expect(adapter.set('snapshot', 'x')).rejects.toMatchObject({ reason: 'failed' });
  });

  it.each([
    ['get', (a: IndexedDbAdapter) => a.get('k')],
    ['remove', (a: IndexedDbAdapter) => a.remove('k')],
    ['keys', (a: IndexedDbAdapter) => a.keys()],
    ['clear', (a: IndexedDbAdapter) => a.clear()],
  ])('wraps a %s failure in SaveError rather than leaking a DOMException', async (_name, call) => {
    const adapter = new IndexedDbAdapter(failingStore(new Error('boom')));
    await expect(call(adapter)).rejects.toBeInstanceOf(SaveError);
  });

  it('keeps the original error as the cause', async () => {
    const original = new Error('underlying');
    const adapter = new IndexedDbAdapter(failingStore(original));
    await expect(adapter.get('k')).rejects.toMatchObject({ cause: original });
  });
});
