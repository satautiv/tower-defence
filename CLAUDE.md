# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**M0 is in progress.** Toolchain (#3), CI (#4), `core/` primitives (#5), the content pipeline (#6),
the render stack (#7) and the UI shell (#8) are done. No gameplay code exists yet — no simulation,
no entities.

`src/ui/` holds the React shell: `store` (UI state only), `Router`, `Overlay`, `GameCanvas`
(owns the renderer's lifetime), `components/` primitives and `hooks/useThrottledValue`.
`src/view/` holds the render stack: `viewport` (letterbox fit), `camera` (pan/zoom, clamped),
`layers` (the ten-layer stack), `terrain` (bake-once texture cache), `input`, `assets`, `app`
(Pixi wiring). The geometry is pure and unit-tested; only `app.ts` touches a renderer.
`src/content/` holds the schemas, seed data and validation; `src/core/` holds the engine-agnostic
primitives everything else builds on: `rng` (seeded,
serialisable), `loop` (fixed timestep; speed multiplies tick count, never delta), `pool`
(`Pool<T>` and `SlotAllocator`), `events` (preallocated, zero-allocation buffer), `vec` (mutating
API), `spatial` (uniform hash), `constants`.

Planning artefacts:

| Path | What it is |
|---|---|
| `docs/GAME_DESIGN.md` | The design source of truth — mechanics, towers, enemies, campaign, progression, scope |
| `docs/TECH_DESIGN.md` | The technical spec — stack, architecture, per-system design, tooling, roadmap |

The implementation roadmap lives entirely in **GitHub issues #3–#60** (`gh issue list`), grouped under milestones M0–M7. Issues #1 and #2 are the closed planning issues and hold the same content as the two docs.

Before implementing anything, read the relevant section of `docs/TECH_DESIGN.md` — the systems are specified in enough detail that guessing will produce something subtly different from the plan. Start at **#3** (repo scaffolding); it has no dependencies.

## Commands

Requires Node 22+. `npm install` first.

```
npm run dev              # Vite dev server
npm run build            # typecheck, then production build
npm run typecheck        # two passes: whole project, then core/+sim/ without the DOM lib
npm run lint             # ESLint, incl. the layer-boundary rules below
npm test                 # Vitest (test:watch to iterate; test:coverage for the 85% gate)
npm run format           # Prettier — code only; *.md is ignored on purpose
npm run generate         # content:gen + atlas:build (runs before dev/test/build)
npm run content:lint     # schema + cross-file validation of all content
npm run atlas:build      # pack assets/sprites into public/assets/atlas
npm run art:placeholder  # regenerate the placeholder sprites (until #42)
npm run bundle:check     # gzipped JS payload vs the 500 kB budget (needs a build first)
npm run changelog        # regenerate CHANGELOG.md from git history
```

CI runs format, typecheck, lint, tests with coverage, build and the bundle gate on every push and
PR, in about 30 seconds. `main` is protected: PRs need `verify` and `commits` green. Admins are
deliberately exempt (`enforce_admins: false`) so the owner can still push directly.

**Commit messages must follow Conventional Commits** — `CHANGELOG.md` is generated from them and
commitlint gates PR commits. Types that reach the changelog: `feat`, `fix`, `perf`, `refactor`,
`docs`, `revert`. `chore`, `ci`, `build` and `test` are valid but deliberately unpublished.

Single test: `npx vitest run tests/smoke.test.ts`, or `npx vitest -t "test name"`.

`assets/sprites/` is committed source art (placeholders until #42); `public/assets/atlas/` and
`src/content/generated/` are built, not committed — `content:gen` runs automatically before
`dev`, `typecheck` and `test`, so it is normally invisible. After editing anything in
`src/content/data` by hand, run it if your editor starts complaining about ids.

**Placeholders**, named now so the naming is settled, implemented later:
`balance` (#35), `test:determinism` (#10, currently `--passWithNoTests`). `android:dev` /
`android:build` arrive with #54. The balance sim will take arguments:
`npm run balance -- --stage 1-8 --difficulty veteran --runs 2000 --strategy greedy`

React, Zustand and Howler are **not installed yet** — they arrive with #8 and #44. Don't add a
dependency before the issue that needs it.

## The architecture invariant everything depends on

> **`sim/` is pure TypeScript with zero dependencies on the renderer, the DOM, or any browser API.**

This is not a style preference. It is what makes headless balance simulation possible, and a 16-tower × 18-enemy × 3-difficulty game is not balanceable by hand. It also buys deterministic replays, fast unit tests, and a contained Android porting risk.

Concretely, inside `src/sim/**`:
- No importing `pixi.js`, `react`, `howler`, or anything from `view/`, `ui/`, `audio/`, `platform/`
- No `window`, `document`, `Date.now()`
- **No `Math.random()`** — use the seeded RNG stream on the `World`

Enforced three ways ([ADR-0002](docs/adr/0002-enforcing-layer-boundaries.md)): ESLint
`no-restricted-imports` per directory, `no-restricted-globals`/`no-restricted-properties`, and
`tsconfig.sim.json` — a second typecheck pass with the DOM lib removed entirely, so `core/` and
`sim/` cannot reach the browser even by a route nobody blocklisted.

`tests/guardrails.test.ts` lints synthetic files and asserts each rule still fires. If you add a
layer, extend those tests too — a guardrail nobody re-checks is worse than none, because it is
trusted.

Dependency direction: `core ← sim ← app`, with `view`, `ui` and `audio` depending on `core` and reading `sim`. `view`/`ui` may **read** sim state and **dispatch commands**; they may never mutate it.

## Non-obvious rules a naive implementation will break

These are spread across several doc sections. Getting any of them wrong causes bugs that are expensive to find later.

**Determinism** — Iterate entities by stable entity ID, never by object-key or `Set` order. Commands are queued and applied at a **tick boundary**, never mid-tick. A replay is `{seed, stageId, difficulty, talents, commands}`; the determinism test (same seed ⇒ identical world hash after 10,000 ticks) runs on every PR from #10 onward.

**Speed control is tick count, not delta scaling** — 3× speed runs 3 sim ticks per frame. It does not multiply `dt`. A stage simulated at 1× and at 3× must produce byte-identical final state. This is a correctness test, not an approximation.

**One damage queue, one formula** — Every damage source (projectiles, beams, DoTs, reactions, soldiers, hero) pushes a `DamageEvent` into a single queue resolved in one place. Deaths are **deferred** until the whole queue drains. This is what makes splitters, contagion and bounty deterministic regardless of which system dealt damage first, and it is why nothing can ever hit a corpse.

**Tick pipeline order is load-bearing** (`TECH_DESIGN.md` §6.4) — status ticks run *before* reactions (a DoT can apply the stack that triggers a reaction the same tick); reactions run *before* movement (Superconduct strips armour before this tick's damage lands).

**Zero allocation in the tick loop** — no object literals, no closures, no `.map`/`.filter` inside `sim/systems/**`. Entities use structure-of-arrays typed pools; range queries write into caller-supplied buffers. This is what keeps GC pauses out of the frame budget on mobile.

**Typed-array reads need `!`** — `noUncheckedIndexedAccess` is on and it applies to typed arrays,
so `hp[i]` is `number | undefined`. The flag stays on because it catches real bugs on `Map.get()`
and plain arrays; at typed-array sites the index is guaranteed by `SlotAllocator`, so assert with
`as number` or `!` and document the invariant once per class rather than at each read. See
`src/core/spatial.ts` for the pattern.

**No balance number lives in `src/`** — every stat, cost, duration and multiplier goes in JSON under `content/data/`, validated by Zod, with content IDs generated into union types so a typo in a wave file is a compile error. The only acceptable numbers in code are technical constants in `core/constants.ts`.

**The UI never renders at 60Hz** — React is chrome around the Pixi canvas, not the game loop. HUD counters read throttled selectors (~10Hz). All input becomes a `Command`; the UI has no direct path to world mutation — the same interface the balance simulator's scripted AI uses.

**The sim never calls out** — it emits typed `SimEvent`s into a buffer that view and audio drain. That is precisely what makes it headless-testable.

## Budgets these choices exist to protect

| | Target |
|---|---|
| Frame (16.6ms) | sim ≤4ms · render ≤8ms · UI ≤1ms |
| Worst case | 300 enemies · 400 projectiles · 1,000 particles |
| Coverage | `sim/` and `core/` ≥85% (`view`/`ui` covered by E2E instead) |
| Initial JS | ≤500KB gzipped |
| CI gates | fail on >15% frame-time regression, or any stage win rate moving >±10% |

## Design context worth knowing

The game's central bet is the **Aether Reaction system** (`GAME_DESIGN.md` §4): six damage types apply five statuses, and specific status pairs detonate. Tower identity, enemy counter-play, map layout and upgrade tension all hang off it.

Two consequences for how work is sequenced:

- **#19 is the project's gate.** M1 deliberately builds a thin slice (3 towers, 4 enemies, one reaction) to test whether the reaction system is fun and readable while changing the answer is still cheap. Do not build the remaining towers on an unproven core.
- **Tools land before the content they serve.** The map editor (#34) and balance simulator (#35) precede Region 1 authoring (#36).

Scope discipline: **v1.0 ships Region 1 only** (10 stages). Regions 2–5 are M7 content updates. Resist widening this.

## Conventions

- Conventional Commits (the changelog is generated from them)
- ADRs in `docs/adr/NNNN-title.md` for decisions that would be expensive to reverse, written when the decision is made
- Comments explain *why*, never *what*
- Systems are functions over the world — `movementSystem(world)`, not `world.movement.update()`
- The repo owner's standing instruction: **commit and push completed work without asking.** Do not leave finished changes sitting in the working tree awaiting confirmation.
