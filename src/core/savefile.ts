/**
 * The versioned save file: an envelope, a migration chain, and validation that
 * fails loudly (docs/TECH_DESIGN.md §12.2).
 *
 * `ui/settings.ts` prototyped this shape for one small file and said in its own
 * comment that the save system would fold it in. This is that fold. There is
 * one implementation because there is one format, and three copies of a
 * migration loop is three places for a save to be read slightly differently —
 * the bug class §12.2 exists to prevent.
 *
 * The rule the whole thing turns on: **a file this build cannot read is never
 * quietly replaced by defaults.** It throws with a reason, and the caller keeps
 * the original aside. A player whose save is one field short of valid has lost
 * an evening; a player whose save was silently overwritten has lost the game.
 */

import { z } from 'zod';

export interface SaveEnvelope {
  version: number;
  data: unknown;
}

/** Each entry upgrades data written at that version to the next. */
export type Migrations = Readonly<Record<number, (data: unknown) => unknown>>;

export type SaveFileFailure =
  /** Not JSON at all. Truncated, or never a save file. */
  | 'unreadable'
  /** JSON, but not the envelope — no version to interpret the rest by. */
  | 'unversioned'
  /**
   * Written by a build newer than this one. Refused rather than guessed at:
   * migrations only run forwards, and a field this build has never heard of
   * would be dropped on the next write.
   */
  | 'future'
  /** A version this build has no upgrade path from. */
  | 'no-migration'
  /** Shaped right, contents wrong. The schema rejected it. */
  | 'invalid';

export class SaveFileError extends Error {
  readonly reason: SaveFileFailure;
  /** What kind of file this was, for a message a player can act on. */
  readonly label: string;

  constructor(reason: SaveFileFailure, label: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SaveFileError';
    this.reason = reason;
    this.label = label;
  }
}

export function serializeSaveFile(version: number, data: unknown): string {
  return JSON.stringify({ version, data } satisfies SaveEnvelope);
}

const ENVELOPE = z.object({ version: z.number().int().positive(), data: z.unknown() });

export interface ParseOptions<T> {
  /** Names the file in every error message: 'settings', 'profile', 'snapshot'. */
  label: string;
  /** The version this build writes. */
  version: number;
  migrations: Migrations;
  parse: (data: unknown) => { success: true; data: T } | { success: false; error: unknown };
}

/**
 * Reads a save file of any version this build knows how to upgrade.
 *
 * Takes a `parse` callback rather than a Zod schema so the payload can be
 * validated by whatever suits it. A profile is a Zod object; a world snapshot
 * is mostly base64 blobs, which Zod would check the shape of and learn nothing
 * about the contents.
 */
export function parseSaveFile<T>(raw: string, options: ParseOptions<T>): T {
  const { label, version: current, migrations, parse } = options;

  let file: unknown;
  try {
    file = JSON.parse(raw);
  } catch (error) {
    throw new SaveFileError('unreadable', label, `${label}: not valid JSON`, error);
  }

  const envelope = ENVELOPE.safeParse(file);
  if (!envelope.success) {
    throw new SaveFileError(
      'unversioned',
      label,
      `${label}: no version in the file`,
      envelope.error,
    );
  }

  let { version, data } = envelope.data;
  if (version > current) {
    throw new SaveFileError(
      'future',
      label,
      `${label}: from a newer build (v${version}, this is v${current})`,
    );
  }

  while (version < current) {
    const migrate = migrations[version];
    if (migrate === undefined) {
      throw new SaveFileError('no-migration', label, `no migration from ${label} v${version}`);
    }
    data = migrate(data);
    version++;
  }

  const result = parse(data);
  if (!result.success) {
    throw new SaveFileError('invalid', label, `${label}: failed validation`, result.error);
  }
  return result.data;
}

/** Adapts a Zod schema to `ParseOptions.parse`. */
export function zodParser<T>(schema: { safeParse: (data: unknown) => z.ZodSafeParseResult<T> }) {
  return (data: unknown) => {
    const result = schema.safeParse(data);
    return result.success
      ? ({ success: true, data: result.data } as const)
      : ({ success: false, error: result.error } as const);
  };
}
