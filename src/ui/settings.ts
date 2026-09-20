import { create } from 'zustand';
import { z } from 'zod';
import { GAME_SPEEDS } from '@core/constants';
import type { GameSpeed } from '@core/constants';
import { platform } from '@platform/index';
import type { SaveAdapter } from '@platform/index';

/**
 * The player's settings, kept between visits.
 *
 * Preferences about the interface — the game speed now; volume, accessibility
 * and language as they arrive — so they belong to the UI rather than the
 * simulation, which only ever receives them as commands.
 *
 * Stored in the profile store under their own key, in the save format of
 * docs/TECH_DESIGN.md §12.2: a version beside the data, a migration chain from
 * v1 before there is anything to migrate, and validation that fails loudly.
 * The rest of the profile — stars, talents, codex — is the save system's (#39),
 * which may fold this key into it; the format is already the one it will use.
 */

export const SETTINGS_KEY = 'settings';
/** Where a settings file that failed to load is kept, rather than overwritten. */
export const SETTINGS_BACKUP_KEY = 'settings.unreadable';
export const SETTINGS_VERSION = 1;

const SpeedSchema = z.literal(GAME_SPEEDS);

/** Every field defaults, so a file missing one — new since it was written — still loads. */
export const SettingsSchema = z.object({
  /** Carried from stage to stage (docs/GAME_DESIGN.md §15.3). */
  speed: SpeedSchema.default(1),
  /**
   * Effects volume, 0 to 1. One slider for now: #44 splits it into music,
   * effects and voice when there is more than one of them to balance.
   */
  volume: z.number().min(0).max(1).default(0.7),
  muted: z.boolean().default(false),
  /**
   * The hero's level, 1 to 10, earned across the campaign (§11).
   *
   * Lives in the profile because it is progress rather than preference, and
   * levels come from stage completions rather than from anything inside a run.
   * It sits here for now rather than in its own file: the save system (#39)
   * may fold this key into a larger profile, and the format is already the one
   * it will use.
   */
  heroLevel: z.number().int().min(1).max(10).default(1),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Each entry upgrades data written at that version to the next. Empty until v2. */
export type Migrations = Readonly<Record<number, (data: unknown) => unknown>>;
export const MIGRATIONS: Migrations = {};

export class SettingsError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SettingsError';
  }
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify({ version: SETTINGS_VERSION, data: settings });
}

/**
 * Reads a settings file of any version this build knows how to upgrade.
 *
 * Throws rather than guessing. A file from a newer build, or one that no
 * longer parses, is not quietly replaced by defaults here — the caller decides
 * what to do, and keeps the original so nothing is lost.
 */
export function parseSettings(
  raw: string,
  migrations: Migrations = MIGRATIONS,
  current: number = SETTINGS_VERSION,
): Settings {
  let file: unknown;
  try {
    file = JSON.parse(raw);
  } catch (error) {
    throw new SettingsError('settings are not valid JSON', error);
  }

  const envelope = z.object({ version: z.number().int().positive(), data: z.unknown() });
  const parsed = envelope.safeParse(file);
  if (!parsed.success) throw new SettingsError('settings have no version', parsed.error);

  let { version, data } = parsed.data;
  if (version > current) {
    throw new SettingsError(`settings are from a newer build (v${version}, this is v${current})`);
  }
  while (version < current) {
    const migrate = migrations[version];
    if (migrate === undefined) throw new SettingsError(`no migration from settings v${version}`);
    data = migrate(data);
    version++;
  }

  const settings = SettingsSchema.safeParse(data);
  if (!settings.success) throw new SettingsError('settings failed validation', settings.error);
  return settings.data;
}

interface SettingsState extends Settings {
  /** False until the saved settings have been read, or found missing. */
  loaded: boolean;
  setSpeed: (speed: GameSpeed) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setHeroLevel: (level: number) => void;
}

/** The adapter settings are read from and written to. Replaced in tests. */
let store: () => SaveAdapter = () => platform().profile;

export function setSettingsStorage(adapter: () => SaveAdapter): void {
  store = adapter;
}

function persist(settings: Settings): void {
  /* A failed write costs the player a preference, never the game: note it
     and carry on with the setting applied for this visit. */
  store()
    .set(SETTINGS_KEY, serializeSettings(settings))
    .catch((error: unknown) => console.warn('Could not save settings.', error));
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  setSpeed: (speed) => {
    if (get().speed === speed) return;
    set({ speed });
    /* The whole file, not just the field that changed: parsing the store's
       state through the schema keeps every setting and drops the actions. */
    persist(SettingsSchema.parse(get()));
  },

  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    if (get().volume === clamped) return;
    set({ volume: clamped });
    persist(SettingsSchema.parse(get()));
  },

  setMuted: (muted) => {
    if (get().muted === muted) return;
    set({ muted });
    persist(SettingsSchema.parse(get()));
  },

  /* Only ever upward: a level is earned, and a later stage cleared at a lower
     level must not take one away. */
  setHeroLevel: (level) => {
    const clamped = Math.min(10, Math.max(1, Math.round(level)));
    if (clamped <= get().heroLevel) return;
    set({ heroLevel: clamped });
    persist(SettingsSchema.parse(get()));
  },
}));

/**
 * Reads the saved settings into the store.
 *
 * Nothing saved is the ordinary first visit. Anything unreadable is reported
 * and copied aside before defaults take over, so the next save cannot destroy
 * what might still be recovered (docs/TECH_DESIGN.md §12.2: corrupt saves fail
 * loudly, not silently).
 */
export async function loadSettings(): Promise<void> {
  const adapter = store();
  let raw: string | null;
  try {
    raw = await adapter.get(SETTINGS_KEY);
  } catch (error) {
    console.warn('Could not read settings; using defaults.', error);
    useSettings.setState({ ...DEFAULT_SETTINGS, loaded: true });
    return;
  }

  if (raw === null) {
    useSettings.setState({ ...DEFAULT_SETTINGS, loaded: true });
    return;
  }

  try {
    useSettings.setState({ ...parseSettings(raw), loaded: true });
  } catch (error) {
    console.warn('Saved settings were unreadable; using defaults. The file is kept.', error);
    await adapter.set(SETTINGS_BACKUP_KEY, raw).catch(() => undefined);
    useSettings.setState({ ...DEFAULT_SETTINGS, loaded: true });
  }
}
