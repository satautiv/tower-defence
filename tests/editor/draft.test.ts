import { describe, expect, it } from 'vitest';
import { StageSchema } from '@content/schema/stage';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import {
  addPlot,
  addSpawnPoint,
  addWaypoint,
  emptyDraft,
  moveCore,
  movePlot,
  moveSpawnPoint,
  moveWaypoint,
  removePlot,
  removeSpawnPoint,
  removeWaypoint,
  setLeyNode,
} from '@editor/draft';
import { validateDraft } from '@editor/validate';

/**
 * The editor's draft model (#34).
 *
 * The acceptance criterion this file exists for is *"exported stages pass
 * content:lint every time"*. That is a claim about what the editor can
 * produce, so the tests drive edits and then run the real validator, rather
 * than asserting that an edit changed a field.
 */

const registry = buildRegistry(readContentFromDisk());

const draft = () => emptyDraft('9-9', 'stage.9_9.name');

describe('a new draft is already a stage', () => {
  it('parses against the schema the game loads', () => {
    expect(() => StageSchema.parse(draft())).not.toThrow();
  });

  /* An editor that cannot validate until the author has finished is an editor
     that tells them about the mistake last. */
  it('passes content-lint from the very first frame', () => {
    const result = validateDraft(draft(), registry);
    expect(result.schema).toEqual([]);
    expect(result.lint, JSON.stringify(result.lint)).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('edits leave a stage that is still a stage', () => {
  it('lays waypoints and moves them', () => {
    let stage = addWaypoint(draft(), 0, { x: 10, y: 2 });
    expect(stage.paths[0]?.points).toHaveLength(3);

    stage = moveWaypoint(stage, 0, 2, { x: 11, y: 3 });
    expect(stage.paths[0]?.points[2]).toEqual({ x: 11, y: 3 });
  });

  /* Two points is the schema's own minimum, and a draft that will not parse
     stops the live validation the rest of the editor leans on. */
  it('refuses to cut a path below two points', () => {
    const stage = draft();
    expect(removeWaypoint(stage, 0, 0).paths[0]?.points).toHaveLength(2);
  });

  it('removes a waypoint when there is one to spare', () => {
    const stage = addWaypoint(draft(), 0, { x: 10, y: 2 });
    expect(removeWaypoint(stage, 0, 1).paths[0]?.points).toHaveLength(2);
  });

  it('gives each plot its own id, and keeps them unique after a removal', () => {
    let stage = addPlot(addPlot(draft(), { x: 8, y: 6 }), { x: 12, y: 10 });
    stage = removePlot(stage, 0);
    stage = addPlot(stage, { x: 16, y: 6 });

    const ids = stage.plots.map((plot) => plot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses to remove the last plot', () => {
    let stage = draft();
    for (const plot of [...stage.plots]) stage = removePlot(stage, plot.id);
    expect(stage.plots).toHaveLength(1);
  });

  it('moves a plot without touching the others', () => {
    const before = draft();
    const untouched = before.plots[1]?.position;
    const stage = movePlot(before, 0, { x: 5, y: 5 });

    expect(stage.plots[0]?.position).toEqual({ x: 5, y: 5 });
    expect(stage.plots[1]?.position).toEqual(untouched);
  });

  /* `undefined` is how the schema says "ordinary plot". An explicit null would
     be a second way to say it, and it would not survive a round trip. */
  it('clears a ley node rather than storing an empty one', () => {
    let stage = setLeyNode(draft(), 0, 'flux');
    expect(stage.plots[0]?.leyNode).toBe('flux');

    stage = setLeyNode(stage, 0, undefined);
    expect('leyNode' in (stage.plots[0] as object)).toBe(false);

    /* An explicit null would be a second way to say "ordinary plot" and it
       would not survive a round trip through JSON. */
    for (const plot of stage.plots) stage = setLeyNode(stage, plot.id, undefined);
    expect(JSON.stringify(stage)).not.toContain('leyNode');
  });

  it('adds and removes spawn points, but never the last one', () => {
    let stage = addSpawnPoint(draft(), { x: 0, y: 2 }, 0);
    expect(stage.spawnPoints).toHaveLength(2);

    stage = moveSpawnPoint(stage, 1, { x: 0, y: 4 });
    expect(stage.spawnPoints[1]?.position).toEqual({ x: 0, y: 4 });

    stage = removeSpawnPoint(stage, 1);
    expect(stage.spawnPoints).toHaveLength(1);
    expect(removeSpawnPoint(stage, 0).spawnPoints).toHaveLength(1);
  });

  it('moves the core', () => {
    expect(moveCore(draft(), { x: 20, y: 4 }).core).toEqual({ x: 20, y: 4 });
  });

  /* Undo is a stack of drafts, and React decides what to redraw by identity.
     An edit that mutated in place would break both quietly. */
  it('never mutates the draft it was given', () => {
    const before = draft();
    const snapshot = JSON.stringify(before);

    addWaypoint(before, 0, { x: 3, y: 3 });
    addPlot(before, { x: 3, y: 3 });
    movePlot(before, 0, { x: 9, y: 9 });
    setLeyNode(before, 0, 'surge');
    moveCore(before, { x: 1, y: 1 });

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('validation is the rules CI runs, not a copy of them', () => {
  it('reports a plot placed off the map', () => {
    const stage = addPlot(draft(), { x: 999, y: 999 });
    const result = validateDraft(stage, registry);
    expect(result.valid).toBe(false);
    expect(result.lint.map((d) => d.rule)).toContain('plot-bounds');
  });

  it('reports a wave that names an enemy nobody authored', () => {
    const stage = {
      ...draft(),
      waves: [
        {
          autoStartDelaySeconds: 20,
          clearBonus: 0,
          groups: [
            { enemy: 'wyrmlet', count: 3, intervalSeconds: 0, delaySeconds: 0, spawnPoint: 0 },
          ],
        },
      ],
    };
    const result = validateDraft(stage, registry);
    expect(result.lint.map((d) => d.rule)).toContain('wave-enemy-ref');
  });

  it('reports a spawn point pointing at a path that is not there', () => {
    const stage = addSpawnPoint(draft(), { x: 0, y: 2 }, 7);
    expect(validateDraft(stage, registry).lint.map((d) => d.rule)).toContain(
      'spawn-point-path-ref',
    );
  });

  /* The draft is linted inside a copy of the real registry, which is the only
     way the cross-file rules can work at all. */
  it('says nothing about the stages already shipped', () => {
    const result = validateDraft(draft(), registry);
    expect(result.lint.every((d) => d.source === '9-9')).toBe(true);
  });

  it('refuses a draft that is not even parseable, without pretending to lint it', () => {
    const broken = { ...draft(), widthTiles: -5 };
    const result = validateDraft(broken, registry);
    expect(result.valid).toBe(false);
    expect(result.schema.length).toBeGreaterThan(0);
    expect(result.lint).toEqual([]);
  });

  /* A missing string is real, but it is not a reason to stop someone who is
     still placing plots — #36 writes the stage and its locale line together. */
  it('flags a locale key the locale file lacks without failing the draft', () => {
    const result = validateDraft(draft(), registry, new Set<string>());
    expect(result.missingLocaleKeys).toContain('stage.9_9.name');
    expect(result.valid).toBe(true);
  });

  it('says nothing about locale keys the file does have', () => {
    const result = validateDraft(draft(), registry, new Set(['stage.9_9.name']));
    expect(result.missingLocaleKeys).toEqual([]);
  });
});
