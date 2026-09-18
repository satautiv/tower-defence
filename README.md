# Aetherfall

A tower defence game where victory comes from **how your towers combine**, not how many you can afford.

> **Status: planning complete, implementation not started.**
> This repository currently contains the design and technical specifications, plus a 58-issue
> roadmap. There is no game code yet. See [Roadmap](#roadmap) for where things begin.

---

## The idea

The genre's best games all win on the same thing: every tower has a *job*, and you feel clever
when you work out the right combination for a wave. The worst ones are DPS calculators with art
on top — buy the strongest tower, spam it, win.

Aetherfall's answer is the **Aether Reaction system**. Six damage types leave *statuses* on
enemies, and when two statuses meet on the same enemy they **detonate**:

| | | |
|---|---|---|
| Scorch **+** Chill | → **Thermal Shock** | an area burst that scales with the burn |
| Chill **+** Charge | → **Superconduct** | strips 60% armour and ward from everything nearby |
| Charge **+** Corrode | → **Electrolysis** | an arc that jumps to four more enemies |
| Scorch **+** Corrode | → **Combustion** | ignites neighbours, chaining into further reactions |

A Frost Cairn on its own is a mediocre slow. A Frost Cairn *next to* a Flame Vent is a chain of
Thermal Shocks that clears a lane. The tower isn't strong — the **pairing** is.

That one rule drives everything else: tower identity, enemy design, map layout, upgrade tension,
and the reason to replay a stage a third time.

## What it is

Fixed-path tower defence with authored maps and fixed build plots — closer to Kingdom Rush than
to an open-field maze builder. Built for the browser first, then Android, from a single codebase.

- **8 towers** branching into **16 endgame specialisations**, five tiers deep
- **18 enemy behaviours**, 5 bosses, 3 commandable heroes
- **6 damage types · 7 statuses · 6 reactions**
- Two economies: gold to plan with, Aether Charge to react with
- Ley-line build plots that make placement a real decision without maze-building
- 11 stars per stage across three difficulties plus authored challenge modes

**v1.0 ships Region 1** — 10 stages, complete and polished, 20–30 hours of content. Regions 2–5
follow as updates. Shipping a finished small game beats shipping half of a large one.

## Documentation

| Document | Contents |
|---|---|
| [**Game Design**](docs/GAME_DESIGN.md) | Concept, reaction system, towers, enemies, bosses, campaign, progression, game feel, art and audio direction, UX, accessibility, scope, risks |
| [**Technical Plan**](docs/TECH_DESIGN.md) | Stack rationale, architecture, per-system specifications, content pipeline, tooling, performance budgets, testing, CI/CD, Android port |
| [**CLAUDE.md**](CLAUDE.md) | Working guidance, and the architecture invariants that are cheap to preserve and expensive to retrofit |

## Architecture in one line

> The game simulation is pure TypeScript with **zero dependencies** on the renderer, the DOM, or
> any browser API.

That constraint is what makes the rest possible. Because the simulation runs headless under Node,
2,000 playthroughs of a stage can be simulated in seconds — and a game with 16 towers, 18 enemies
and 3 difficulties is not balanceable by hand. It also buys deterministic replays from a seed,
fast unit tests with no canvas, and an Android port that is a packaging exercise rather than a
rewrite.

Everything else in the technical plan follows from it.

## Planned stack

**TypeScript** · **Vite** · **PixiJS v8** (rendering) · **React + Zustand** (menus only, never the
game loop) · **Howler** (audio) · **Zod** (content validation) · **Vitest + Playwright** (testing)
· **GitHub Actions → Pages** (web) · **Capacitor** (Android)

Alternatives considered and rejected — Phaser, Unity, Godot — are recorded with their reasoning in
[the technical plan](docs/TECH_DESIGN.md#3-stack).

## Roadmap

Tracked as [GitHub issues](https://github.com/satautiv/tower-defence/issues), grouped by milestone.

| Milestone | Delivers |
|---|---|
| **M0** Foundations | Repo, tooling, CI, core primitives, content pipeline |
| **M1** Vertical Slice | One playable map end-to-end — *and the answer to whether the reaction system is actually fun* |
| **M2** Core Systems | All 8 towers, statuses, reactions, soldiers, heroes, abilities, enemy behaviours |
| **M3** Content & Progression | 16 specialisations, bosses, map editor, balance simulator, Region 1, talents, saves |
| **M4** Polish & Feel | Art, audio, VFX, tutorial, accessibility, localisation |
| **M5** Web Launch | Performance, balance, PWA, deployment, QA |
| **M6** Android | Capacitor, touch UX, device testing, Play Store |
| **M7** Post-Launch | Regions 2–5, leaderboards, daily challenge, roguelite mode |

Two sequencing decisions worth knowing:

- **[#19](https://github.com/satautiv/tower-defence/issues/19) is the project's gate.** M1 builds a
  deliberately thin slice — three towers, four enemies, one reaction — to test whether the core
  mechanic is fun and readable while changing the answer is still cheap. Building sixteen towers
  first and *then* discovering the reaction matrix is confusing is the most expensive mistake
  available here.
- **Tools land before the content they serve.** The map editor and balance simulator precede
  Region 1 authoring, not the other way around.

## Development

There is nothing to run yet. Implementation starts with
[#3 — repo scaffolding](https://github.com/satautiv/tower-defence/issues/3), which has no
dependencies and establishes the build toolchain and the lint rules that enforce the architecture
above.

The commands that issue will create are listed in [CLAUDE.md](CLAUDE.md#commands).

## License

Source code is licensed under the [MIT License](LICENSE).

Game assets — art, music, sound effects — are **not** covered by it. Those will carry their own
terms, noted alongside them as they are added. Third-party assets keep their original licences.
