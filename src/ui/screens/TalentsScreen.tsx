import { useState } from 'react';
import type { ReactElement } from 'react';
import { loadContent } from '@content/load';
import type { TalentBranch, TalentDefinition } from '@content/schema/talent';
import { useProfile } from '@app/profile';
import {
  BRANCHES,
  branchNodes,
  previewRank,
  ranksOf,
  refundRank,
  refuseRank,
  respec,
  takeRank,
  talentState,
} from '@app/talents';
import type { RankRefusal } from '@app/talents';
import { Button, Panel } from '../components/index.js';
import { text } from '../text.js';
import { useUiStore } from '../store.js';

/**
 * The Warden Talent tree (#37, docs/GAME_DESIGN.md §14.1).
 *
 * Every rank is one tap to take and one tap to give back, and respec is free.
 * Pillar P5 says locking a player out of experimenting is a design failure, so
 * the screen never asks "are you sure" about spending — only about throwing the
 * whole build away, which is the one action that loses information.
 *
 * Nothing here decides the rules. `app/talents.ts` says what may be taken and
 * what a rank is worth; this draws the answer.
 */

const BRANCH_NAMES: Readonly<Record<TalentBranch, string>> = {
  conduction: 'Conduction',
  foundry: 'Foundry',
  command: 'Command',
  dominion: 'Dominion',
};

const BRANCH_BLURBS: Readonly<Record<TalentBranch, string>> = {
  conduction: 'Aether Reactions',
  foundry: 'Towers',
  command: 'Hero and soldiers',
  dominion: 'Economy and Powers',
};

/**
 * Why a node cannot be taken, in words rather than a code.
 *
 * "Locked" names the prerequisite rather than pointing at the layout. The
 * first wording said "needs the node above", which is true for a node whose
 * prerequisite happens to sit directly above it and wrong for every other —
 * Deep Current needs Aether Well, three rows up.
 */
function refusalText(
  refusal: RankRefusal,
  talent: TalentDefinition,
  nameOf: (id: string) => string,
): string {
  switch (refusal) {
    case 'unknown':
      return 'Not in the tree';
    case 'maxed':
      return 'Fully ranked';
    case 'unaffordable':
      return 'Not enough stars';
    case 'locked': {
      const missing = talent.requires.map(nameOf);
      return missing.length === 0 ? 'Locked' : `Needs ${missing.join(' and ')}`;
    }
  }
}

/**
 * A rank's worth, worded the way its stat is measured.
 *
 * Percentages for a multiplier, plain units for a flat amount — and the sign is
 * dropped, because the description already says whether the thing goes up or
 * down and "recharge -15% faster" reads as an increase.
 */
function amountOf(total: number, mode: 'multiplier' | 'flat'): string {
  const size = Math.abs(total);
  if (mode === 'multiplier') return `${(size * 100).toFixed(size * 100 < 10 ? 1 : 0)}%`;
  return size >= 10 ? String(Math.round(size)) : String(Number(size.toFixed(2)));
}

export function TalentsScreen(): ReactElement {
  const goBack = useUiStore((state) => state.goBack);
  const profile = useProfile((state) => state.profile);
  const replace = useProfile((state) => state.replace);

  const [confirmingRespec, setConfirmingRespec] = useState(false);
  const [branch, setBranch] = useState<TalentBranch>('conduction');

  const tree = loadContent().talents;
  const state = talentState(profile, tree);
  const nodes = branchNodes(tree, branch);

  const take = (id: string): void => replace(takeRank(profile, tree, id));
  const give = (id: string): void => replace(refundRank(profile, tree, id));

  return (
    <div className="ui-screen" data-testid="screen-talents">
      <Panel title="Warden Talents">
        <p className="ui-muted" data-testid="talent-stars">
          {state.available} of {state.earned} {state.earned === 1 ? 'star' : 'stars'} unspent
        </p>

        <div className="ui-branches" role="tablist" aria-label="Talent branches">
          {BRANCHES.map((id) => (
            <Button
              key={id}
              variant={id === branch ? 'primary' : 'ghost'}
              onClick={() => setBranch(id)}
              aria-selected={id === branch}
              role="tab"
              data-testid={`branch-${id}`}
            >
              {BRANCH_NAMES[id]}
            </Button>
          ))}
        </div>
        <p className="ui-muted">{BRANCH_BLURBS[branch]}</p>
      </Panel>

      <Panel title={BRANCH_NAMES[branch]}>
        <ul className="ui-talents" data-testid="talent-list">
          {nodes.map((talent) => (
            <TalentRow
              key={talent.id}
              talent={talent}
              ranks={ranksOf(profile, talent.id)}
              refusal={refuseRank(profile, tree, talent.id)}
              nameOf={(id) => {
                const required = tree.get(id);
                return required === undefined ? id : text(required.nameKey);
              }}
              preview={previewRank(profile, talent)}
              onTake={() => take(talent.id)}
              onGive={() => give(talent.id)}
              canGive={refundRank(profile, tree, talent.id) !== profile}
            />
          ))}
        </ul>
      </Panel>

      <Panel title="Rebuild">
        {confirmingRespec ? (
          <div className="ui-savedata">
            <p className="ui-muted">
              Every rank is returned and every star comes back. Nothing is lost, and you can spend
              them again straight away.
            </p>
            <Button
              variant="primary"
              data-testid="respec-confirm"
              onClick={() => {
                replace(respec(profile));
                setConfirmingRespec(false);
              }}
            >
              Return every rank
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingRespec(false)}>
              Keep this build
            </Button>
          </div>
        ) : (
          <div className="ui-savedata">
            <p className="ui-muted">Respec is free, and always will be.</p>
            <Button
              variant="ghost"
              onClick={() => setConfirmingRespec(true)}
              disabled={state.spent === 0}
            >
              Respec
            </Button>
          </div>
        )}
      </Panel>

      <Button variant="ghost" onClick={goBack}>
        Back
      </Button>
    </div>
  );
}

interface RowProps {
  talent: TalentDefinition;
  ranks: number;
  refusal: RankRefusal | null;
  nameOf: (id: string) => string;
  preview: ReturnType<typeof previewRank>;
  canGive: boolean;
  onTake: () => void;
  onGive: () => void;
}

function TalentRow({
  talent,
  ranks,
  refusal,
  nameOf,
  preview,
  canGive,
  onTake,
  onGive,
}: RowProps): ReactElement {
  const maxed = ranks >= talent.maxRanks;
  /* What the next rank buys, which is the number a player is actually deciding
     about — a node's per-rank figure means nothing without knowing where they
     already are. */
  const step = preview.totalNext - preview.totalNow;
  const why = refusal === null ? null : refusalText(refusal, talent, nameOf);

  return (
    <li className={`ui-talent${ranks > 0 ? ' ui-talent--taken' : ''}`} data-testid={talent.id}>
      <div className="ui-talent__head">
        <span className="ui-talent__name">{text(talent.nameKey)}</span>
        <span className="ui-talent__ranks" data-testid={`${talent.id}-ranks`}>
          {ranks} / {talent.maxRanks}
        </span>
      </div>

      <p className="ui-talent__desc">{text(talent.descriptionKey)}</p>

      <p className="ui-talent__preview">
        {maxed
          ? `Fully ranked · ${amountOf(preview.totalNow, preview.mode)} in total`
          : `Next rank: ${amountOf(step, preview.mode)} more · ${talent.starCostPerRank} ${
              talent.starCostPerRank === 1 ? 'star' : 'stars'
            }`}
      </p>

      <div className="ui-talent__actions">
        <Button
          variant="primary"
          onClick={onTake}
          disabled={refusal !== null}
          title={why ?? undefined}
          data-testid={`${talent.id}-take`}
        >
          Take rank
        </Button>
        <Button
          variant="ghost"
          onClick={onGive}
          disabled={!canGive}
          data-testid={`${talent.id}-give`}
        >
          Give back
        </Button>
        {why !== null && !maxed && (
          <span className="ui-talent__why" data-testid={`${talent.id}-why`}>
            {why}
          </span>
        )}
      </div>
    </li>
  );
}
