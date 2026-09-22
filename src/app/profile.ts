import { create } from 'zustand';
import { z } from 'zod';
import { parseSaveFile, serializeSaveFile, zodParser } from '@core/savefile';
import type { Migrations } from '@core/savefile';
import { SaveFileError } from '@core/savefile';
import { compareStageIds } from '@content/stages';
import { platform } from '@platform/index';
import type { SaveAdapter } from '@platform/index';
import type { StageResult } from '@sim/index';

/**
 * The player's progress, kept between visits (#39, docs/TECH_DESIGN.md §12.1).
 *
 * Progress, not preference: what has been earned rather than how the interface
 * is set up. `ui/settings.ts` keeps the latter, under its own key in the same
 * store and in the same format — two files because they change for different
 * reasons and at wildly different rates, one format because there is only one
 * way to read a save.
 *
 * Small and written often, so it goes in the profile adapter (localStorage on
 * the web), never in the session adapter a world snapshot uses.
 */

export const PROFILE_KEY = 'profile';
/** Where a profile that failed to load is kept, rather than overwritten. */
export const PROFILE_BACKUP_KEY = 'profile.unreadable';
export const PROFILE_VERSION = 1;

/**
 * What one stage remembers.
 *
 * Every field is a best rather than a latest. A player who three-stars 1-4 and
 * then replays it badly to try a different board has not lost their three
 * stars, and a progression that punished experimenting would push against
 * pillar P5 as squarely as a paid respec would.
 */
export const StageRecordSchema = z.object({
  stars: z.number().int().min(0).max(3).default(0),
  /** Most lives ever finished with. Stars come from this (§12.4). */
  bestLives: z.number().int().min(0).default(0),
  /** Fastest clear, in seconds. Absent until the stage has been won once. */
  bestTimeSeconds: z.number().positive().optional(),
  /** Won at least once. Distinct from `stars > 0`, which a 0-star win is not. */
  cleared: z.boolean().default(false),
  attempts: z.number().int().min(0).default(0),
});

export type StageRecord = z.infer<typeof StageRecordSchema>;

/** Every field defaults, so a profile missing one — new since it was written — still loads. */
export const ProfileSchema = z.object({
  stages: z.record(z.string(), StageRecordSchema).default({}),
  /** By hero id. Earned across the campaign (§11). */
  heroLevels: z.record(z.string(), z.number().int().min(1).max(10)).default({}),
  /**
   * Ranks taken in the Warden Talent tree, by node id.
   *
   * A place rather than an implementation: the tree, its costs and its cap are
   * #37's. Reserving the field now costs nothing and means #37 does not need a
   * migration on day one — which is the whole argument §12.2 makes for having
   * migrations before there is anything to migrate.
   */
  talents: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Codex entries seen, by id. The anti-wiki feature is #38. */
  codexEnemies: z.array(z.string()).default([]),
  codexReactions: z.array(z.string()).default([]),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const EMPTY_PROFILE: Profile = ProfileSchema.parse({});

/** Each entry upgrades a profile written at that version to the next. Empty until v2. */
export const MIGRATIONS: Migrations = {};

export { SaveFileError as ProfileError };

export function serializeProfile(profile: Profile): string {
  return serializeSaveFile(PROFILE_VERSION, profile);
}

export function parseProfile(
  raw: string,
  migrations: Migrations = MIGRATIONS,
  current: number = PROFILE_VERSION,
): Profile {
  return parseSaveFile(raw, {
    label: 'profile',
    version: current,
    migrations,
    parse: zodParser(ProfileSchema),
  });
}

/* ------------------------------------------------------------------ record */

export function stageRecord(profile: Profile, stageId: string): StageRecord {
  return profile.stages[stageId] ?? StageRecordSchema.parse({});
}

/**
 * Folds a finished run into the profile, returning a new one.
 *
 * Pure, so the rules can be tested without a store, an adapter or a browser —
 * and so the caller decides when a write happens.
 *
 * A loss still counts as an attempt and still updates nothing else. Recording
 * a defeat's zero stars over an earlier win is the single most annoying bug
 * this file could have.
 */
export function recordStageResult(profile: Profile, stageId: string, result: StageResult): Profile {
  const before = stageRecord(profile, stageId);

  const after: StageRecord = {
    ...before,
    attempts: before.attempts + 1,
    stars: Math.max(before.stars, result.stars) as StageRecord['stars'],
    bestLives: Math.max(before.bestLives, result.won ? result.livesRemaining : 0),
    cleared: before.cleared || result.won,
  };

  /* Only a win has a time worth keeping: a defeat's clock says when the player
     ran out of lives, which is not a record of anything. */
  if (result.won && result.durationSeconds > 0) {
    after.bestTimeSeconds =
      before.bestTimeSeconds === undefined
        ? result.durationSeconds
        : Math.min(before.bestTimeSeconds, result.durationSeconds);
  }

  return { ...profile, stages: { ...profile.stages, [stageId]: after } };
}

export function totalStars(profile: Profile): number {
  let total = 0;
  for (const record of Object.values(profile.stages)) total += record.stars;
  return total;
}

/**
 * What a set of stages adds up to, for the region map.
 *
 * Takes the stage ids rather than reading content, so it stays pure and a test
 * can ask about a region that does not exist yet. `maxStars` is three per stage
 * today; §12.4 makes it eleven once difficulties (#40) and the challenge modes
 * (§13) land, and this is the one place that will need to know.
 */
export interface CampaignSummary {
  readonly stars: number;
  readonly maxStars: number;
  readonly cleared: number;
  readonly total: number;
  /** Sum of the best clear of every stage won, in seconds. */
  readonly bestTotalSeconds: number;
  /** Whether every stage has been cleared at all. */
  readonly complete: boolean;
}

export const STARS_PER_STAGE = 3;

export function campaignSummary(profile: Profile, stageIds: readonly string[]): CampaignSummary {
  let stars = 0;
  let cleared = 0;
  let bestTotalSeconds = 0;

  for (const stageId of stageIds) {
    const record = stageRecord(profile, stageId);
    stars += record.stars;
    if (record.cleared) cleared++;
    bestTotalSeconds += record.bestTimeSeconds ?? 0;
  }

  return {
    stars,
    maxStars: stageIds.length * STARS_PER_STAGE,
    cleared,
    total: stageIds.length,
    bestTotalSeconds,
    complete: stageIds.length > 0 && cleared === stageIds.length,
  };
}

/** The furthest stage ever cleared, or undefined before the first win. */
export function highestCleared(profile: Profile): string | undefined {
  let highest: string | undefined;
  for (const [stageId, record] of Object.entries(profile.stages)) {
    if (!record.cleared) continue;
    if (highest === undefined || compareStageIds(stageId, highest) > 0) highest = stageId;
  }
  return highest;
}

/**
 * Which stage's roster the player has earned, for `RulesetOptions.progressStageId`.
 *
 * The later of what they have cleared and what they are playing, which is the
 * rule both halves of the problem need. A first run of 1-6 must offer the
 * Barracks 1-6 introduces, so the stage being played counts. And someone
 * replaying 1-1 after finishing the region must keep the full roster, so what
 * they have cleared counts too — taking the towers away on a replay is the
 * exact failure the merged unlock code refused to gate on the stage's own id.
 */
export function progressFor(profile: Profile, playing: string): string {
  const cleared = highestCleared(profile);
  if (cleared === undefined) return playing;
  return compareStageIds(cleared, playing) > 0 ? cleared : playing;
}

/**
 * Hero levels only ever rise.
 *
 * Same rule as the stage records, and for the same reason: a later stage
 * cleared at a lower level must not take a level away.
 */
export function recordHeroLevel(profile: Profile, heroId: string, level: number): Profile {
  const clamped = Math.min(10, Math.max(1, Math.round(level)));
  const current = profile.heroLevels[heroId] ?? 1;
  if (clamped <= current) return profile;
  return { ...profile, heroLevels: { ...profile.heroLevels, [heroId]: clamped } };
}

/* ------------------------------------------------------------------- store */

interface ProfileState {
  profile: Profile;
  /** False until the saved profile has been read, or found missing. */
  loaded: boolean;
  recordResult: (stageId: string, result: StageResult) => void;
  setHeroLevel: (heroId: string, level: number) => void;
  replace: (profile: Profile) => void;
  reset: () => void;
}

/** The adapter the profile is read from and written to. Replaced in tests. */
let store: () => SaveAdapter = () => platform().profile;

export function setProfileStorage(adapter: () => SaveAdapter): void {
  store = adapter;
}

/**
 * The adapter the profile lives in, for the save-data tools (#39).
 *
 * Exposed rather than letting them reach for `platform()` themselves: there is
 * one seam for where a profile is stored, and a second one would be a second
 * thing for a test to remember to redirect.
 */
export function profileAdapter(): SaveAdapter {
  return store();
}

function persist(profile: Profile): void {
  /* A failed write costs the player a record, never the run in progress: note
     it and carry on with the profile applied for this visit. */
  store()
    .set(PROFILE_KEY, serializeProfile(profile))
    .catch((error: unknown) => console.warn('Could not save progress.', error));
}

export const useProfile = create<ProfileState>((set, get) => ({
  profile: EMPTY_PROFILE,
  loaded: false,

  recordResult: (stageId, result) => {
    const profile = recordStageResult(get().profile, stageId, result);
    set({ profile });
    persist(profile);
  },

  setHeroLevel: (heroId, level) => {
    const profile = recordHeroLevel(get().profile, heroId, level);
    if (profile === get().profile) return;
    set({ profile });
    persist(profile);
  },

  replace: (profile) => {
    set({ profile });
    persist(profile);
  },

  reset: () => {
    set({ profile: EMPTY_PROFILE });
    persist(EMPTY_PROFILE);
  },
}));

/**
 * Reads the saved profile into the store.
 *
 * Nothing saved is the ordinary first visit. Anything unreadable is reported
 * and copied aside before an empty profile takes over, so the next save cannot
 * destroy what might still be recovered — a player's whole campaign is the
 * thing §12.2's "loudly, not silently" rule exists to protect.
 */
export async function loadProfile(): Promise<void> {
  const adapter = store();
  let raw: string | null;
  try {
    raw = await adapter.get(PROFILE_KEY);
  } catch (error) {
    console.warn('Could not read progress; starting from an empty profile.', error);
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    return;
  }

  if (raw === null) {
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
    return;
  }

  try {
    useProfile.setState({ profile: parseProfile(raw), loaded: true });
  } catch (error) {
    console.warn('Progress could not be read; a copy has been kept.', error);
    await adapter
      .set(PROFILE_BACKUP_KEY, raw)
      .catch((cause: unknown) => console.warn('Could not keep a copy.', cause));
    useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
  }
}
