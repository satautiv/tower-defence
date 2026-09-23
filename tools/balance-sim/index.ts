import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildRegistry } from '../../src/content/loader.js';
import { createWorldForStage } from '../../src/sim/index.js';
import type { RulesetOptions } from '../../src/sim/index.js';
import { readContentFromDisk } from '../content/io.js';
import { formatConsole, formatCsv, formatJson, hasFailure, summarise } from './report.js';
import type { Summary } from './report.js';
import { defaultWorkers, runParallel } from './parallel.js';
import { runBatch } from './runner.js';
import { defaultStrategies, strategyByName } from './strategies.js';
import type { Strategy } from './strategies.js';

/**
 * The headless balance simulator (#35).
 *
 * A 16-tower × 18-enemy × 3-difficulty game is not hand-balanceable, and the
 * whole architecture — `sim/` pure, no renderer, no DOM — exists so that this
 * program can exist. Two thousand runs take seconds because nothing draws.
 *
 *   npm run balance -- --stage 1-1 --runs 2000 --strategy greedy
 *
 * With no strategy named it runs every one of them, which is usually what you
 * want: the interesting number is rarely one strategy's win rate, it is the
 * difference between two of them.
 */

interface Options {
  stages: string[];
  strategy: string | null;
  runs: number;
  seedStart: number;
  difficulty: string;
  challenge: string | null;
  csvPath: string | null;
  jsonPath: string | null;
  quiet: boolean;
  workers: number;
}

const USAGE = `
Usage: npm run balance -- [options]

  --stage <id>         Stage to run, repeatable. Default: every stage.
  --runs <n>           Runs per strategy. Default: 200.
  --strategy <name>    greedy | balanced | rush | single[:<towerId>]
                       Default: all of them, plus one per tower.
  --seed-start <n>     First seed. Runs use seedStart..seedStart+runs-1. Default: 1.
  --difficulty <name>  relaxed | normal | veteran | impossible. Default: normal.
  --challenge <id>     Play a stage's Heroic or Iron variant instead (#45).
  --csv <path>         Also write a CSV report.
  --json <path>        Also write a JSON report.
  --workers <n>        Cores to spread runs across. Default: all but one.
                       1 runs in-process, which is easier to debug.
  --quiet              Findings only, no per-strategy block.
`.trim();

function parseArgs(argv: string[]): Options {
  const options: Options = {
    stages: [],
    strategy: null,
    runs: 200,
    seedStart: 1,
    difficulty: 'normal',
    challenge: null,
    csvPath: null,
    jsonPath: null,
    quiet: false,
    workers: defaultWorkers(),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };

    switch (arg) {
      case '--stage':
        options.stages.push(value());
        break;
      case '--runs':
        options.runs = Number(value());
        break;
      case '--strategy':
        options.strategy = value();
        break;
      case '--seed-start':
        options.seedStart = Number(value());
        break;
      case '--difficulty':
        options.difficulty = value();
        break;
      case '--challenge':
        options.challenge = value();
        break;
      case '--csv':
        options.csvPath = value();
        break;
      case '--json':
        options.jsonPath = value();
        break;
      case '--workers':
        options.workers = Number(value());
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--help':
      case '-h':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown option "${arg}"\n\n${USAGE}`);
    }
  }

  if (!Number.isFinite(options.runs) || options.runs < 1) {
    throw new Error('--runs must be a positive number');
  }
  if (!Number.isFinite(options.workers) || options.workers < 1) {
    throw new Error('--workers must be a positive number');
  }
  return options;
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const registry = buildRegistry(readContentFromDisk());

  /* Checked against the authored content rather than a list in this file.
     `resolveDifficulty` falls back to the baseline for an unknown mode, which
     is right for a saved run and wrong for a report: it would come out
     labelled "veteran" full of numbers describing something else. */
  if (registry.tuning.difficulties[options.difficulty] === undefined) {
    const known = Object.keys(registry.tuning.difficulties).sort().join(', ');
    throw new Error(`no difficulty "${options.difficulty}" — authored modes: ${known}`);
  }
  if (options.challenge !== null && !registry.challenges.has(options.challenge)) {
    const known = [...registry.challenges.keys()].sort().join(', ');
    throw new Error(
      `no challenge "${options.challenge}"${known === '' ? '' : ` — authored: ${known}`}`,
    );
  }

  const rules: RulesetOptions = {
    difficulty: options.difficulty,
    ...(options.challenge === null ? {} : { challengeId: options.challenge }),
  };

  const stageIds = options.stages.length > 0 ? options.stages : [...registry.stages.keys()].sort();

  const summaries: Summary[] = [];
  const startedAt = Date.now();
  let towerIds: readonly string[] = [];

  for (const stageId of stageIds) {
    const stage = registry.stages.get(stageId);
    if (stage === undefined) {
      throw new Error(
        `no stage "${stageId}" — known stages: ${[...registry.stages.keys()].sort().join(', ')}`,
      );
    }

    /* One throwaway world to resolve the roster, so a strategy can be named
       after a tower without the caller knowing its index. */
    const probe = createWorldForStage(registry, stage, options.seedStart, rules);
    towerIds = probe.rules.towers.ids;

    const strategies: Strategy[] =
      options.strategy === null
        ? defaultStrategies(probe)
        : [strategyByName(options.strategy, probe)];

    for (const strategy of strategies) {
      /* One core means no threads at all: the overhead of starting one would
         exceed the work, and a stack trace from the parent is far easier to
         read than one relayed across a thread boundary. */
      const results =
        options.workers === 1
          ? runBatch(registry, stage, strategy, {
              runs: options.runs,
              seedStart: options.seedStart,
              rules,
            })
          : await runParallel(
              {
                stageId,
                strategyName: strategy.name,
                runs: options.runs,
                seedStart: options.seedStart,
                rules,
              },
              options.workers,
            );

      summaries.push(summarise(stageId, strategy.name, towerIds, stage.balance, results));
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const totalRuns = summaries.reduce((total, s) => total + s.runs, 0);

  if (!options.quiet) {
    for (const summary of summaries) console.log(formatConsole(summary), '\n');
  }

  if (options.csvPath !== null) {
    write(options.csvPath, formatCsv(summaries, towerIds));
    console.log(`csv  → ${options.csvPath}`);
  }
  if (options.jsonPath !== null) {
    write(options.jsonPath, formatJson(summaries));
    console.log(`json → ${options.jsonPath}`);
  }

  console.log(
    `balance — ${totalRuns} runs across ${summaries.length} strategy/stage pairs ` +
      `in ${elapsed.toFixed(1)}s (${Math.round(totalRuns / Math.max(elapsed, 0.001))} runs/s)`,
  );

  /* A stage outside its authored band is a build failure, not a note: that is
     the whole point of writing the band down. Pick rates and reaction counts
     warn instead, because they are design conversations rather than breakage. */
  if (hasFailure(summaries)) {
    console.error('\nbalance — a stage is outside its authored band.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`balance — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
