import type { ReactElement } from 'react';
import { Overlay } from './Overlay.js';
import { Router } from './Router.js';

/**
 * Composition root for the DOM side.
 *
 * The canvas is not mounted here. It lives inside the in-stage screen so that
 * leaving that screen destroys it; hoisting it to the app root would keep a
 * renderer alive behind every menu.
 */
export function App(): ReactElement {
  return (
    <Overlay>
      <Router />
    </Overlay>
  );
}
