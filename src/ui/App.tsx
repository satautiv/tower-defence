import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Overlay } from './Overlay.js';
import { Router } from './Router.js';
import { loadSettings } from './settings.js';
import { loadProfile } from '@app/profile';

/**
 * Composition root for the DOM side.
 *
 * The canvas is not mounted here. It lives inside the in-stage screen so that
 * leaving that screen destroys it; hoisting it to the app root would keep a
 * renderer alive behind every menu.
 */
export function App(): ReactElement {
  /* Read once, early: the splash screen gives both time to land before a
     stage needs the speed or the campaign screen needs its stars. */
  useEffect(() => {
    void loadSettings();
    void loadProfile();
  }, []);

  return (
    <Overlay>
      <Router />
    </Overlay>
  );
}
