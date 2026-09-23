import type { ReactElement } from 'react';
import { CodexView } from '../codex/CodexView.js';
import { Button, Panel } from '../components/index.js';
import { useUiStore } from '../store.js';

/**
 * The Codex, from the menu (#38).
 *
 * A thin shell around `CodexView`, which is the same component the pause panel
 * mounts. The screen owns nothing but the frame and the way back.
 */
export function CodexScreen(): ReactElement {
  const goBack = useUiStore((state) => state.goBack);

  return (
    <div className="ui-screen" data-testid="screen-codex">
      <Panel title="Codex">
        <CodexView />
      </Panel>
      <Button variant="ghost" onClick={goBack}>
        Back
      </Button>
    </div>
  );
}
