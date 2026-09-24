/// <reference types="vite/client" />

/**
 * Flags that exist only in a dev build (#81).
 *
 * Read from the query string rather than put on a screen, for the reason
 * `docs/PLAYTEST-REGION1.md` gives: a facilitator must not open the dev overlay
 * in front of a tester, because `~` puts frame times and cheat buttons on
 * screen. A hatch reachable only through the forbidden door is no hatch. A
 * parameter survives a reload, can be bookmarked, and cannot be stumbled upon.
 *
 * Every flag tests `import.meta.env.DEV` as its first statement — the same
 * branch the editor and the dev overlay are reached through. It is replaced by
 * a literal at build time, so everything below it is dead code Rollup drops,
 * and **a shipped build cannot be unlocked by typing in the URL bar**. That is
 * not tidiness: #60 puts leaderboards on these stages.
 */

/** What a caller reads when nothing passes a query string — the real one. */
function currentSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

/**
 * Whether the campaign's sequential gate is being bypassed: `?unlock=all`.
 *
 * Session-only, and deliberately never written to the profile. Stamping a
 * synthetic clear into the profile would corrupt the very data a playtest is
 * collecting, and it would outlive the parameter — remove the flag and the
 * campaign would stay open, with no way left to tell a real clear from a
 * manufactured one.
 *
 * It opens **stage access and nothing else**. Tower, hero, power and
 * specialisation unlocks are resolved in `buildRuleset` and change what the
 * simulation actually computes, so a flag that touched those would mean the
 * board being played is not the board the balance simulator measures.
 */
export function unlockAllStages(search?: string): boolean {
  /* First statement, and `search` is resolved *after* it rather than as a
     default argument — a default is evaluated at the call site before the body
     runs, which left a live `window.location.search` read in the production
     bundle even though the function could only return false. Caught by grepping
     `dist/`, which is the only thing that can see it. */
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search ?? currentSearch()).get('unlock') === 'all';
}
