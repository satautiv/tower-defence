# ADR-0002 — Enforcing layer boundaries mechanically

**Status:** Accepted · **Date:** 2026-09-18 · **Issue:** [#3](https://github.com/satautiv/tower-defence/issues/3)

## Context

`docs/TECH_DESIGN.md` §1 rests everything on one property: `sim/` is pure TypeScript with no
renderer, DOM or browser dependency, so it can run headless under Node. That is what makes the
balance simulator, deterministic replays and fast unit tests possible.

It is also the easiest property in the codebase to destroy, by one convenient import, months from
now, by someone in a hurry who is right that it would be quicker. Stated as a convention it will
not survive. It has to fail a build.

## Decision

Three independent mechanisms, because each catches what the others miss.

**1. ESLint `no-restricted-imports`, per directory.** `sim/` cannot import a renderer, UI framework
or audio library, nor reach into `view/`, `ui/`, `audio/`, `platform/` or `app/`, by alias or by
relative path. `core/` cannot import from any layer at all. Every message names the rule's purpose
and cites the spec section, so the fix is obvious to whoever trips it.

**2. `no-restricted-globals` and `no-restricted-properties`.** Browser globals are banned in
`core/` and `sim/`, as are `Math.random`, `Date.now` and `performance.now` — a replay must be
reproducible from its seed alone.

**3. `tsconfig.sim.json`, a second typecheck pass with the DOM lib removed.** The lint rules ban
browser globals _by name_, which only covers what someone thought to list. Removing `"DOM"` from
`lib` makes the entire browser surface non-existent at the type level for `core/` and `sim/`, so
those layers cannot reach the browser even through a route nobody anticipated. `npm run typecheck`
runs both passes.

## Verification

`tests/guardrails.test.ts` lints synthetic in-memory files through ESLint's Node API and asserts
each rule fires — and that a legitimate `@core` import in `sim/` stays clean.

This matters more than it looks. A guardrail nobody re-checks is worse than no guardrail, because
it is trusted. An ESLint upgrade or a config refactor could silently stop matching, and the first
symptom would be an impure `sim/` discovered when the balance simulator fails to run under Node —
long after the imports are load-bearing. The tests re-prove the rules on every CI run.

## Consequences

- Legitimate exceptions must be argued for in review, not added with an inline disable.
- `tools/`, `tests/` and config files are exempt; they are not shipped simulation code.
- The rules must be extended when a new layer is added.
