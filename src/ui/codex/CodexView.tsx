import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { codexEntries, codexProgress, isDiscovered, matchingEntries } from '@app/codex';
import type { CodexEntry, CodexSection } from '@app/codex';
import { useProfile } from '@app/profile';
import { Button } from '../components/index.js';
import { text } from '../text.js';

/**
 * The Codex (#38, docs/GAME_DESIGN.md §15).
 *
 * One component, used twice: as a screen from the menu and as an overlay over
 * a paused board. Two implementations of the same list would drift, and the
 * acceptance criterion is that the *paused* one works — so the paused one had
 * better be the same code as the one anybody looks at.
 *
 * Nothing here decides what the Codex knows. `app/codex.ts` resolves the
 * entries from content and says what has been discovered; this draws the
 * answer, and the only thing it adds is which row is open.
 */

const SECTIONS: ReadonlyArray<{ id: CodexSection; label: string }> = [
  { id: 'towers', label: 'Towers' },
  { id: 'enemies', label: 'Enemies' },
  { id: 'reactions', label: 'Reactions' },
  { id: 'statuses', label: 'Statuses' },
  { id: 'damage', label: 'Damage' },
];

export function CodexView(): ReactElement {
  const profile = useProfile((state) => state.profile);
  const [section, setSection] = useState<CodexSection>('reactions');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  /* Resolved from content once. It cannot change while the screen is open —
     content is loaded and cached before the first frame. */
  const entries = useMemo(() => codexEntries(), []);
  const progress = codexProgress(profile, entries);

  /* A search looks everywhere; the tabs only narrow when nothing is typed.
     Someone who types "corrode" wants the status, the towers that apply it and
     the reactions that eat it, not whichever of those the last tab was on. */
  const matched = matchingEntries(entries, query, query.trim() === '' ? section : null, text);

  /**
   * What the player has found, first.
   *
   * Found by opening the Enemies tab after one run: the single Riftling that
   * had actually been killed sat sixteenth, under a wall of undiscovered rows,
   * and had to be scrolled to. Discovery order is only interesting while there
   * is something left to discover — once a section is complete this is one
   * group and the order is the content's own.
   */
  const shown = [...matched].sort((a, b) => {
    const known = Number(isDiscovered(profile, b)) - Number(isDiscovered(profile, a));
    return known !== 0 ? known : text(a.nameKey).localeCompare(text(b.nameKey));
  });

  return (
    <div className="ui-codex" data-testid="codex">
      <div className="ui-codex__head">
        <p className="ui-muted" data-testid="codex-progress">
          {progress.found} of {progress.total} discovered &middot; {progress.percent}%
        </p>
        <input
          className="ui-codex__search ui-interactive"
          type="search"
          value={query}
          placeholder="Search towers, enemies, traits…"
          aria-label="Search the Codex"
          data-testid="codex-search"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="ui-codex__tabs" role="tablist" aria-label="Codex sections">
        {SECTIONS.map((tab) => (
          <Button
            key={tab.id}
            variant={tab.id === section && query.trim() === '' ? 'primary' : 'ghost'}
            role="tab"
            aria-selected={tab.id === section && query.trim() === ''}
            onClick={() => {
              setSection(tab.id);
              setQuery('');
            }}
            data-testid={`codex-tab-${tab.id}`}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="ui-muted" data-testid="codex-empty">
          Nothing matches “{query}”.
        </p>
      ) : (
        <ul className="ui-codex__list" data-testid="codex-list">
          {shown.map((entry) => (
            <CodexRowView
              key={`${entry.section}:${entry.id}`}
              entry={entry}
              known={isDiscovered(profile, entry)}
              open={openId === `${entry.section}:${entry.id}`}
              onToggle={() =>
                setOpenId((current) =>
                  current === `${entry.section}:${entry.id}`
                    ? null
                    : `${entry.section}:${entry.id}`,
                )
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  entry: CodexEntry;
  known: boolean;
  open: boolean;
  onToggle: () => void;
}

/**
 * One entry, closed to a line and opened to its stats.
 *
 * An undiscovered entry keeps its row and loses its contents. Hiding it
 * altogether would mean a player could not tell whether they had seen
 * everything, and "discovery tracking and a completion percentage" only means
 * something when the denominator is visible.
 */
function CodexRowView({ entry, known, open, onToggle }: RowProps): ReactElement {
  const name = known ? text(entry.nameKey) : '???';

  return (
    <li className={`ui-codex__entry${known ? '' : ' ui-codex__entry--unknown'}`}>
      <Button
        variant="ghost"
        className="ui-codex__row"
        onClick={onToggle}
        disabled={!known}
        aria-expanded={open}
        data-testid={`codex-entry-${entry.id}`}
      >
        <span className="ui-codex__name">{name}</span>
        <span className="ui-codex__hint">{known ? (open ? '−' : '+') : 'undiscovered'}</span>
      </Button>

      {known && open && (
        <div className="ui-codex__detail" data-testid={`codex-detail-${entry.id}`}>
          {entry.descriptionKey !== undefined && (
            <p className="ui-codex__desc">{text(entry.descriptionKey)}</p>
          )}
          <dl className="ui-codex__rows">
            {entry.rows.map((row) => (
              <div key={row.label} className="ui-codex__stat">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {entry.counterKey !== undefined && (
            <p className="ui-codex__counter" data-testid={`codex-counter-${entry.id}`}>
              {text(entry.counterKey)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
