import { StageSchema } from '@content/schema/stage';
import { collectLocaleKeys, lintContent } from '@content/lint';
import type { Diagnostic } from '@content/lint';
import type { ContentRegistry } from '@content/loader';
import type { Draft } from './draft.js';

/**
 * Validating a draft against the rules CI actually enforces (#34).
 *
 * The acceptance criterion is *"exported stages pass `content:lint` every
 * time"*, and the only way to be sure of that is to run the same function.
 * This reimplements no rule: it parses the draft with `StageSchema` and hands
 * it to `lintContent` inside a copy of the real registry, so a rule added to
 * content-lint tomorrow shows up in the editor with no change here.
 *
 * Substituting the draft into the registry rather than linting it alone is
 * what makes the cross-file rules work at all — a wave naming an enemy that
 * does not exist, or a stage whose economy cannot fund its cheapest tower, are
 * questions about the draft *and* about the rest of the content.
 */

export interface Validation {
  /** Parse errors as `path: message`. A draft with any of these is not a stage. */
  schema: string[];
  /** What content-lint says about this stage, and nothing about any other. */
  lint: Diagnostic[];
  /**
   * Locale keys the draft names that the locale file does not have yet.
   *
   * Reported apart from `lint` and deliberately not counted against `valid`:
   * a stage names `stage.1_4.name` before anyone has written the English for
   * it, and blocking an author mid-placement over a string they will add in
   * the same commit would be noise. It is still shown, because the stage does
   * not ship until someone writes it.
   */
  missingLocaleKeys: string[];
  /** Whether this draft would pass CI today, locale strings aside. */
  valid: boolean;
}

export function validateDraft(
  draft: Draft,
  registry: ContentRegistry,
  localeKeys?: ReadonlySet<string>,
): Validation {
  const parsed = StageSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      schema: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      ),
      lint: [],
      missingLocaleKeys: [],
      valid: false,
    };
  }

  const stages = new Map(registry.stages);
  stages.set(parsed.data.id, parsed.data);

  /* Every diagnostic content-lint raises about a stage carries the stage id as
     its source, so this keeps the draft's problems and drops the rest of the
     library's. Locale misses are the exception — they are sourced by key —
     which is why they are collected separately rather than filtered out and
     forgotten. */
  const lint = lintContent({ ...registry, stages }).filter(
    (diagnostic) => diagnostic.source === parsed.data.id,
  );

  const missingLocaleKeys =
    localeKeys === undefined
      ? []
      : [...collectLocaleKeys(parsed.data)].filter((key) => !localeKeys.has(key)).sort();

  return { schema: [], lint, missingLocaleKeys, valid: lint.length === 0 };
}
