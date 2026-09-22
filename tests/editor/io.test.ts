import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { emptyDraft, addPlot, setLeyNode } from '@editor/draft';
import { exportStage, fileNameFor, importStage } from '@editor/io';
import { validateDraft } from '@editor/validate';

/**
 * Round-tripping a stage (#34).
 *
 * The acceptance criteria are *"exported stages pass content:lint every time"*
 * and *"import for round-trip editing"*, and the sharpest test of both is the
 * stage that already ships: read 1-1, hand it to the editor, write it back,
 * and see whether anything was lost on the way.
 */

const registry = buildRegistry(readContentFromDisk());
const shipped = registry.stages.get('1-1');
if (shipped === undefined) throw new Error('stage 1-1 missing');

describe('a stage survives a trip through the editor', () => {
  it('comes back identical, field for field', () => {
    const result = importStage(exportStage(shipped));
    expect(result.errors).toEqual([]);
    expect(result.draft).toEqual(shipped);
  });

  /* Exporting twice has to produce the same bytes, or a save with no edits
     shows up as a diff and nobody can tell real changes from churn. */
  it('is stable: exporting twice gives the same bytes', () => {
    const once = exportStage(shipped);
    expect(exportStage(importStage(once).draft ?? shipped)).toBe(once);
  });

  it('ends with a newline, like every other file here', () => {
    expect(exportStage(shipped).endsWith('\n')).toBe(true);
  });

  it('names the file after the id, which is what codegen keys off', () => {
    expect(fileNameFor(shipped)).toBe('1-1.json');
  });
});

describe('what the editor writes is what content-lint accepts', () => {
  it('exports a fresh draft that passes the CI rules', () => {
    const draft = emptyDraft('9-9', 'stage.9_9.name');
    const round = importStage(exportStage(draft));

    expect(round.errors).toEqual([]);
    const result = validateDraft(round.draft ?? draft, registry);
    expect(result.lint, JSON.stringify(result.lint)).toEqual([]);
  });

  it('carries a ley node through the round trip', () => {
    const draft = setLeyNode(
      addPlot(emptyDraft('9-9', 'stage.9_9.name'), { x: 9, y: 4 }),
      4,
      'surge',
    );
    const round = importStage(exportStage(draft));
    expect(round.draft?.plots.find((plot) => plot.id === 4)?.leyNode).toBe('surge');
  });
});

describe('a file the editor cannot trust is refused at the door', () => {
  it('reports a syntax error rather than throwing', () => {
    const result = importStage('{ not json');
    expect(result.draft).toBeNull();
    expect(result.errors).toHaveLength(1);
  });

  /* A half-valid file becoming a half-working draft is the failure mode worth
     preventing: the author would not find out until export. */
  it('refuses a stage missing a required field, and says which', () => {
    const { id: _dropped, ...withoutId } = shipped;
    const result = importStage(JSON.stringify(withoutId));

    expect(result.draft).toBeNull();
    expect(result.errors.join(' ')).toContain('id');
  });

  it('refuses a stage whose numbers are impossible', () => {
    const result = importStage(JSON.stringify({ ...shipped, lives: -3 }));
    expect(result.draft).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
