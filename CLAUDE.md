# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**M0 complete. M1 is code-complete; two criteria need hardware and humans. M2 has started.**
#10–#18 are done and stage 1-1 plays start to finish in a browser: `npm run dev`, Campaign → 1-1.
**#21 and #22 are done** — statuses and the Aether Reaction system both run, and reactions are
drawn (distinct shape and colour each, named on first occurrence). The next thing that matters
is **#62**, the reaction gate: it is a playtest, so it needs humans, not code. The protocol is
written and ready in `docs/PLAYTEST-REACTIONS.md`.

**#23 is deliberately blocked behind #62** — "do not build the remaining towers on an unproven
core". #27 depends on #23, so it is blocked too. The M2 systems that are *not* blocked are #24
(soldiers), #25 (hero), #26 (Warden Powers), #29 (enemy behaviours), #30 (ley lines) and #31
(ground effects).

**#19 and #20 stay open on purpose.** #19 needs a playtest with three people who have not
seen the design (protocol in `docs/PLAYTEST-M1.md`); #20 needs the slice run on a physical
Android phone (steps in `docs/adr/0003-android-packaging.md`). Everything else on both is
verified. The reaction gate the M1 gate was written to ask moved to **#62**, after #22,
because the slice has no reactions.

`src/sim/` holds the `World`, five structure-of-arrays entity pools, the command queue, event
buffer, damage queue and the fifteen-step tick pipeline, plus paths and movement (#11), the wave
spawner (#12), targeting, firing and projectiles (#13), damage resolution (#14), economy (#15),
lives and win/lose (#16). Three of the pipeline's fifteen steps are still `noop`:
`soldierSystem` (#24), `heroSystem` (#25) and `groundEffectSystem` (#31). `flushEvents` is
deliberately empty, because the consumer drains and clears.

**Statuses (#21) are live.** `src/sim/systems/status.ts` owns the whole substrate, and
`applyStatus` is the *only* supported way to put one on an enemy — every source funnels through
it so the stack cap, the refresh, boss immunity and Chill's escalation into Freeze are decided in
one place. One rule governs presence everywhere: a status is on an enemy for exactly the ticks
where `tick < expiry`. Damage over time pushes onto the shared damage queue like everything else,
so a kill by fire pays bounty and splits through the same path a projectile's kill takes.
Two consequences worth knowing: a Frost Cairn can now actually freeze (1 Chill/s against a 3s
duration means it takes two overlapping Cairns to reach the cap of 5), and Charge finally does
its one solo job — `chainTargetsPerStack` in `statuses.json` lengthens a chain by +1 per 2 stacks.

**Reactions (#22) are live.** `src/sim/systems/reactions.ts` reads the matrix out of
`content/data/reactions.json` and carries out a row; it knows nothing about which pairs react.
Three properties bound it and all three are load-bearing: **one reaction per enemy per tick**
(authored order is priority order, which is why Amplify is last in the file), a **per-enemy
cooldown** of 1.2s (4s for Amplify), and **reaction damage re-entering the shared damage queue**
as `IsReaction | arcane`. That last one is why chains work with no code to support them — a
Combustion ignites a neighbour, and the neighbour's Scorch meets its Chill on a later tick
through the ordinary path. Reactions scan only enemies whose `statusDirty` flag is set, and the
flag is deliberately *left* set when a pair exists but the cooldown blocks it, so the reaction
fires the tick the lockout lapses instead of waiting for an unrelated status to land.

Reactions query the spatial indexes, which are rebuilt at step 7 while reactions run at step 3 —
so blast positions are one tick stale, by a pixel or two against a blast 96px wide, identically
in every run. A test that places enemies by hand must call `targetingSystem` first or nothing
will find anything.

`src/view/reactions.ts` draws them, because a gate that asks whether a player can *see* a
reaction cannot be run against an effect nobody rendered. `ReactionFeed` holds all the logic and
knows nothing about a renderer, so it is unit-tested; `ReactionsView` is the thin part that
touches Pixi. Each reaction gets its own shape as well as its own colour — every reaction deals
Arcane, so colouring by damage type would render all five identical, which is exactly risk T3.
`src/audio/` is the slice of #44 the gate could not run without: a unique stinger per reaction,
so a player watching their gold still learns that something happened. **Synthesised, not
sampled** — the same bargain `art:placeholder` makes for sprites, and it means **Howler is still
not installed**; the Web Audio API the browser already ships was enough, and #44 can bring the
mixer when it brings adaptive music and sampled assets. `stingers.ts` holds the recipes and the
rate limiter and is pure; `director.ts` owns the context and the autoplay unlock. Audio only
starts inside a real user gesture, so it is unlocked on the first tap on the board.

`src/sim/ruleset.ts` resolves authored content into flat numeric tables once per stage — towers,
enemies, statuses, waves, paths. **No system reads a JSON object or a string id during a tick**,
and it is the single place tiles become world pixels.

`src/app/session.ts` owns the world and the clock; `src/ui/screens/InStageScreen.tsx` turns taps
into commands and drives the render loop. **The UI never mutates the world** — everything goes
through `session.dispatch`, the same route the balance simulator will take.

Two findings from #19, recorded rather than fixed (balance is #50, content #36): stage 1-1 is
won 3-star with zero leaks by a naive board on every seed, and that board is almost entirely
Flame Vents. A 1:14 pick rate is what pillar P1 exists to prevent; the towers that would compete
do not exist yet (#23).

A third, from #21: turning the DoT on shortens the naive 1-1 clear by 142 ticks out of 15,346 —
under 1%. Scorch reaches its cap of 5 stacks and burns for its full authored 30 dmg/s, but
enemies die to projectile damage so quickly that the burn barely gets to work. It is a real
buff to the tower that was already dominant, and a small one.

**A fourth, and the one #62 should be pointed at.** With reactions live, the naive
cost-descending board on stage 1-1 triggers **zero** reactions across every seed, because it
builds nothing but Flame Vents and one damage type cannot react with itself. A board that
alternates towers instead triggers 82, deals 25% more damage (10,489 against 8,384) and clears
22 ticks sooner. So the signature mechanic works and it pays — but on 1-1 the *lazy* line
ignores it entirely, which is a stage-design and roster problem (#36, #23, #50) rather than a
code one. Worth handing to #62's playtesters deliberately rather than hoping they find it.

`src/platform/` isolates every platform difference behind an interface: `SaveAdapter` (localStorage
for the profile, IndexedDB for snapshots, memory as a fallback), `Lifecycle`, `Haptics`,
`Analytics`. `detect.ts` is the only file that knows what platform this is, and it reads
Capacitor's injected global rather than importing the package.

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
| `docs/PLAYTEST-REACTIONS.md` | How to run #62, the reaction gate — the next thing blocking M2 |
| `docs/adr/0004-reaction-readability.md` | What the first gate session found, and what was changed because of it |
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

`npm run test:determinism` is a real gate with its own CI step now — when it fails, something
broke replays, bug reproduction and the balance simulator all at once.

**Placeholders**, named now so the naming is settled, implemented later:
`balance` (#35). `android:dev` / `android:build` arrive with #54. The balance sim will take
arguments:
`npm run balance -- --stage 1-8 --difficulty veteran --runs 2000 --strategy greedy`

Howler is **not installed yet** — it arrives with #44. Don't add a dependency before the issue
that needs it.

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

**Determinism** — Iterate entity slots `0..watermark` with an alive check, never a `Set` of live
entities: slot order is stable and independent of allocation history. Commands are queued and
applied at a **tick boundary**, never mid-tick. `hashWorld()` fingerprints the world and
`tests/determinism/` asserts identical runs; that suite also proves the hash is *sensitive*, since
a fingerprint that never changed would pass regardless. Extend it when you add state — and note
`EnemyPool.meta` is not hashed, so whatever fills it must be.

**Speed control is tick count, not delta scaling** — 3× speed runs 3 sim ticks per frame. It does not multiply `dt`. A stage simulated at 1× and at 3× must produce byte-identical final state. This is a correctness test, not an approximation.

**One damage queue, one formula** — Every damage source (projectiles, beams, DoTs, reactions, soldiers, hero) pushes a `DamageEvent` into a single queue resolved in one place. Deaths are **deferred** until the whole queue drains. This is what makes splitters, contagion and bounty deterministic regardless of which system dealt damage first, and it is why nothing can ever hit a corpse.

**Tick pipeline order is load-bearing** (`TECH_DESIGN.md` §6.4) — status ticks run *before* reactions (a DoT can apply the stack that triggers a reaction the same tick); reactions run *before* movement (Superconduct strips armour before this tick's damage lands).

**Zero allocation in the tick loop** — no object literals, no closures, no `.map`/`.filter` inside `sim/systems/**`. Entities use structure-of-arrays typed pools; range queries write into caller-supplied buffers. This is what keeps GC pauses out of the frame budget on mobile.

**Parenthesise a cast before a bitwise operator** — `x as number & Flag` parses as the *type
intersection* `number & Flag`, not a bitwise AND, and silently makes the test meaningless. Write
`(x as number) & Flag`. This has bitten twice; the compiler catches it only because the flag enums
are const enums with no overlap with `0`.

**Typed-array reads need `!`** — `noUncheckedIndexedAccess` is on and it applies to typed arrays,
so `hp[i]` is `number | undefined`. The flag stays on because it catches real bugs on `Map.get()`
and plain arrays; at typed-array sites the index is guaranteed by `SlotAllocator`, so assert with
`as number` or `!` and document the invariant once per class rather than at each read. See
`src/core/spatial.ts` for the pattern.

**No balance number lives in `src/`** — every stat, cost, duration and multiplier goes in JSON under `content/data/`, validated by Zod, with content IDs generated into union types so a typo in a wave file is a compile error. The only acceptable numbers in code are technical constants in `core/constants.ts`.

**The UI never renders at 60Hz** — React is chrome around the Pixi canvas, not the game loop. HUD counters read throttled selectors (~10Hz). All input becomes a `Command`; the UI has no direct path to world mutation — the same interface the balance simulator's scripted AI uses.

**The sim never calls out** — it emits typed `SimEvent`s into a buffer that view and audio drain. That is precisely what makes it headless-testable.

**No platform conditionals outside `src/platform/`** — no `isNativePlatform`, no `Capacitor`, no
direct `localStorage` or `indexedDB`. Storage goes through `SaveAdapter` so #54 can swap it.
`tests/platform/no-conditionals.test.ts` scans `src/` and fails on a violation.

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
