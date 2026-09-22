import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { createWorldForStage } from '@sim/index';
import { readContentFromDisk } from '../../tools/content/io.js';
import { runOnce } from '../../tools/balance-sim/runner.js';
import { balanced } from '../../tools/balance-sim/strategies.js';
import { addPlot, addWaypoint, emptyDraft, setLeyNode } from '@editor/draft';
import type { Draft } from '@editor/draft';
import { coverageOf } from '@editor/coverage';
import { exportStage, importStage } from '@editor/io';
import { validateDraft } from '@editor/validate';
import { FULL_ROSTER } from '../roster.js';

/**
 * The acceptance criterion, whole (#34).
 *
 * > A complete, valid, **playable** stage can be authored end-to-end without
 * > touching JSON by hand.
 *
 * "Valid" is a lint run and "complete" is a schema parse, but *playable* is
 * only ever proven by playing it. So this authors a stage through the editor's
 * own model, sends it out through the exporter and back in through the
 * importer — the round trip a real author's file takes — and then hands it to
 * the balance simulator to actually win.
 *
 * Doing it here rather than by hand once means the claim is re-proven on every
 * CI run, which matters because #36 is about to author ten stages this way.
 */

const registry = buildRegistry(readContentFromDisk());

/** A stage authored the way the editor authors one: clicks, not JSON. */
function authorAStage(): Draft {
  let draft = emptyDraft('9-9', 'stage.9_9.name');

  /* A road that turns, so the coverage analysis has something to measure that
     a straight line would not. */
  draft = addWaypoint(draft, 0, { x: 10, y: 3 });
  draft = addWaypoint(draft, 0, { x: 20, y: 13 });
  draft = addWaypoint(draft, 0, { x: 29, y: 8 });

  /* Plots along it, close enough to cover the road between them. */
  for (const at of [
    { x: 4, y: 10 },
    { x: 9, y: 6 },
    { x: 14, y: 5 },
    { x: 18, y: 9 },
    { x: 23, y: 10 },
  ]) {
    draft = addPlot(draft, at);
  }

  draft = setLeyNode(draft, 5, 'surge');
  return draft;
}

describe('a stage authored in the editor is a stage the game can play', () => {
  const authored = authorAStage();

  it('passes the rules CI enforces', () => {
    const result = validateDraft(authored, registry);
    expect(result.schema).toEqual([]);
    expect(result.lint, JSON.stringify(result.lint)).toEqual([]);
  });

  it('covers the road it drew', () => {
    const coverage = coverageOf(authored, 0, 7);
    expect(coverage.covered).toBeGreaterThan(0.8);
  });

  /**
   * Through the exporter and back, because that is the trip a real file takes:
   * an author downloads it, drops it in `src/content/data/stages/`, and the
   * game loads it from disk. Anything lost in that round trip would show up
   * here as a stage that will not play.
   */
  it('plays to a win after a round trip through the file it would be saved as', () => {
    const round = importStage(exportStage(authored));
    expect(round.errors).toEqual([]);

    const stage = round.draft;
    if (stage === null) throw new Error('the exported stage did not come back');

    const world = createWorldForStage(registry, stage, 1, FULL_ROSTER);
    const result = runOnce(world, balanced(), 1);

    expect(result.won, `ended on wave ${result.wavesCleared}`).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.enemiesKilled).toBeGreaterThan(0);
    expect(result.towersBuilt).toBeGreaterThan(0);
    expect(result.durationSeconds).toBeGreaterThan(0);
  });

  /* Three seeds rather than one: a stage that wins only on the seed it was
     tested with is a stage that has not been shown to work. */
  it('plays the same way on other seeds', () => {
    const stage = importStage(exportStage(authored)).draft;
    if (stage === null) throw new Error('the exported stage did not come back');

    for (const seed of [2, 3, 4]) {
      const world = createWorldForStage(registry, stage, seed, FULL_ROSTER);
      expect(runOnce(world, balanced(), seed).won, `seed ${seed}`).toBe(true);
    }
  });
});
