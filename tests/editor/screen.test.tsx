// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorScreen } from '@editor/EditorScreen';
import { coverageColour, snap } from '@editor/StageCanvas';

/**
 * The editor, end to end in a DOM (#34).
 *
 * The acceptance criterion is *"a complete, valid, playable stage can be
 * authored end-to-end without touching JSON by hand"*, so these drive the
 * actual controls rather than the model underneath — the model has its own
 * tests, and what could break here is the wiring between them.
 */

afterEach(cleanup);

describe('the editor opens on something valid', () => {
  it('starts on a draft that already passes content-lint', () => {
    render(<EditorScreen />);
    expect(
      within(screen.getByTestId('validation-panel')).getByText(/passes content-lint/i),
    ).toBeInTheDocument();
  });

  it('draws the map it is editing', () => {
    render(<EditorScreen />);
    expect(screen.getByTestId('editor-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('core')).toBeInTheDocument();
    expect(screen.getByTestId('plot-0')).toBeInTheDocument();
    expect(screen.getByTestId('spawn-0')).toBeInTheDocument();
  });
});

describe('placing things', () => {
  /* A click on the map is the editor's whole input model, so the tool it is
     holding decides what that click means. */
  it('adds a plot where the map is clicked', () => {
    render(<EditorScreen />);
    const before = document.querySelectorAll('[data-testid^="plot-"]').length;

    fireEvent.click(screen.getByTestId('editor-canvas'));
    expect(document.querySelectorAll('[data-testid^="plot-"]').length).toBe(before + 1);
  });

  it('adds a waypoint when the path tool is held instead', () => {
    render(<EditorScreen />);
    fireEvent.click(screen.getByRole('radio', { name: 'path' }));

    const before = document.querySelectorAll('[data-testid^="waypoint-"]').length;
    fireEvent.click(screen.getByTestId('editor-canvas'));
    expect(document.querySelectorAll('[data-testid^="waypoint-"]').length).toBe(before + 1);
  });

  it('adds a spawn point with the spawn tool', () => {
    render(<EditorScreen />);
    fireEvent.click(screen.getByRole('radio', { name: 'spawn' }));

    fireEvent.click(screen.getByTestId('editor-canvas'));
    expect(screen.getByTestId('spawn-1')).toBeInTheDocument();
  });
});

describe('undo puts back exactly what was there', () => {
  it('reverses a placement, and redo restores it', () => {
    render(<EditorScreen />);
    const before = document.querySelectorAll('[data-testid^="plot-"]').length;

    fireEvent.click(screen.getByTestId('editor-canvas'));
    expect(document.querySelectorAll('[data-testid^="plot-"]').length).toBe(before + 1);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(document.querySelectorAll('[data-testid^="plot-"]').length).toBe(before);

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(document.querySelectorAll('[data-testid^="plot-"]').length).toBe(before + 1);
  });

  it('offers nothing to undo before anything has happened', () => {
    render(<EditorScreen />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});

describe('the panels answer the questions the author is asking', () => {
  /* The coverage criterion, through the interface: a stage with a hole says so
     in words, not only in colour. */
  it('names the stretch of road nothing covers', () => {
    render(<EditorScreen />);
    const panel = screen.getByTestId('coverage-panel');
    expect(panel).toHaveTextContent(/covered/i);
    expect(screen.getByTestId('coverage-gaps')).toBeInTheDocument();
  });

  it('answers differently once the reach changes', () => {
    render(<EditorScreen />);
    const before = screen.getByTestId('coverage-panel').textContent;

    fireEvent.change(screen.getByLabelText('Coverage reach'), { target: { value: '14' } });
    expect(screen.getByTestId('coverage-panel').textContent).not.toBe(before);
  });

  it('reports a plot dragged off the map as content-lint would', () => {
    render(<EditorScreen />);
    fireEvent.click(screen.getByTestId('plot-0'));

    /* Far enough off the edge to be a bounds error, one nudge at a time. */
    const editor = screen.getByTestId('screen-editor');
    for (let i = 0; i < 12; i++) fireEvent.keyDown(editor, { key: 'ArrowUp', shiftKey: true });

    expect(screen.getByTestId('validation-panel')).toHaveTextContent(/plot-bounds/);
  });

  it('shows a wave its totals', () => {
    render(<EditorScreen />);
    expect(screen.getByTestId('wave-totals-0')).toHaveTextContent(/enemies/);
    expect(screen.getByTestId('wave-totals-0')).toHaveTextContent(/gold/);
  });

  it('moves the totals when the count does', () => {
    render(<EditorScreen />);
    const before = screen.getByTestId('wave-totals-0').textContent;

    fireEvent.change(screen.getByLabelText('Wave 1 group 1 count'), { target: { value: '20' } });
    expect(screen.getByTestId('wave-totals-0').textContent).not.toBe(before);
    expect(screen.getByTestId('wave-totals-0')).toHaveTextContent('20 enemies');
  });

  it('adds a wave and composes a group in it', () => {
    render(<EditorScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Add wave' }));
    expect(screen.getByTestId('wave-1')).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByTestId('wave-1')).getByRole('button', { name: 'Add group' }),
    );
    expect(screen.getByLabelText('Wave 2 group 2 enemy')).toBeInTheDocument();
  });
});

describe('naming the stage', () => {
  /* Without this the author cannot set the stage's display name at all, which
     the first export found: the file came out named after the default. */
  it('offers both the id and the name key', () => {
    render(<EditorScreen />);
    expect(screen.getByLabelText('Stage id')).toHaveValue('9-9');
    expect(screen.getByLabelText('Stage name key')).toHaveValue('stage.9_9.name');
  });

  it('moves the name key along with the id while they still agree', () => {
    render(<EditorScreen />);
    fireEvent.change(screen.getByLabelText('Stage id'), { target: { value: '1-9' } });
    expect(screen.getByLabelText('Stage name key')).toHaveValue('stage.1_9.name');
  });

  /* Guessing over a deliberate choice is worse than not guessing. */
  it('leaves a name key the author wrote themselves alone', () => {
    render(<EditorScreen />);
    fireEvent.change(screen.getByLabelText('Stage name key'), {
      target: { value: 'stage.the_long_climb.name' },
    });
    fireEvent.change(screen.getByLabelText('Stage id'), { target: { value: '1-9' } });

    expect(screen.getByLabelText('Stage name key')).toHaveValue('stage.the_long_climb.name');
  });

  it('says which locale key is still missing', () => {
    render(<EditorScreen />);
    expect(screen.getByTestId('validation-panel')).toHaveTextContent('stage.9_9.name');
  });
});

describe('the pure bits the canvas leans on', () => {
  it('snaps to half a tile', () => {
    expect(snap(3.26)).toBe(3.5);
    expect(snap(3.1)).toBe(3);
    expect(snap(-0.2)).toBe(-0);
  });

  /* Zero is the only value that has to read as an alarm — it is a hole every
     enemy walks through. Deep cover is worth seeing but is not an error. */
  it('colours an uncovered sample as danger and a covered one as not', () => {
    expect(coverageColour(0, 4)).toContain('danger');
    expect(coverageColour(1, 4)).not.toContain('danger');
    expect(coverageColour(4, 4)).not.toContain('danger');
  });

  it('does not divide by zero when nothing covers anything', () => {
    expect(coverageColour(1, 1)).toMatch(/^hsl\(/);
  });
});
