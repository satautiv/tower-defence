import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUNDLE_VERSION,
  SaveDataError,
  clearAllSaveData,
  exportFileName,
  exportSaveData,
  importSaveData,
  parseSaveData,
} from '@app/saveData';
import {
  EMPTY_PROFILE,
  recordStageResult,
  setProfileStorage,
  stageRecord,
  totalStars,
  useProfile,
} from '@app/profile';
import { DEFAULT_SETTINGS, setSettingsStorage, useSettings } from '@ui/settings';
import { setSessionStorage } from '@app/sessionSnapshot';
import { MemorySaveAdapter } from '@platform/index';
import type { StageResult } from '@sim/index';

/**
 * Taking a save out and putting one back.
 *
 * The rule that matters more than any other here: an import is all or nothing.
 * A file whose settings parse and whose profile does not must leave the player
 * exactly as they were — half-applying one would destroy the campaign they
 * already had in exchange for someone else's preferences.
 */

function result(over: Partial<StageResult> = {}): StageResult {
  return {
    won: true,
    stars: 3,
    livesRemaining: 20,
    startingLives: 20,
    durationSeconds: 300,
    wavesCleared: 12,
    totalWaves: 12,
    enemiesKilled: 100,
    enemiesLeaked: 0,
    goldEarned: 900,
    towersBuilt: 8,
    reactionsTriggered: 40,
    ...over,
  };
}

let profileStore: MemorySaveAdapter;

beforeEach(() => {
  profileStore = new MemorySaveAdapter();
  setProfileStorage(() => profileStore);
  setSettingsStorage(() => profileStore);
  setSessionStorage(() => new MemorySaveAdapter());
  useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
  useSettings.setState({ ...DEFAULT_SETTINGS, loaded: true });
  vi.restoreAllMocks();
});

/** A campaign worth exporting. */
function playSome(): void {
  let profile = recordStageResult(EMPTY_PROFILE, '1-1', result({ stars: 3 }));
  profile = recordStageResult(profile, '1-2', result({ stars: 2, durationSeconds: 410 }));
  useProfile.setState({ profile, loaded: true });
  useSettings.setState({ speed: 3, volume: 0.25 });
}

describe('the exported file', () => {
  it('is named for the day it was made', () => {
    expect(exportFileName('2026-09-22T17:41:00.000Z')).toBe('aetherfall-save-2026-09-22.json');
  });

  it('carries its own version', () => {
    expect(JSON.parse(exportSaveData())).toMatchObject({ version: BUNDLE_VERSION });
  });

  /* Each file keeps its own envelope, so an old profile still runs its own
     migrations on the way back in. */
  it('keeps each file versioned separately rather than flattening them', () => {
    playSome();
    const bundle = JSON.parse(exportSaveData()) as { data: Record<string, { version: number }> };
    expect(bundle.data['profile']?.version).toBe(1);
    expect(bundle.data['settings']?.version).toBe(1);
  });

  it('holds what is on screen, not a stale copy from disk', () => {
    playSome();
    const imported = parseSaveData(exportSaveData());
    expect(totalStars(imported.profile!)).toBe(5);
    expect(imported.settings?.speed).toBe(3);
  });

  /* A run in progress belongs to one device mid-stage. */
  it('leaves the run in progress out', () => {
    playSome();
    const bundle = JSON.parse(exportSaveData()) as { data: Record<string, unknown> };
    expect(Object.keys(bundle.data).sort()).toEqual(['profile', 'settings']);
  });
});

describe('a round trip', () => {
  it('restores the campaign and the preferences', () => {
    playSome();
    const file = exportSaveData();

    useProfile.setState({ profile: EMPTY_PROFILE });
    useSettings.setState({ ...DEFAULT_SETTINGS });

    const imported = importSaveData(file);
    expect(imported.profile).not.toBeNull();
    expect(stageRecord(useProfile.getState().profile, '1-1').stars).toBe(3);
    expect(stageRecord(useProfile.getState().profile, '1-2').bestTimeSeconds).toBe(410);
    expect(useSettings.getState().speed).toBe(3);
    expect(useSettings.getState().volume).toBe(0.25);
  });

  it('writes the imported profile through to storage', async () => {
    playSome();
    const file = exportSaveData();
    useProfile.setState({ profile: EMPTY_PROFILE });

    importSaveData(file);
    await Promise.resolve();

    expect(await profileStore.get('profile')).toContain('"stars":3');
  });
});

describe('a file that cannot be read', () => {
  it.each([
    ['not JSON at all', 'save me'],
    ['JSON with no version', JSON.stringify({ profile: {} })],
    ['a bundle holding nothing', JSON.stringify({ version: 1, data: {} })],
    [
      'a profile that fails validation',
      JSON.stringify({ version: 1, data: { profile: { version: 1, data: { stages: 9 } } } }),
    ],
    [
      'a profile from a newer build',
      JSON.stringify({ version: 1, data: { profile: { version: 99, data: {} } } }),
    ],
  ])('is refused: %s', (_name, raw) => {
    expect(() => parseSaveData(raw)).toThrow(SaveDataError);
  });

  it('is refused when it comes from a newer build of the game', () => {
    const raw = JSON.stringify({ version: 99, data: {} });
    expect(() => parseSaveData(raw)).toThrow(/newer build/);
  });

  /* The rule this file exists for. */
  it('changes nothing when only part of it is valid', () => {
    playSome();
    const mine = useProfile.getState().profile;
    const mySpeed = useSettings.getState().speed;

    /* Valid settings, broken profile: the settings must not land. */
    const halfBad = JSON.stringify({
      version: 1,
      data: {
        settings: { version: 1, data: { speed: 1, volume: 0.9 } },
        profile: { version: 1, data: { stages: 'not a record' } },
      },
    });

    expect(() => importSaveData(halfBad)).toThrow(SaveDataError);
    expect(useProfile.getState().profile).toBe(mine);
    expect(useSettings.getState().speed).toBe(mySpeed);
  });

  it('accepts a file holding only a profile', () => {
    playSome();
    const bundle = JSON.parse(exportSaveData()) as { data: Record<string, unknown> };
    const profileOnly = JSON.stringify({ version: 1, data: { profile: bundle.data['profile'] } });

    useProfile.setState({ profile: EMPTY_PROFILE });
    const imported = importSaveData(profileOnly);
    expect(imported.settings).toBeNull();
    expect(totalStars(useProfile.getState().profile)).toBe(5);
  });
});

describe('clearing everything', () => {
  it('forgets the campaign and the preferences', async () => {
    playSome();
    await clearAllSaveData();

    expect(useProfile.getState().profile).toEqual(EMPTY_PROFILE);
    expect(useSettings.getState().speed).toBe(DEFAULT_SETTINGS.speed);
    expect(totalStars(useProfile.getState().profile)).toBe(0);
  });

  /* An unreadable file is kept aside on load; a deliberate wipe must take that
     copy too, or the one thing left of a destroyed save is its wreckage. */
  it('takes the backup copy of an unreadable save with it', async () => {
    await profileStore.set('profile.unreadable', '{ broken');
    await profileStore.set('profile', '{"version":1,"data":{}}');

    await clearAllSaveData();

    expect(await profileStore.get('profile.unreadable')).toBeNull();
  });
});
