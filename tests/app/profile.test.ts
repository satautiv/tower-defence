import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_PROFILE,
  PROFILE_BACKUP_KEY,
  PROFILE_KEY,
  ProfileError,
  highestCleared,
  loadProfile,
  parseProfile,
  progressFor,
  recordHeroLevel,
  recordStageResult,
  serializeProfile,
  setProfileStorage,
  stageRecord,
  totalStars,
  useProfile,
} from '@app/profile';
import type { Profile } from '@app/profile';
import type { StageResult } from '@sim/index';

/**
 * The profile is the only record of a campaign, so the rules that matter here
 * are the ones about not losing it: a best is never replaced by a worse run, a
 * defeat never overwrites a win, and a file this build cannot read is kept
 * rather than flattened.
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

class MemoryAdapter {
  readonly data = new Map<string, string>();
  failGet = false;
  failSet = false;

  get(key: string): Promise<string | null> {
    if (this.failGet) return Promise.reject(new Error('unreadable'));
    return Promise.resolve(this.data.get(key) ?? null);
  }
  set(key: string, value: string): Promise<void> {
    if (this.failSet) return Promise.reject(new Error('full'));
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
  setProfileStorage(() => adapter);
  useProfile.setState({ profile: EMPTY_PROFILE, loaded: false });
  vi.restoreAllMocks();
});

describe('recording a run', () => {
  it('starts from nothing', () => {
    expect(stageRecord(EMPTY_PROFILE, '1-1')).toEqual({
      stars: 0,
      bestLives: 0,
      cleared: false,
      attempts: 0,
    });
  });

  it('keeps stars, lives and a time from a win', () => {
    const profile = recordStageResult(EMPTY_PROFILE, '1-1', result());
    expect(stageRecord(profile, '1-1')).toMatchObject({
      stars: 3,
      bestLives: 20,
      bestTimeSeconds: 300,
      cleared: true,
      attempts: 1,
    });
  });

  /* The bug this file exists to prevent. */
  it('does not let a later defeat erase an earlier win', () => {
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', result());
    profile = recordStageResult(
      profile,
      '1-1',
      result({ won: false, stars: 0, livesRemaining: 0 }),
    );

    expect(stageRecord(profile, '1-1')).toMatchObject({
      stars: 3,
      bestLives: 20,
      bestTimeSeconds: 300,
      cleared: true,
      attempts: 2,
    });
  });

  it('does not let a worse win lower a better one', () => {
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', result());
    profile = recordStageResult(
      profile,
      '1-1',
      result({ stars: 1, livesRemaining: 3, durationSeconds: 900 }),
    );

    expect(stageRecord(profile, '1-1')).toMatchObject({
      stars: 3,
      bestLives: 20,
      bestTimeSeconds: 300,
    });
  });

  it('takes a faster clear', () => {
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', result());
    profile = recordStageResult(profile, '1-1', result({ durationSeconds: 240 }));
    expect(stageRecord(profile, '1-1').bestTimeSeconds).toBe(240);
  });

  it('records no time for a defeat, however long it lasted', () => {
    const profile = recordStageResult(EMPTY_PROFILE, '1-1', result({ won: false, stars: 0 }));
    expect(stageRecord(profile, '1-1').bestTimeSeconds).toBeUndefined();
    expect(stageRecord(profile, '1-1').cleared).toBe(false);
    expect(stageRecord(profile, '1-1').attempts).toBe(1);
  });

  it('counts stars across the campaign', () => {
    let profile = recordStageResult(EMPTY_PROFILE, '1-1', result({ stars: 3 }));
    profile = recordStageResult(profile, '1-2', result({ stars: 2 }));
    profile = recordStageResult(profile, '1-3', result({ won: false, stars: 0 }));
    expect(totalStars(profile)).toBe(5);
  });

  it('leaves the profile it was given alone', () => {
    const before = EMPTY_PROFILE;
    recordStageResult(before, '1-1', result());
    expect(before.stages).toEqual({});
  });
});

describe('how far the player has got', () => {
  function cleared(...stageIds: string[]): Profile {
    return stageIds.reduce(
      (profile, id) => recordStageResult(profile, id, result()),
      EMPTY_PROFILE,
    );
  }

  it('is nothing before the first win', () => {
    expect(highestCleared(EMPTY_PROFILE)).toBeUndefined();
  });

  /* String order would put 1-10 before 1-9; the campaign does not. */
  it('reads 1-10 as later than 1-9', () => {
    expect(highestCleared(cleared('1-9', '1-10'))).toBe('1-10');
    expect(highestCleared(cleared('1-10', '1-9'))).toBe('1-10');
  });

  it('ignores a stage that was attempted but never won', () => {
    const profile = recordStageResult(cleared('1-2'), '1-7', result({ won: false, stars: 0 }));
    expect(highestCleared(profile)).toBe('1-2');
  });
});

describe('the roster a run is played with', () => {
  it('is the stage itself on a first playthrough', () => {
    expect(progressFor(EMPTY_PROFILE, '1-6')).toBe('1-6');
  });

  /* The failure the merged unlock code refused to allow: replaying an early
     stage must not take the roster away. */
  it('keeps the full roster when replaying an early stage', () => {
    const finished = recordStageResult(EMPTY_PROFILE, '1-10', result());
    expect(progressFor(finished, '1-1')).toBe('1-10');
  });

  it('still advances when the player is ahead of what they have cleared', () => {
    const upTo5 = recordStageResult(EMPTY_PROFILE, '1-5', result());
    expect(progressFor(upTo5, '1-6')).toBe('1-6');
  });
});

describe('hero levels', () => {
  it('rise but never fall', () => {
    let profile = recordHeroLevel(EMPTY_PROFILE, 'kaelen', 5);
    expect(profile.heroLevels['kaelen']).toBe(5);
    profile = recordHeroLevel(profile, 'kaelen', 3);
    expect(profile.heroLevels['kaelen']).toBe(5);
  });

  it('clamp to the authored range', () => {
    expect(recordHeroLevel(EMPTY_PROFILE, 'kaelen', 99).heroLevels['kaelen']).toBe(10);
    expect(recordHeroLevel(EMPTY_PROFILE, 'kaelen', -4).heroLevels['kaelen']).toBeUndefined();
  });
});

describe('the profile file', () => {
  it('round-trips', () => {
    const profile = recordStageResult(EMPTY_PROFILE, '1-4', result({ stars: 2 }));
    expect(parseProfile(serializeProfile(profile))).toEqual(profile);
  });

  it('fills in a field the file predates', () => {
    expect(parseProfile(JSON.stringify({ version: 1, data: {} }))).toEqual(EMPTY_PROFILE);
  });

  it('runs every migration between the file and this build, in order', () => {
    const order: number[] = [];
    const migrations = {
      1: (d: unknown) => {
        order.push(1);
        return { ...(d as object), stages: {} };
      },
      2: (d: unknown) => {
        order.push(2);
        return { ...(d as object), codexReactions: ['combustion'] };
      },
    };
    const old = JSON.stringify({ version: 1, data: {} });
    const profile = parseProfile(old, migrations, 3);
    expect(order).toEqual([1, 2]);
    expect(profile.codexReactions).toEqual(['combustion']);
  });

  it('refuses a file from a newer build rather than dropping its fields', () => {
    const future = JSON.stringify({ version: 99, data: {} });
    expect(() => parseProfile(future)).toThrow(ProfileError);
    expect(() => parseProfile(future)).toThrow(/newer build/);
  });

  it('refuses a file with no migration path to this build', () => {
    expect(() => parseProfile(JSON.stringify({ version: 1, data: {} }), {}, 2)).toThrow(
      /no migration from profile v1/,
    );
  });

  it.each([
    ['not JSON at all', 'this is not a save'],
    ['JSON with no version', JSON.stringify({ stages: {} })],
    ['a version with the wrong payload', JSON.stringify({ version: 1, data: { stages: 7 } })],
  ])('refuses %s', (_name, raw) => {
    expect(() => parseProfile(raw)).toThrow(ProfileError);
  });
});

describe('loading', () => {
  it('starts empty on a first visit', async () => {
    await loadProfile();
    expect(useProfile.getState().profile).toEqual(EMPTY_PROFILE);
    expect(useProfile.getState().loaded).toBe(true);
  });

  it('restores a saved campaign', async () => {
    const profile = recordStageResult(EMPTY_PROFILE, '1-7', result({ stars: 2 }));
    adapter.data.set(PROFILE_KEY, serializeProfile(profile));

    await loadProfile();
    expect(stageRecord(useProfile.getState().profile, '1-7').stars).toBe(2);
  });

  /* §12.2: corrupt saves fail loudly, and what might be recoverable is kept. */
  it('keeps a copy of an unreadable profile before falling back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.data.set(PROFILE_KEY, '{ not a profile');

    await loadProfile();

    expect(adapter.data.get(PROFILE_BACKUP_KEY)).toBe('{ not a profile');
    expect(useProfile.getState().profile).toEqual(EMPTY_PROFILE);
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not overwrite the unreadable file with an empty one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.data.set(PROFILE_KEY, '{ not a profile');
    await loadProfile();
    expect(adapter.data.get(PROFILE_KEY)).toBe('{ not a profile');
  });

  it('plays on with an empty profile when storage cannot be read at all', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.failGet = true;

    await loadProfile();
    expect(useProfile.getState().profile).toEqual(EMPTY_PROFILE);
    expect(useProfile.getState().loaded).toBe(true);
  });
});

describe('saving', () => {
  it('writes a finished run straight away, and a later visit reads it back', async () => {
    useProfile.getState().recordResult('1-2', result({ stars: 2 }));
    await Promise.resolve();

    const saved = parseProfile(adapter.data.get(PROFILE_KEY) ?? '');
    expect(stageRecord(saved, '1-2').stars).toBe(2);
  });

  it('keeps the run for this visit even if it cannot be saved', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter.failSet = true;

    useProfile.getState().recordResult('1-2', result());
    await Promise.resolve();

    expect(stageRecord(useProfile.getState().profile, '1-2').stars).toBe(3);
  });

  it('clears everything on request', async () => {
    useProfile.getState().recordResult('1-2', result());
    useProfile.getState().reset();
    await Promise.resolve();

    expect(useProfile.getState().profile).toEqual(EMPTY_PROFILE);
    expect(parseProfile(adapter.data.get(PROFILE_KEY) ?? '')).toEqual(EMPTY_PROFILE);
  });
});
