import { Suspense, lazy } from 'react';
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
 * A flat switch rather than a routing library: there are seven screens, no URLs
 * to own, and the only non-obvious requirement is that exactly one of them
 * mounts the renderer. Mounting by identity means React unmounts the previous
 * screen — and with it the Pixi application — without any explicit teardown
 * call that someone could forget to add to a new screen.
 *
 * The editor (#34) is the exception, and the shape of the exception is the
 * point. `import.meta.env.DEV` is replaced with a literal at build time, so in
 * a production build this branch is dead code, the `import()` inside it is
 * unreachable, and Rollup drops the whole editor rather than emitting it as a
 * chunk nobody loads. A lazily-loaded chunk would still count against the
 * 500 kB gate, which sums every emitted file — `tools/bundle-budget` says so
 * in its own caveat. Not emitting it at all is what keeps that gate honest.
 */
const EditorScreen = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('@editor/EditorScreen.jsx')).EditorScreen }))
  : null;

export function Router(): ReactElement {
  const screen = useUiStore((state) => state.screen);

  switch (screen) {
    case 'editor':
      /* Unreachable in production: nothing navigates here, and the screen does
         not exist in the build to navigate to. */
      return EditorScreen === null ? (
        <MenuScreen />
      ) : (
        <Suspense fallback={<div className="ui-screen ui-screen--centred">Loading editor…</div>}>
          <EditorScreen />
        </Suspense>
      );
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
