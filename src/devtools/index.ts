/**
 * The dev overlay (#41), reached by exactly one dynamic import.
 *
 * Nothing that ships may import this module or anything under it. The 500 kB
 * gate sums every emitted chunk whether or not a player loads it — its own
 * caveat says so — so a lazily-loaded overlay would still cost the budget. The
 * stage screen reaches it through an `import()` inside an `import.meta.env.DEV`
 * branch, which Rollup drops along with the whole directory, and
 * `eslint.config.js` forbids a static import from all seven shipping layers.
 * `tests/guardrails.test.ts` proves each ban still fires.
 */

export { StageDevtools, TIME_SCALES } from './overlay.js';
export type { DevState } from './overlay.js';
export { DevPanel } from './DevPanel.jsx';
export type { DevPanelProps } from './DevPanel.jsx';
export { DevOverlay } from './DevOverlay.jsx';
export type { DevOverlayProps } from './DevOverlay.jsx';
export { DamageWatcher, healthLost, EMPTY_LOG } from './damageLog.js';
export type { DamageEntry, DamageLog } from './damageLog.js';
export { DebugView, NO_TOGGLES, anyToggle } from './debugDraw.js';
export type { DebugToggles } from './debugDraw.js';
export { readDevStats, sampleCommands, samplePeaks, freshPeaks } from './stats.js';
export type { BufferPeaks, BufferStat, DevStats, HashStat, PoolStat } from './stats.js';
export { SplitTimer } from './timing.js';
export type { SplitStats } from './timing.js';
