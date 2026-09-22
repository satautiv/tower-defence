import { parseSaveFile, serializeSaveFile } from '@core/savefile';
import type { Migrations } from '@core/savefile';
import { SaveFileError } from '@core/savefile';
import {
  EMPTY_PROFILE,
  PROFILE_KEY,
  parseProfile,
  profileAdapter,
  serializeProfile,
  useProfile,
} from './profile.js';
import type { Profile } from './profile.js';
import { clearSession } from './sessionSnapshot.js';
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  parseSettings,
  persistSettings,
  serializeSettings,
  useSettings,
} from '@ui/settings';
import type { Settings } from '@ui/settings';

/**
 * Taking a save out and putting one back (#39).
 *
 * A bundle carries each file as its own envelope rather than as bare data, so
 * a profile exported by an older build still arrives at `parseProfile` with the
 * version it was written under and still runs its own migration chain. Flatten
 * them into one payload and every file in the game would have to share a single
 * version number, which is the arrangement §12.2 exists to avoid.
 *
 * The run in progress is deliberately not included. It is tens of kilobytes,
 * it belongs to one device mid-stage, and nobody wants to move a half-played
 * wave to their phone.
 */

export const BUNDLE_VERSION = 1;
export const MIGRATIONS: Migrations = {};

export interface SaveBundle {
  /** The profile's own versioned envelope, exactly as it is stored. */
  profile?: unknown;
  /** The settings' own versioned envelope. */
  settings?: unknown;
}

/** What an import produced, so the caller can say what it restored. */
export interface ImportedSave {
  profile: Profile | null;
  settings: Settings | null;
}

export { SaveFileError as SaveDataError };

/** A filename a player can tell apart from last month's. */
export function exportFileName(isoDate: string): string {
  return `aetherfall-save-${isoDate.slice(0, 10)}.json`;
}

/**
 * Everything worth keeping, as one file.
 *
 * Reads the stores rather than the adapters, so what is exported is what the
 * player is actually playing with — a profile that failed to persist a moment
 * ago is still in memory, and exporting the stale copy from disk would hand
 * them a file missing the run they just finished.
 */
export function exportSaveData(): string {
  const bundle: SaveBundle = {
    profile: JSON.parse(serializeProfile(useProfile.getState().profile)),
    settings: JSON.parse(serializeSettings(SettingsSchema.parse(useSettings.getState()))),
  };
  return serializeSaveFile(BUNDLE_VERSION, bundle);
}

/**
 * Reads a bundle and returns what it holds, without applying anything.
 *
 * Separate from applying it on purpose: an import has to be all or nothing. A
 * file whose settings parse and whose profile does not must leave the player
 * exactly as they were, not half-converted into someone else's save with their
 * own campaign gone.
 */
export function parseSaveData(
  raw: string,
  migrations: Migrations = MIGRATIONS,
  current: number = BUNDLE_VERSION,
): ImportedSave {
  const bundle = parseSaveFile<SaveBundle>(raw, {
    label: 'save file',
    version: current,
    migrations,
    parse: (data) => {
      const valid = data !== null && typeof data === 'object';
      return valid
        ? ({ success: true, data: data as SaveBundle } as const)
        : ({ success: false, error: new Error('a save file holds an object') } as const);
    },
  });

  /* Each file is parsed through its own reader, so each runs its own
     migrations and fails with its own message. */
  const profile =
    bundle.profile === undefined ? null : parseProfile(JSON.stringify(bundle.profile));
  const settings =
    bundle.settings === undefined ? null : parseSettings(JSON.stringify(bundle.settings));

  if (profile === null && settings === null) {
    throw new SaveFileError('invalid', 'save file', 'save file: holds nothing to restore');
  }

  return { profile, settings };
}

/**
 * Applies a bundle, writing it through the ordinary stores.
 *
 * Parsed first and applied second, so a throw leaves nothing changed.
 */
export function applySaveData(imported: ImportedSave): void {
  if (imported.settings !== null) useSettings.setState({ ...imported.settings, loaded: true });
  if (imported.profile !== null) useProfile.getState().replace(imported.profile);

  /* Settings persist per-field through their own setters, so a whole-file
     replacement is written through the same route rather than left in memory. */
  if (imported.settings !== null) persistSettings(imported.settings);
}

/** Parse and apply in one step, throwing before anything changes if it cannot. */
export function importSaveData(raw: string): ImportedSave {
  const imported = parseSaveData(raw);
  applySaveData(imported);
  return imported;
}

/**
 * Forgets everything: progress, preferences and the run in progress.
 *
 * Clears the adapters rather than the keys it knows about, so the backups left
 * behind by an unreadable file go too. A player asking to be forgotten means
 * all of it, and a stale `profile.unreadable` surviving a wipe would be the one
 * thing left of a save they deliberately destroyed.
 */
export async function clearAllSaveData(): Promise<void> {
  useProfile.setState({ profile: EMPTY_PROFILE, loaded: true });
  useSettings.setState({ ...DEFAULT_SETTINGS, loaded: true });

  await clearSession();
  try {
    await profileAdapter().clear();
  } catch (error) {
    console.warn('Could not clear saved data.', error);
  }
  /* The profile store is written back empty rather than merely cleared, so a
     later write cannot resurrect what was there from a stale in-memory copy. */
  try {
    await profileAdapter().set(PROFILE_KEY, serializeProfile(EMPTY_PROFILE));
  } catch (error) {
    console.warn('Could not reset the profile.', error);
  }
}
