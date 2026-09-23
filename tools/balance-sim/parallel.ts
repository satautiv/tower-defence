import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { RulesetOptions } from '../../src/sim/index.js';
import type { RunResult } from './runner.js';

/**
 * Spreading a batch across cores.
 *
 * Two thousand runs of stage 1-1 is about thirty million ticks, and a tick is
 * real work — fourteen towers targeting, firing and resolving damage. On one
 * core that is minutes. The runs share nothing and each is seeded on its own,
 * so the work divides perfectly; this is the difference between a tool someone
 * runs while waiting and one they run in CI.
 *
 * Splitting by seed range rather than round-robin is what keeps the result
 * reproducible: run 1,207 is seed 1,207 whether it executed on one core or
 * eight, and the merged output is identical either way.
 */

export interface WorkerRequest {
  stageId: string;
  strategyName: string;
  seedStart: number;
  runs: number;
  maxTicks?: number;
  /**
   * The mode, challenge and roster the run is played under.
   *
   * Sent rather than re-derived, because a worker that built its world from
   * the defaults would quietly report Normal figures under a Veteran heading —
   * the same failure `--difficulty` refused to risk while #40 was unbuilt.
   */
  rules?: RulesetOptions;
}

export type WorkerReply = { ok: true; results: RunResult[] } | { ok: false; error: string };

/** Contiguous seed ranges, one per worker, as evenly as they divide. */
export function splitWork(runs: number, workers: number, seedStart: number): WorkerRequest[] {
  const count = Math.max(1, Math.min(workers, runs));
  const chunk = Math.floor(runs / count);
  const remainder = runs % count;

  const slices: WorkerRequest[] = [];
  let seed = seedStart;
  for (let i = 0; i < count; i++) {
    /* The first `remainder` workers take one extra, so nothing is left over
       and no worker sits idle at the end waiting for a long straggler. */
    const size = chunk + (i < remainder ? 1 : 0);
    if (size === 0) continue;
    slices.push({ stageId: '', strategyName: '', seedStart: seed, runs: size });
    seed += size;
  }
  return slices;
}

/**
 * Cores worth using: all of them.
 *
 * The parent does nothing but await while the workers run, so reserving a core
 * for it would idle one for the whole batch. This is a tool someone runs
 * deliberately and waits for, not a background service competing with a game.
 */
export function defaultWorkers(): number {
  return Math.max(1, availableParallelism());
}

/**
 * Runs a batch across worker threads and returns the results in seed order.
 *
 * Workers load TypeScript through the same tsx loader the parent was started
 * with; without `execArgv` a worker gets a bare Node that cannot read a `.ts`
 * file, and the failure is an unhelpful syntax error deep inside the import.
 */
export async function runParallel(
  request: Omit<WorkerRequest, 'seedStart' | 'runs'> & { seedStart: number; runs: number },
  workers: number,
): Promise<RunResult[]> {
  const slices = splitWork(request.runs, workers, request.seedStart).map((slice) => ({
    ...slice,
    stageId: request.stageId,
    strategyName: request.strategyName,
    maxTicks: request.maxTicks,
    rules: request.rules,
  }));

  const url = new URL('./worker.ts', import.meta.url);
  const batches = await Promise.all(
    slices.map(
      (slice) =>
        new Promise<RunResult[]>((resolve, reject) => {
          const worker = new Worker(url, {
            workerData: slice,
            execArgv: ['--import', 'tsx'],
          });

          worker.on('message', (reply: WorkerReply) => {
            if (reply.ok) resolve(reply.results);
            else reject(new Error(reply.error));
          });
          worker.on('error', reject);
          worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`balance worker exited with code ${code}`));
          });
        }),
    ),
  );

  /* Concatenated in slice order, which is seed order: the report must not
     depend on which core happened to finish first. */
  return batches.flat();
}
