# ADR-0001 — Stack selection

**Status:** Accepted · **Date:** 2026-09-18 · **Issue:** [#3](https://github.com/satautiv/tower-defence/issues/3)

## Context

The game must launch in the browser and later ship as an Android app from one codebase, and its
design (16 towers × 18 enemies × 3 difficulties, interacting through a status/reaction system) is
not balanceable by hand. See `docs/TECH_DESIGN.md` §1–§3.

## Decision

| Concern  | Choice                                 | Installed              |
| -------- | -------------------------------------- | ---------------------- |
| Language | TypeScript, `strict`                   | `~6.0.3`               |
| Build    | Vite                                   | `^8.3.0`               |
| Renderer | PixiJS                                 | `^8.21.0`              |
| Lint     | ESLint flat config + typescript-eslint | `^10.10.0` / `^8.70.0` |
| Test     | Vitest                                 | `^5.0.1`               |
| Format   | Prettier                               | `^3.9.8`               |

React, Zustand and Howler are deliberately **not** installed yet — they arrive with the UI shell
(#8) and audio (#44). Installing a dependency before the issue that needs it invites using it
somewhere it does not belong.

## TypeScript 6, not 7

TypeScript `7.0.2` is published and is the current `latest`. We are pinned to `~6.0.3` anyway,
because `typescript-eslint@8.70.0` declares `typescript: ">=4.8.4 <6.1.0"`.

typescript-eslint is what enforces the layer boundaries (ADR-0002), and those boundaries protect
the single property the entire architecture rests on. Trading a working guardrail for a newer
compiler would be a bad exchange, so the guardrail wins. Revisit when typescript-eslint supports
TS 7.

`baseUrl` is deprecated in TS 6, so path aliases are declared with `./`-relative targets instead
of being silenced with `ignoreDeprecations`.

## Alternatives rejected

- **Phaser 3** — the strongest runner-up, batteries included. Its Scene/GameObject model wants to
  own game state, which is incompatible with keeping `sim/` pure, and that would cost headless
  balance simulation. Roughly 1,500 lines of our own glue buys full architectural control.
- **Unity / Godot** — excellent Android builds, but 20–40MB WASM web exports with multi-second
  load times. That contradicts a web-first launch and the "under 15 seconds to playing" criterion.
- **Canvas 2D** — cannot sustain 300 entities plus 1,000 particles at 60fps on mobile.
- **A generic ECS library** — six entity kinds, not sixty. Typed pooled arrays give the memory
  layout without the indirection.

## Consequences

- `npm run typecheck` runs two passes; see ADR-0002.
- Vitest reuses `vite.config.ts`, so path aliases are declared once for both.
- Coverage thresholds (85%) apply to `src/core` and `src/sim` only — the pure, cheap-to-test layers.
- Production bundle at scaffold time is ~148 KB gzipped against a 500 KB budget.
