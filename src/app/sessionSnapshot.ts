import { parseSaveFile, serializeSaveFile } from '@core/savefile';
import type { Migrations } from '@core/savefile';
import { SaveFileError } from '@core/savefile';
import { platform } from '@platform/index';
import type { SaveAdapter } from '@platform/index';
import { SNAPSHOT_VERSION, captureWorld, restoreWorld } from '@sim/index';
import type { World, WorldSnapshot } from '@sim/index';

/**
 * The run in progress, kept across a backgrounding (#39, §12.1).
 *
 * This is the half of the save system that exists for phones. A backgrounded
 * mobile page may never run code again, so `pause` is the last reliable moment
 * to write — and a seven-minute run lost to an incoming call is the kind of
 * thing a player does not come back from.
 *
 * It goes in the session adapter (IndexedDB) rather than the profile's
 * localStorage, because a world is tens of kilobytes and localStorage is a
 * few megabytes shared with everything else.
 */

export const SESSION_KEY = 'snapshot';

/** Each entry upgrades a snapshot written at that version to the next. */
export const MIGRATIONS: Migrations = {};

export interface SavedSession {
  /** Wall clock, so the resume prompt can say how long ago this was. */
  savedAtMs: number;
  snapshot: WorldSnapshot;
}

/** The adapter the snapshot is read from and written to. Replaced in tests. */
let store: () => SaveAdapter = () => platform().session;

export function setSessionStorage(adapter: () => SaveAdapter): void {
  store = adapter;
}

export function serializeSession(saved: SavedSession): string {
  return serializeSaveFile(SNAPSHOT_VERSION, saved);
}

/**
 * Reads a saved session, or throws.
 *
 * Validation is deliberately shallow here — the shape is checked, and the
 * payload is checked byte by byte when `restoreWorld` writes it into the real
 * typed arrays, which is the only place that knows how long each one should
 * be. Duplicating those lengths in a schema would be a second thing to keep in
 * step with the pools.
 */
export function parseSession(
  raw: string,
  migrations: Migrations = MIGRATIONS,
  current: number = SNAPSHOT_VERSION,
): SavedSession {
  return parseSaveFile(raw, {
    label: 'snapshot',
    version: current,
    migrations,
    parse: (data) => {
      const saved = data as Partial<SavedSession> | null;
      const snapshot = saved?.snapshot as Partial<WorldSnapshot> | undefined;
      const valid =
        saved !== null &&
        typeof saved === 'object' &&
        typeof saved.savedAtMs === 'number' &&
        snapshot !== undefined &&
        typeof snapshot.stageId === 'string' &&
        typeof snapshot.seed === 'number' &&
        typeof snapshot.bag === 'object' &&
        snapshot.bag !== null;
      return valid
        ? ({ success: true, data: saved as SavedSession } as const)
        : ({
            success: false,
            error: new Error('snapshot is not shaped like a saved run'),
          } as const);
    },
  });
}

/**
 * Writes the world as it stands.
 *
 * Called from `pause`, which on a phone may be the last code that runs, so it
 * does as little as possible before handing bytes to the adapter.
 */
export async function writeSession(
  world: World,
  stageId: string,
  savedAtMs: number,
  progressStageId?: string,
  modeId?: string,
): Promise<void> {
  const saved: SavedSession = {
    savedAtMs,
    snapshot: captureWorld(world, stageId, progressStageId, modeId),
  };
  await store().set(SESSION_KEY, serializeSession(saved));
}

/**
 * Reads the saved run, or nothing.
 *
 * Unlike the profile, a snapshot this build cannot read is discarded rather
 * than kept aside. The two are not the same kind of loss: a profile is a whole
 * campaign and might be recoverable by hand, while a snapshot is one run in
 * progress whose only value was resuming it. Keeping a broken one would block
 * every later resume and cost tens of kilobytes to do it.
 */
export async function readSession(): Promise<SavedSession | null> {
  let raw: string | null;
  try {
    raw = await store().get(SESSION_KEY);
  } catch (error) {
    console.warn('Could not read the saved run.', error);
    return null;
  }
  if (raw === null) return null;

  try {
    return parseSession(raw);
  } catch (error) {
    console.warn('The saved run could not be read and has been discarded.', error);
    await clearSession();
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await store().remove(SESSION_KEY);
  } catch (error) {
    console.warn('Could not discard the saved run.', error);
  }
}

/**
 * Whether a saved run belongs to the stage about to be played.
 *
 * Only what can be checked is checked: the stage it is of, and that this build
 * still writes the same snapshot version. A content edit that changes a
 * stat without changing any array's length is **not** detected — the run would
 * resume against the new numbers. That is a real gap rather than an oversight;
 * closing it means a content fingerprint, which belongs with the live-balancing
 * work in #59 that already needs one.
 */
export function sessionMatches(saved: SavedSession, stageId: string): boolean {
  return saved.snapshot.stageId === stageId;
}

/**
 * Puts a saved run back into a world built for the same stage.
 *
 * Returns whether it took. A snapshot that does not fit is discarded and the
 * player gets the stage from the beginning, which is the worse of two outcomes
 * only when the alternative is a world half-filled with someone else's run.
 */
export function resumeInto(world: World, saved: SavedSession, stageId: string): boolean {
  try {
    restoreWorld(world, saved.snapshot, stageId);
    return true;
  } catch (error) {
    console.warn('The saved run did not fit this stage and has been discarded.', error);
    return false;
  }
}

export { SaveFileError as SessionError };
