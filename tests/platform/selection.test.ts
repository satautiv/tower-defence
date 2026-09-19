// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbAdapter,
  LocalStorageAdapter,
  MemorySaveAdapter,
  createPlatform,
  isNativePlatform,
  nativePlatformName,
  platform,
  resetPlatform,
} from '@platform/index';

const hostileStorage = {
  setItem: () => {
    throw new DOMException('denied', 'SecurityError');
  },
  getItem: () => null,
  removeItem: () => undefined,
  key: () => null,
  length: 0,
} as unknown as Storage;

afterEach(() => resetPlatform());

describe('platform selection', () => {
  it('reports web when Capacitor is absent', () => {
    expect(isNativePlatform()).toBe(false);
    expect(nativePlatformName()).toBe('web');
    expect(createPlatform().name).toBe('web');
  });

  it('reports capacitor when the native bridge says so', () => {
    expect(createPlatform({ native: true }).name).toBe('capacitor');
  });

  it('puts the profile in localStorage and the session in IndexedDB', () => {
    const p = createPlatform();
    expect(p.profile).toBeInstanceOf(LocalStorageAdapter);
    expect(p.session).toBeInstanceOf(IndexedDbAdapter);
  });

  /**
   * Degrading rather than refusing to start. A player in a private window still
   * gets to play; they just do not keep progress. Refusing to launch because
   * progress cannot be saved would be the worse outcome.
   */
  it('falls back to memory when no store is usable', () => {
    const p = createPlatform({ localStorage: hostileStorage, indexedDbAvailable: false });
    expect(p.profile).toBeInstanceOf(MemorySaveAdapter);
    expect(p.session).toBeInstanceOf(MemorySaveAdapter);
  });

  it('falls back to localStorage for sessions when IndexedDB is missing', () => {
    const p = createPlatform({ indexedDbAvailable: false });
    expect(p.session).toBeInstanceOf(LocalStorageAdapter);
  });

  it('keeps the profile working when only IndexedDB is missing', async () => {
    const p = createPlatform({ indexedDbAvailable: false });
    await p.profile.set('k', 'v');
    expect(await p.profile.get('k')).toBe('v');
  });

  it('starts with analytics off', () => {
    expect(createPlatform().analytics.enabled).toBe(false);
  });

  it('provides a lifecycle that reports visibility', () => {
    const p = createPlatform();
    expect(typeof p.lifecycle.visible).toBe('boolean');
    p.dispose();
  });

  it('separates profile and session storage', async () => {
    const p = createPlatform();
    await p.profile.set('shared-key', 'profile');
    await p.session.set('shared-key', 'session');

    expect(await p.profile.get('shared-key')).toBe('profile');
    expect(await p.session.get('shared-key')).toBe('session');
  });
});

describe('the process-wide platform', () => {
  it('is created once and reused', () => {
    expect(platform()).toBe(platform());
  });

  it('is rebuilt after a reset', () => {
    const first = platform();
    resetPlatform();
    expect(platform()).not.toBe(first);
  });

  it('releases its lifecycle listeners on dispose', () => {
    const p = createPlatform();
    expect(() => p.dispose()).not.toThrow();
  });
});
