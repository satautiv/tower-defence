# Map editor

The editor lives in **`src/editor/`**, not here.

`docs/TECH_DESIGN.md` §13.1 names this directory and, in the same breath,
describes the thing it names as *"a browser route (`/editor`, dev-only)"*.
Those two cannot both be true: everything else under `tools/` is a Node
program run from `package.json`, while a browser route has to sit where Vite
resolves it, where the path aliases work, and — most of all — where the
ESLint layer boundaries apply to it.

That last one decided it. The editor must never be imported by anything that
ships, because the bundle gate sums every emitted chunk whether or not a
player loads it. That rule is enforced in `eslint.config.js` and re-proven in
`tests/guardrails.test.ts`, and neither reaches into `tools/`.

So:

| Where | What |
|---|---|
| `src/editor/draft.ts` | the stage being edited, and every edit, as pure functions |
| `src/editor/validate.ts` | runs `lintContent` — the rules CI runs, not a copy |
| `src/editor/coverage.ts` | how much of the road each plot covers, and where the holes are |
| `src/editor/waves.ts` | live wave totals, off the simulation's own tables |
| `src/editor/io.ts` | export and round-trip import |
| `src/editor/*.tsx` | the interface |

Open it with `npm run dev` and the **Editor** button on the main menu, which
exists only in a dev build.
