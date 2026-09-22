import { StageSchema } from '@content/schema/stage';
import type { Draft } from './draft.js';

/**
 * Getting a stage out of the editor and back into it (#34).
 *
 * Export writes the same shape `src/content/data/stages/` holds, because the
 * editor's draft *is* a `StageDefinition` rather than an authoring model that
 * needs converting. There is no mapping step here to get wrong, which is the
 * point: a separate model is where round-trip bugs live.
 *
 * Import parses through `StageSchema`, so a hand-edited file with a missing
 * field is rejected at the door rather than becoming a draft that half-works.
 */

export interface ImportResult {
  draft: Draft | null;
  /** Why it was refused, as `path: message`. Empty on success. */
  errors: string[];
}

/**
 * The file name this stage belongs in.
 *
 * Content ids are generated into union types from the file names, so a stage
 * saved under the wrong name is a compile error rather than a silent miss —
 * but only if the author is told what the right name is.
 */
export function fileNameFor(draft: Draft): string {
  return `${draft.id}.json`;
}

/**
 * The stage as JSON, ready to drop into `src/content/data/stages/`.
 *
 * Two spaces, and a trailing newline because every other file in the
 * repository has one. Prettier owns the finer formatting — short arrays it
 * would put on one line are left expanded here — so `npm run format` may
 * reflow an exported file. That is a diff, never a change in meaning, and
 * teaching this function Prettier's line-width rules would be a second
 * formatter to keep in step with the first.
 */
export function exportStage(draft: Draft): string {
  return `${JSON.stringify(StageSchema.parse(draft), null, 2)}\n`;
}

export function importStage(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { draft: null, errors: [`(file): ${(error as Error).message}`] };
  }

  const parsed = StageSchema.safeParse(data);
  if (!parsed.success) {
    return {
      draft: null,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
    };
  }
  return { draft: parsed.data, errors: [] };
}
