import { parentPort, workerData } from 'node:worker_threads';
import { buildRegistry } from '../../src/content/loader.js';
import { createWorldForStage } from '../../src/sim/index.js';
import { readContentFromDisk } from '../content/io.js';
import { runOnce } from './runner.js';
import { strategyByName } from './strategies.js';
import type { WorkerRequest, WorkerReply } from './parallel.js';

/**
 * One slice of a batch, on its own core.
 *
 * Runs are completely independent — each is seeded on its own and shares
 * nothing — so the work divides perfectly and the only thing crossing a thread
 * boundary is the request in and the results out. Content is read per worker
 * rather than sent across, because parsing a few JSON files is far cheaper than
 * serialising a registry.
 */

const request = workerData as WorkerRequest;

try {
  const registry = buildRegistry(readContentFromDisk());
  const stage = registry.stages.get(request.stageId);
  if (stage === undefined) throw new Error(`no stage "${request.stageId}"`);

  /* Built once and reset between runs, exactly as the single-threaded path
     does: rebuilding would re-bake every path for every seed. */
  const world = createWorldForStage(registry, stage, request.seedStart, request.rules);
  const strategy = strategyByName(request.strategyName, world);

  const results = [];
  for (let i = 0; i < request.runs; i++) {
    results.push(runOnce(world, strategy, request.seedStart + i, { maxTicks: request.maxTicks }));
  }

  parentPort?.postMessage({ ok: true, results } satisfies WorkerReply);
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  } satisfies WorkerReply);
}
