import type { ReactElement } from 'react';
import { InStageScreen } from './screens/InStageScreen.js';
import {
  MenuScreen,
  RegionMapScreen,
  SettingsScreen,
  SplashScreen,
  StageSelectScreen,
} from './screens/screens.jsx';
import { useUiStore } from './store.js';

/**
 * Switches on the current screen.
 *
 * A flat switch rather than a routing library: there are six screens, no URLs
 * to own, and the only non-obvious requirement is that exactly one of them
 * mounts the renderer. Mounting by identity means React unmounts the previous
 * screen — and with it the Pixi application — without any explicit teardown
 * call that someone could forget to add to a new screen.
 */
export function Router(): ReactElement {
  const screen = useUiStore((state) => state.screen);

  switch (screen) {
    case 'splash':
      return <SplashScreen />;
    case 'menu':
      return <MenuScreen />;
    case 'regionMap':
      return <RegionMapScreen />;
    case 'stageSelect':
      return <StageSelectScreen />;
    case 'inStage':
      return <InStageScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}
