import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import type { GameView } from '@view/app';
import { GameCanvas } from '../GameCanvas.js';
import { drawStagePreview } from './stagePreview.js';
import { Button, Modal, Panel } from '../components/index.js';
import { Hud } from '../hud/Hud.js';
import { useUiStore } from '../store.js';

/**
 * The only screen that mounts the renderer.
 *
 * Everything else is DOM. Leaving here unmounts GameCanvas, which destroys the
 * Pixi application and releases its WebGL context — see the comment there for
 * why that matters rather than being merely tidy.
 */
export function InStageScreen(): ReactElement {
  const navigate = useUiStore((state) => state.navigate);
  const openPanel = useUiStore((state) => state.openPanel);
  const closePanel = useUiStore((state) => state.closePanel);
  const [unsupported, setUnsupported] = useState(false);

  const selectedStageId = useUiStore((state) => state.selectedStageId);

  /* Stable, so GameCanvas never re-runs its effect and tears down the renderer
     because a parent happened to re-render. */
  const handleReady = useCallback(
    (view: GameView) => {
      void drawStagePreview(view, selectedStageId ?? '1-1');
    },
    [selectedStageId],
  );

  const handleUnsupported = useCallback(() => setUnsupported(true), []);

  return (
    <div className="ui-screen ui-screen--stage" data-testid="screen-in-stage">
      {!unsupported && <GameCanvas onReady={handleReady} onUnsupported={handleUnsupported} />}

      {unsupported ? (
        <Panel title="Cannot render">
          <p className="ui-muted">This device cannot run the game board.</p>
          <Button onClick={() => navigate('menu')}>Back to menu</Button>
        </Panel>
      ) : (
        <Hud />
      )}

      <Modal open={openPanel === 'pause'} title="Paused" onClose={closePanel}>
        <Button variant="primary" onClick={closePanel}>
          Resume
        </Button>
        <Button onClick={() => navigate('inStage')}>Restart</Button>
        <Button variant="danger" onClick={() => navigate('stageSelect')}>
          Quit to stage select
        </Button>
      </Modal>
    </div>
  );
}
