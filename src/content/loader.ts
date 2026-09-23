import type { z } from 'zod';
import {
  ChallengeSchema,
  EnemySchema,
  HeroSchema,
  PowerSchema,
  ReactionFileSchema,
  StageSchema,
  StatusFileSchema,
  TalentSchema,
  TuningSchema,
  TowerSchema,
} from './schema/index.js';
import type {
  TuningDefinition,
  ChallengeDefinition,
  EnemyDefinition,
  HeroDefinition,
  PowerDefinition,
  ReactionDefinition,
  StageDefinition,
  StatusDefinition,
  TalentDefinition,
  TowerDefinition,
} from './schema/index.js';

/**
 * Turns raw parsed JSON into a validated, indexed content registry.
 *
 * Deliberately does no I/O. The browser gets its files from Vite's glob import
 * and the Node tooling reads them from disk, but both hand the same shape to
 * the same validator — so content-lint and the balance simulator check exactly
 * what the game will load, rather than an approximation of it.
 */

export interface RawFile {
  /** Where the data came from, so a failure can name the file. */
  path: string;
  data: unknown;
}

export interface RawContent {
  tuning: RawFile;
  statuses: RawFile;
  reactions: RawFile;
  towers: RawFile[];
  enemies: RawFile[];
  stages: RawFile[];
  powers: RawFile[];
  heroes: RawFile[];
  talents: RawFile[];
  challenges: RawFile[];
}

export interface ContentRegistry {
  tuning: TuningDefinition;
  statuses: ReadonlyMap<string, StatusDefinition>;
  reactions: ReadonlyMap<string, ReactionDefinition>;
  towers: ReadonlyMap<string, TowerDefinition>;
  enemies: ReadonlyMap<string, EnemyDefinition>;
  stages: ReadonlyMap<string, StageDefinition>;
  powers: ReadonlyMap<string, PowerDefinition>;
  heroes: ReadonlyMap<string, HeroDefinition>;
  talents: ReadonlyMap<string, TalentDefinition>;
  challenges: ReadonlyMap<string, ChallengeDefinition>;
}

export interface ContentIssue {
  path: string;
  field: string;
  message: string;
}

/**
 * Thrown when any content file fails its schema.
 *
 * Reports every problem at once rather than the first. Fixing content one
 * error per run is miserable when a schema change has touched forty files.
 */
export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[];

  constructor(issues: readonly ContentIssue[]) {
    const detail = issues.map((i) => `  ${i.path}: ${i.field} — ${i.message}`).join('\n');
    super(`${issues.length} content validation error(s):\n${detail}`);
    this.name = 'ContentValidationError';
    this.issues = issues;
  }
}

function issuesFrom(path: string, error: z.ZodError): ContentIssue[] {
  return error.issues.map((issue) => ({
    path,
    field: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/** Validates one file per definition, keyed by id. */
function indexBy<T extends { id: string }>(
  files: readonly RawFile[],
  schema: z.ZodType<T>,
  collected: ContentIssue[],
): Map<string, T> {
  const out = new Map<string, T>();
  for (const file of files) {
    const result = schema.safeParse(file.data);
    if (!result.success) {
      collected.push(...issuesFrom(file.path, result.error));
      continue;
    }
    const definition = result.data;
    const existing = out.get(definition.id);
    if (existing !== undefined) {
      collected.push({
        path: file.path,
        field: 'id',
        message: `duplicate id "${definition.id}"`,
      });
      continue;
    }
    out.set(definition.id, definition);
  }
  return out;
}

/** Validates a file that holds an array of definitions. */
function indexArrayFile<T extends { id: string }>(
  file: RawFile,
  schema: z.ZodType<T[]>,
  collected: ContentIssue[],
): Map<string, T> {
  const out = new Map<string, T>();
  const result = schema.safeParse(file.data);
  if (!result.success) {
    collected.push(...issuesFrom(file.path, result.error));
    return out;
  }
  for (const definition of result.data) {
    if (out.has(definition.id)) {
      collected.push({ path: file.path, field: 'id', message: `duplicate id "${definition.id}"` });
      continue;
    }
    out.set(definition.id, definition);
  }
  return out;
}

export function buildRegistry(raw: RawContent): ContentRegistry {
  const issues: ContentIssue[] = [];

  const tuning = TuningSchema.safeParse(raw.tuning.data);
  if (!tuning.success) issues.push(...issuesFrom(raw.tuning.path, tuning.error));

  const registry: ContentRegistry = {
    /* Parsed above; the cast only holds while `issues` is empty, which is
       checked before the registry is returned. */
    tuning: (tuning.success ? tuning.data : {}) as TuningDefinition,
    statuses: indexArrayFile(raw.statuses, StatusFileSchema, issues),
    reactions: indexArrayFile(raw.reactions, ReactionFileSchema, issues),
    towers: indexBy(raw.towers, TowerSchema, issues),
    enemies: indexBy(raw.enemies, EnemySchema, issues),
    stages: indexBy(raw.stages, StageSchema, issues),
    powers: indexBy(raw.powers, PowerSchema, issues),
    heroes: indexBy(raw.heroes, HeroSchema, issues),
    talents: indexBy(raw.talents, TalentSchema, issues),
    challenges: indexBy(raw.challenges, ChallengeSchema, issues),
  };

  if (issues.length > 0) throw new ContentValidationError(issues);
  return registry;
}
