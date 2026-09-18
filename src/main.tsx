import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@ui/App';
import './ui/tokens.css';
import './ui/components/components.css';
import './ui/ui.css';

/**
 * Entry point.
 *
 * React owns the DOM; the renderer is created and destroyed by the in-stage
 * screen. StrictMode is on deliberately: its double-mounting in development is
 * what surfaces renderer teardown bugs, which are otherwise invisible until a
 * player has navigated in and out of a stage a dozen times and the browser
 * refuses to hand out another WebGL context.
 */
const container = document.getElementById('app');
if (container === null) throw new Error('#app mount point missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
