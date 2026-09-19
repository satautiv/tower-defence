import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySaveAdapter } from '@platform/index';
import {
  DEFAULT_SETTINGS,
  SETTINGS_BACKUP_KEY,
  SETTINGS_KEY,
  SettingsError,
  loadSettings,
  parseSettings,
  serializeSettings,
  setSettingsStorage,
  useSettings,
} from '@ui/settings';

/**
 * Settings kept between visits (#28: speed persists across stages), in the
 * save format of docs/TECH_DESIGN.md §12.2 — versioned, migrated from v1, and
 * validated so a bad file fails loudly instead of quietly becoming defaults.
 */

let adapter: MemorySaveAdapter;

beforeEach(() => {
  adapter = new MemorySaveAdapter();
  setSettingsStorage(() => adapter);
  useSettings.setState({ ...DEFAULT_SETTINGS, loaded: false });
});

afterEach(() => vi.restoreAllMocks());

const quietly = (): void => void vi.spyOn(console, 'warn').mockImplementation(() => undefined);

describe('the settings file', () => {
  it('round-trips', () => {
    expect(parseSettings(serializeSettings({ speed: 3 }))).toEqual({ speed: 3 });
  });

  it('carries its version beside the data', () => {
    expect(JSON.parse(serializeSettings({ speed: 2 }))).toEqual({ version: 1, data: { speed: 2 } });
  });

  /* A field added in a later build must not make an older file unreadable. */
  it('fills in a field the file predates', () => {
    expect(parseSettings(JSON.stringify({ version: 1, data: {} }))).toEqual(DEFAULT_SETTINGS);
  });

  it('runs every migration between the file and this build, in order', () => {
    const migrations = {
      1: (data: unknown) => ({ ...(data as object), step: 'one' }),
      2: (data: unknown) => ({ speed: (data as { gameSpeed: number }).gameSpeed }),
    };
    const old = JSON.stringify({ version: 1, data: { gameSpeed: 3 } });
    expect(parseSettings(old, migrations, 3)).toEqual({ speed: 3 });
  });

  it.each([
    ['is not JSON', '{speed: 3'],
    ['has no version', JSON.stringify({ speed: 3 })],
    ['names a speed the game does not have', JSON.stringify({ version: 1, data: { speed: 7 } })],
    ['comes from a newer build', JSON.stringify({ version: 99, data: { speed: 2 } })],
  ])('refuses a file that %s', (_label, raw) => {
    expect(() => parseSettings(raw)).toThrow(SettingsError);
  });

  it('refuses a file with no migration path to this build', () => {
    const old = JSON.stringify({ version: 1, data: { speed: 2 } });
    expect(() => parseSettings(old, {}, 2)).toThrow(/no migration from settings v1/);
  });
});

describe('loading', () => {
  it('starts from defaults on a first visit', async () => {
    await loadSettings();
    expect(useSettings.getState()).toMatchObject({ speed: 1, loaded: true });
  });

  it('restores the saved speed', async () => {
    await adapter.set(SETTINGS_KEY, serializeSettings({ speed: 3 }));
    await loadSettings();
    expect(useSettings.getState()).toMatchObject({ speed: 3, loaded: true });
  });

  /* §12.2: corrupt saves fail loudly — and here, recoverably. */
  it('reports an unreadable file and keeps a copy before falling back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await adapter.set(SETTINGS_KEY, '{not json');

    await loadSettings();
    expect(useSettings.getState()).toMatchObject({ speed: 1, loaded: true });
    expect(warn).toHaveBeenCalled();
    expect(await adapter.get(SETTINGS_BACKUP_KEY)).toBe('{not json');
  });

  it('plays on with defaults when storage cannot be read at all', async () => {
    quietly();
    class Blocked extends MemorySaveAdapter {
      override get(): Promise<string | null> {
        return Promise.reject(new Error('blocked'));
      }
    }
    setSettingsStorage(() => new Blocked());

    await loadSettings();
    expect(useSettings.getState()).toMatchObject({ speed: 1, loaded: true });
  });
});

describe('saving', () => {
  it('writes a new speed straight away, and a later visit reads it back', async () => {
    useSettings.getState().setSpeed(2);
    await Promise.resolve();
    expect(parseSettings((await adapter.get(SETTINGS_KEY)) ?? '')).toEqual({ speed: 2 });

    useSettings.setState({ ...DEFAULT_SETTINGS, loaded: false });
    await loadSettings();
    expect(useSettings.getState().speed).toBe(2);
  });

  it('writes nothing when the speed has not changed', async () => {
    useSettings.getState().setSpeed(1);
    await Promise.resolve();
    expect(await adapter.get(SETTINGS_KEY)).toBeNull();
  });

  /* A lost preference must never cost the game. */
  it('keeps the new speed for this visit even if it cannot be saved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    class Full extends MemorySaveAdapter {
      override set(): Promise<void> {
        return Promise.reject(new Error('quota'));
      }
    }
    setSettingsStorage(() => new Full());

    useSettings.getState().setSpeed(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useSettings.getState().speed).toBe(3);
    expect(warn).toHaveBeenCalled();
  });
});
