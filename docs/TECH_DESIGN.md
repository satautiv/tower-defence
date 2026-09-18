# Aetherfall — Technical Plan

> **Status:** v1.0 draft, 2026-09-18 · **Tracked in:** [#2](https://github.com/satautiv/tower-defence/issues/2)
>
> How the design in [`GAME_DESIGN.md`](./GAME_DESIGN.md) gets built, for web first and
> Android second, from one codebase. The milestone roadmap in §20 is broken out into
> issues [#3–#60](https://github.com/satautiv/tower-defence/issues).

## Contents

**Decisions**
1. [The central architectural decision](#1-the-central-architectural-decision) · 2. [Platform strategy](#2-platform-strategy) · 3. [Stack](#3-stack) · 4. [Repository structure & layer rules](#4-repository-structure--layer-rules)

**Core**
5. [Sim ↔ View ↔ UI boundary](#5-sim--view--ui-boundary) · 6. [Simulation core](#6-simulation-core) · 7. [System specifications](#7-system-specifications)

**Supporting layers**
8. [Content pipeline](#8-content-pipeline) · 9. [Rendering layer](#9-rendering-layer) · 10. [UI layer](#10-ui-layer) · 11. [Audio](#11-audio) · 12. [Persistence](#12-persistence)

**Delivery**
13. [Tooling](#13-tooling-the-force-multipliers) · 14. [Performance](#14-performance) · 15. [Testing](#15-testing) · 16. [CI/CD](#16-cicd) · 17. [Android port](#17-android-port) · 18. [Coding standards](#18-coding-standards) · 19. [Risk register](#19-risk-register) · 20. [Milestones](#20-milestones) · 21. [Next step](#21-next-step)

---

## 1. The central architectural decision

Before picking any library, one decision determines the shape of everything else:

> **The game simulation is pure TypeScript with zero dependencies on the renderer, the DOM, or any browser API.**

The simulation is a function of `(state, commands, tick) → state`. It does not know what a sprite is. It cannot call `document`. It cannot call `Math.random()`.

Everything good about this project flows from that constraint:

| Because the sim is pure… | We get |
|---|---|
| It runs in Node with no browser | **Headless balance simulation** — run stage 1-8 ten thousand times overnight and get a win-rate curve. This is how a 16-tower × 18-enemy × 3-difficulty game gets balanced at all. |
| It's deterministic (fixed step + seeded RNG) | **Replays** from a seed + command list. A bug report becomes a 200-byte reproduction. |
| It has no rendering coupling | **Unit tests** for combat maths, reactions, pathing — fast, in CI, no canvas |
| Rendering is a separate consumer | The renderer can be swapped, or the game ported to a native runtime, without touching game rules |
| Speed control is tick count, not delta scaling | **3× speed produces bit-identical outcomes to 1×** — a correctness guarantee, not an approximation |

The GDD (#1) demands a reaction system with six interacting statuses across 16 towers. That is not hand-balanceable. The pure-sim architecture is what makes the design in #1 actually achievable.

---

## 2. Platform strategy

**Web first, Android second, one codebase.**

```
        ┌─────────────────────────────────────┐
        │   Game code (TypeScript, 100%)      │
        │   sim · content · view · ui · audio │
        └───────────────┬─────────────────────┘
                        │  platform adapters
          ┌─────────────┴──────────────┐
          ▼                            ▼
   ┌─────────────┐             ┌──────────────┐
   │  Web build  │             │ Android build│
   │  Vite → PWA │             │  Capacitor   │
   │ GitHub Pages│             │  → AAB →     │
   │             │             │  Play Store  │
   └─────────────┘             └──────────────┘
```

Android is a **WebView wrapper (Capacitor 6)** around the identical build, plus native plugins for storage, haptics, status bar and app lifecycle. On modern Android the WebView is Chrome — a WebGL2 canvas game runs at native speed. Verified TD/2D games ship this way routinely.

**Why not Unity or Godot** (the obvious alternative): both produce excellent Android builds, but their web exports are 20–40MB WASM payloads with multi-second load times and shaky mobile-browser support. That directly contradicts "web first" and success criterion #3 in the GDD (*under 15 seconds from launch to playing*). We would be trading the primary platform's quality for the secondary platform's convenience.

**Escape hatch:** if Capacitor performance ever proves insufficient on low-end devices, the pure-sim layer ports to any runtime with modest effort, because it has no web dependencies. The architecture makes this a *contained* risk rather than a rewrite.

**Validation gate:** a Capacitor build runs on a physical Android device by the **end of M1**, not M6. Discovering platform problems at the end is how ports die.

---

## 3. Stack

| Concern | Choice | Why |
|---|---|---|
| **Language** | **TypeScript 5.x**, `strict: true`, `noUncheckedIndexedAccess` | A game with this many interacting stats is exactly where types pay for themselves |
| **Build** | **Vite 5** | Instant HMR, first-class TS, trivial static output, great for Capacitor |
| **Renderer** | **PixiJS v8** | Fastest mature 2D WebGL/WebGPU renderer for JS. Excellent sprite batching and a real particle container. Rendering only — it is not the game framework. |
| **Audio** | **Howler.js** | Sprite-based audio, pooling, mobile unlock handling, audio-focus behaviour. Solves the problems Web Audio makes you solve yourself. |
| **UI / menus** | **React 19 + Zustand** | HUD, menus, talent tree, codex. Declarative UI is the right tool for UI — and the wrong tool for a 60Hz game loop, hence the hard boundary in §5. |
| **Validation** | **Zod** | Runtime-validates every content JSON *and* infers its TypeScript type. One schema, both guarantees. |
| **Persistence** | `localStorage` / IndexedDB (`idb-keyval`) / Capacitor Preferences | Behind a `SaveAdapter` interface — the game never knows which |
| **Unit/sim tests** | **Vitest** | Same transform pipeline as Vite, fast, runs the pure sim headless |
| **E2E** | **Playwright** | Smoke tests, and screenshot-based visual regression |
| **Lint/format** | **ESLint 9 (flat) + Prettier** | Enforces the layer boundaries in §4 via `no-restricted-imports` |
| **CI/CD** | **GitHub Actions** | Typecheck, lint, test, balance regression, build, deploy |
| **Web hosting** | **GitHub Pages** | Free, zero-ops, same origin as the repo. Netlify as a fallback if preview deploys become important. |
| **Android** | **Capacitor 6** | Wraps the web build; native plugins for the handful of things a WebView can't do |
| **Atlases** | **free-tex-packer-core** in a build script | Automated, reproducible, no manual packing step, no licence cost |

### Rejected alternatives (recorded so we don't relitigate)

| Option | Why not |
|---|---|
| **Phaser 3** | The strongest runner-up — batteries included (scenes, input, audio, tweens, particles). Rejected because its GameObject/Scene model wants to *own* the game state, which fights the pure-sim architecture in §1. We'd spend the saved glue code fighting the framework, and lose headless simulation. Roughly 1,500 lines of our own glue buys full architectural control. |
| **Unity / Godot** | See §2 — web export size and load time are disqualifying for a web-first launch. |
| **React + Canvas 2D** | Canvas 2D cannot sustain 300 entities plus 1,000 particles at 60fps on mobile. |
| **Three.js** | 3D engine overhead for a 2D game. |
| **Redux for game state** | Immutable updates at 60Hz × hundreds of entities is an allocation catastrophe. The sim mutates pooled objects in place, deliberately. |
| **ECS library (bitECS etc.)** | A full generic ECS is overkill for ~6 entity types. We use typed pooled arrays — the performance benefits of SoA without the ceremony. |

---

## 4. Repository structure & layer rules

```
tower-defence/
├── src/
│   ├── core/              # engine-agnostic primitives — depends on NOTHING
│   │   ├── rng.ts             # seeded PRNG (mulberry32), one stream per stage
│   │   ├── loop.ts            # fixed-timestep accumulator loop
│   │   ├── pool.ts            # generic object pool
│   │   ├── events.ts          # typed event bus (ring buffer, no allocation)
│   │   ├── vec.ts             # vector maths, mutating API
│   │   ├── spatial.ts         # uniform spatial hash grid
│   │   └── time.ts
│   │
│   ├── sim/               # THE GAME. Pure TS. No Pixi, no DOM, no React, no Math.random
│   │   ├── world.ts           # World state container
│   │   ├── tick.ts            # the ordered system pipeline
│   │   ├── commands.ts        # the ONLY mutation entry point
│   │   ├── entities/          # Enemy, Tower, Projectile, Soldier, Hero, GroundEffect
│   │   ├── systems/
│   │   │   ├── spawner.ts       reactions.ts    targeting.ts
│   │   │   ├── movement.ts      combat.ts       projectiles.ts
│   │   │   ├── status.ts        soldiers.ts     economy.ts
│   │   │   ├── abilities.ts     hero.ts         lifecycle.ts
│   │   ├── math/              # damage.ts, curves.ts — the balance formulas
│   │   ├── events.ts          # SimEvent union — the sim's only output to the view
│   │   └── snapshot.ts        # serialise / deserialise / migrate
│   │
│   ├── content/           # data + schemas. No logic.
│   │   ├── schema/            # Zod schemas: tower, enemy, wave, stage, talent, hero
│   │   ├── data/              # the actual JSON
│   │   │   ├── towers/  enemies/  stages/  talents/  heroes/  powers/
│   │   ├── loader.ts          # validates on load, fails loudly
│   │   └── ids.ts             # generated union types: TowerId, EnemyId, StageId…
│   │
│   ├── view/              # Pixi. Reads sim state, never writes it.
│   │   ├── stage-renderer.ts  entity-view.ts    interpolation.ts
│   │   ├── vfx/               # particles, reaction effects, damage numbers
│   │   ├── camera.ts          layers.ts         atlas.ts
│   │
│   ├── ui/                # React. Talks to sim ONLY via commands + selectors.
│   │   ├── hud/               # lives, gold, aether, wave panel, ability bar
│   │   ├── screens/           # menu, region map, stage select, results, talents, codex
│   │   ├── components/        # shared primitives
│   │   └── store.ts           # Zustand: UI state only, never game state
│   │
│   ├── audio/             # Howler wrapper, adaptive music mixer, SFX registry
│   ├── platform/          # SaveAdapter, Haptics, Lifecycle, Analytics
│   │   ├── web/  capacitor/  index.ts
│   ├── app/               # bootstrap, screen router, the game session controller
│   └── i18n/              # locale JSON + t()
│
├── tools/
│   ├── balance-sim/       # headless: run stages N times, emit CSV/JSON reports
│   ├── map-editor/        # browser-based stage authoring tool
│   ├── atlas-build/       # texture packing
│   └── content-lint/      # cross-reference validation of all content
│
├── tests/                 # unit (sim), integration (session), e2e (Playwright)
├── android/               # Capacitor-generated Android project
├── public/                # static assets, manifest, service worker
└── docs/                  # GDD, this plan, ADRs
```

### Dependency rule (enforced by ESLint, not by discipline)

```
core   ←  sim  ←  app
  ↑        ↑       ↑
  └──── view ──────┤
  └──── ui ────────┤
  └──── audio ─────┘

content → (schema only)
platform → (nothing)
```

- `sim/**` may import only from `core/**` and `content/schema/**`.
- **`sim/**` importing `pixi.js`, `react`, `howler`, or touching `window`/`document` is a build failure.**
- `view/**` and `ui/**` may read sim state and dispatch commands. They may never mutate it.

This is configured as an ESLint `no-restricted-imports` rule in M0 and is the single most important guardrail in the project. It's the difference between an architecture and a good intention.

---

## 5. Sim ↔ View ↔ UI boundary

```
        ┌──────────────────────────────────────────┐
        │              SIMULATION                  │
        │   fixed 60Hz · deterministic · pure      │
        └───┬──────────────────────────────┬───────┘
      reads │                              │ emits
            │                              ▼
            │                     SimEvent[] (per tick)
            │                     EnemySpawned, EnemyDied,
            │                     ProjectileFired, ReactionTriggered,
            │                     DamageDealt, TowerBuilt, LifeLost…
            │                              │
    ┌───────▼────────┐          ┌──────────▼─────────┐
    │   VIEW (Pixi)  │          │   AUDIO (Howler)   │
    │ entity→sprite  │          │  SFX + music mix   │
    │ interpolated   │          └────────────────────┘
    └────────────────┘
            ▲
            │  selectors (read-only snapshots, throttled to ~10Hz)
    ┌───────┴────────┐
    │   UI (React)   │ ── dispatch(Command) ──► sim command queue
    └────────────────┘
```

**Three rules:**

1. **The sim never calls out.** It emits typed events into a buffer. View and audio drain that buffer each frame. The sim has no idea anyone is listening — which is precisely what makes it headless-testable.
2. **The UI never re-renders at 60Hz.** React reads throttled selectors (~10Hz for counters like gold/lives, event-driven for everything else). The game world is Pixi; React is chrome around it. Mixing these is the most common way browser games end up at 20fps.
3. **All input becomes a `Command`.** `BuildTower`, `UpgradeTower`, `SellTower`, `SetTargetMode`, `CastPower`, `SetRally`, `MoveHero`, `CallWave`, `SetSpeed`. Commands are queued and applied at a **tick boundary**, never mid-tick. This is what makes replays exact.

---

## 6. Simulation core

### 6.1 Fixed timestep

```ts
const TICK_MS = 1000 / 60;   // 16.667ms — the sim's only notion of time
const MAX_CATCHUP = 5;       // never spiral-of-death

let accumulator = 0;

function frame(now: number) {
  accumulator += Math.min(now - last, 250);   // clamp after a tab-switch
  last = now;

  let steps = 0;
  while (accumulator >= TICK_MS && steps < MAX_CATCHUP * speed) {
    for (let s = 0; s < speed; s++) world.tick();   // 2× = 2 ticks, NOT 2× dt
    accumulator -= TICK_MS;
    steps++;
  }

  view.render(accumulator / TICK_MS);   // alpha for interpolation
}
```

**Speed control multiplies tick count, never delta time.** This is why 3× speed is guaranteed to produce the same result as 1× — a requirement straight out of GDD §15.3, and something most TD games get subtly wrong.

### 6.2 Determinism contract

- **One seeded PRNG stream per stage** (mulberry32 — fast, good distribution, 32-bit state, trivially serialisable). `Math.random()` is **banned in `sim/**` by an ESLint rule.**
- Entity iteration order is **always** by stable entity ID, never by object-key order or by a `Set`.
- No `Date.now()` in the sim — only tick counts.
- Floating point: JS doubles are IEEE-754 and deterministic for `+ - * /` across platforms. Avoid `Math.sin/cos/pow` in damage paths; use lookup tables where trig is needed for movement.
- **A replay is `{ seed, stageId, difficulty, talents, commands: [{tick, command}] }`** — a few hundred bytes that exactly reproduces a run. Used for bug reports, balance verification, and potentially leaderboard validation later.

### 6.3 Entity model — typed pools, not a generic ECS

```ts
class EnemyPool {
  // Structure-of-arrays for the hot fields the systems touch every tick
  id:        Int32Array;
  x:         Float32Array;
  y:         Float32Array;
  hp:        Float32Array;
  maxHp:     Float32Array;
  speed:     Float32Array;
  pathId:    Uint8Array;
  pathDist:  Float32Array;   // distance travelled along its path
  armour:    Float32Array;
  ward:      Float32Array;
  flags:     Uint16Array;    // FLYING | BURROWED | ALIVE | FREEZE_IMMUNE | …
  typeIdx:   Uint16Array;    // index into the enemy definition table

  // Statuses: 7 stack counters + 7 expiry ticks, flat arrays indexed [entity*7 + status]
  statusStacks: Uint8Array;
  statusExpiry: Int32Array;

  // Cold/rare data in a parallel plain-object array
  meta: (EnemyMeta | null)[];

  alloc(): number;      // returns a slot index, reusing dead slots
  free(i: number): void;
}
```

**Why not a generic ECS:** we have six entity kinds, not sixty. Typed pools give us the cache-friendly memory layout and zero-allocation steady state that matter for performance, without the indirection and the learning curve. If entity variety ever explodes, this refactors into bitECS cleanly — but it almost certainly won't.

**Zero allocation in the tick loop** is a hard rule. No object literals, no array `.map/.filter`, no closures inside systems. Every temporary vector comes from a scratch pool. This is what keeps mobile GC pauses out of the frame budget.

### 6.4 The tick pipeline

Order is load-bearing — it's what makes behaviour predictable and debuggable:

```
world.tick():
   0. drainCommandQueue()      apply queued player commands atomically
   1. waveSpawner()            spawn due enemies; advance wave timers
   2. statusSystem()           tick DoTs, decay stacks, expire statuses
   3. reactionSystem()         detect status pairs → resolve reactions → emit AoE
   4. movementSystem()         advance pathDist; flyers move straight; apply slows
   5. soldierSystem()          engage/block/melee/respawn; rally movement
   6. heroSystem()             movement, auto-attack, ability cooldowns
   7. targetingSystem()        towers off cooldown pick a target via spatial hash
   8. firingSystem()           spawn projectiles / apply instant beams / pulse auras
   9. projectileSystem()       advance, collide, resolve on-hit
  10. groundEffectSystem()     lingering pools, fields, lava, burning ground
  11. damageResolution()       apply the damage queue, handle deaths & splits
  12. economySystem()          bounty gold, aether charge, wave-clear bonus
  13. lifecycleSystem()        leak detection, lives, win/lose conditions
  14. flushEvents()            hand the SimEvent buffer to view + audio
```

**Critical ordering choices:**
- **Status ticks before reactions** — a DoT can apply the stack that triggers the reaction this same tick.
- **Reactions before movement** — a Superconduct strips armour *before* this tick's damage lands.
- **Damage is queued, then resolved once** (step 11). Nothing dies mid-pipeline. This eliminates an entire class of "tower shot a corpse" and "chain lightning hit a dead enemy" bugs, and makes damage ordering deterministic regardless of which system dealt it.

---

## 7. System specifications

### 7.1 Pathing — pre-baked polylines, no runtime pathfinding

Maps author paths as **polylines with waypoints**. At load time each path is baked into a lookup table of cumulative arc length. An enemy stores only `pathId` + `pathDist` + `laneOffset`.

```ts
interface BakedPath {
  points:     Float32Array;   // x,y pairs
  cumLength:  Float32Array;   // cumulative distance at each point
  totalLength: number;
  branches:   { atDist: number; targetPathId: number; weight: number }[];
}

// Movement is one line and cannot desync:
enemy.pathDist += enemy.speed * slowMult * TICK_SECONDS;
const [x, y] = path.sample(enemy.pathDist);   // binary search + lerp
```

**Why this and not A\*:** O(log n) per enemy per tick, perfectly deterministic, trivially serialisable for snapshots, and it lets a level designer author *exactly* the route they want. The GDD specifies fixed paths with fixed build plots (Part 1 §1.2) — runtime pathfinding would buy nothing and cost frame time and determinism.

- **`laneOffset`** is a small deterministic per-enemy perpendicular offset (derived from entity ID, not RNG) so a pack of 6 doesn't render as one sprite.
- **Flyers** ignore paths entirely: straight line from spawn to the Core, with a sine wobble driven by tick count.
- **Branches** (for multi-path maps) pick deterministically by `rng.pick(weights)` at spawn time, recorded on the enemy.
- **Burrowers** flag as untargetable between two authored `pathDist` values.

### 7.2 Spatial indexing

A **uniform spatial hash grid**, cell size **128px (2 tiles)** — roughly the median tower range, which is the size that minimises both cells-scanned and entities-per-cell.

```ts
class SpatialHash {
  private cells: Int32Array[];       // preallocated, reused
  rebuild(pool: EnemyPool): void;    // once per tick, O(n)
  query(x, y, radius, out: Int32Array): number;  // fills caller's buffer, returns count
}
```

- Rebuilt once per tick (cheap, ~300 entities) rather than incrementally maintained — simpler, and no stale-entry bugs.
- `query()` writes into a **caller-provided buffer** — zero allocation.
- Separate grids for ground and air so anti-air towers don't scan ground entities.

### 7.3 Targeting & firing

Towers do **not** re-target every tick. A tower re-targets only when its cooldown elapses, or when its current target dies or leaves range.

```
Targeting modes: FIRST | LAST | STRONGEST | WEAKEST | CLOSEST
  FIRST     → max pathDist   (default; correct for almost every tower)
  LAST      → min pathDist
  STRONGEST → max currentHp
  WEAKEST   → min currentHp
  CLOSEST   → min distance²  (never take a square root in a hot loop)
```

Three firing modes cover every tower in the GDD:

| Mode | Towers | Behaviour |
|---|---|---|
| **Projectile** | Arbalest, Mortar, Arcane Spire, Alchemist | Spawns a projectile entity; travel time, splash on impact. Mortars use a ballistic arc with a lead-prediction targeting solve. |
| **Instant / beam** | Tesla, Sniper, Plasma Lance, Prism | Resolves the same tick; renders as a line VFX with a decay. Chain lightning walks the spatial hash with a per-jump falloff and a visited set. |
| **Aura / pulse** | Frost Cairn, Flame Vent (cone), Arc Net (field) | No target selection — queries a shape each pulse and applies to everything inside. Cones are a dot-product half-angle test; fields are `GroundEffect` entities. |

### 7.4 Damage resolution

All damage — from projectiles, beams, DoTs, reactions, soldiers, the hero — goes into **one queue** and is resolved in **one place** at step 11.

```ts
interface DamageEvent {
  targetId: number;
  amount:   number;
  type:     DamageType;     // KINETIC | PYRO | CRYO | VOLT | TOXIC | ARCANE | TRUE
  sourceId: number;
  flags:    number;         // IS_REACTION | ARMOUR_PIERCE | CAN_CRIT | NO_STATUS
  statusToApply?: { status: StatusId; stacks: number };
}
```

Single implementation of the GDD Part 1 §7.1 formula:

```ts
function resolveDamage(e: DamageEvent, w: World): number {
  const t = w.enemies, i = e.targetId;
  if (!(t.flags[i] & ALIVE)) return 0;                  // never hit a corpse

  const corrode = t.statusStacks[i * 7 + Status.Corrode];
  const isKinetic = e.type === DamageType.KINETIC;

  let defence = isKinetic ? t.armour[i] : t.ward[i];
  defence = Math.max(0, defence - corrode * 8 - (e.flags & ARMOUR_PIERCE ? t.pierce[i] : 0));
  if (t.flags[i] & SUPERCONDUCTED) defence *= 0.4;

  let dmg = e.type === DamageType.TRUE
    ? e.amount
    : e.amount * (1 - defence / (defence + 50));

  dmg *= 1 + 0.08 * t.statusStacks[i * 7 + Status.Unravel];
  if (isKinetic) dmg *= 1 + 0.03 * t.fracture[i];
  if (e.flags & IS_REACTION) dmg *= w.reactionPower;

  // Overshield absorbs first
  if (t.overshield[i] > 0) { const a = Math.min(t.overshield[i], dmg); t.overshield[i] -= a; dmg -= a; }

  t.hp[i] -= dmg;
  w.events.push(DamageDealt(i, dmg, e.type, e.flags & IS_REACTION));
  if (t.hp[i] <= 0) w.deaths.push(i);                   // deferred — resolved after the queue
  return dmg;
}
```

**One function, one formula, one place to tune.** Every "why did this do 40 damage" question has exactly one answer, and one place to set a breakpoint.

Deaths are collected and resolved **after** the whole queue drains, which makes splitters (Chitin Mother), Contagion (Plague Vat), Scorch-spread (Pyroclast) and bounty award all deterministic regardless of damage ordering.

### 7.5 Status & reaction system

Statuses are stored flat: `statusStacks[entityIndex * 7 + statusId]` and `statusExpiry[...]`. No objects, no maps, no allocation.

```ts
const REACTIONS: ReactionDef[] = [
  { a: Status.Scorch, b: Status.Chill,   id: 'thermal_shock', consumes: true,  radius: 1.5 },
  { a: Status.Chill,  b: Status.Charge,  id: 'superconduct',  consumes: true,  radius: 2.0 },
  { a: Status.Charge, b: Status.Corrode, id: 'electrolysis',  consumes: true,  jumps: 4 },
  { a: Status.Scorch, b: Status.Corrode, id: 'combustion',    consumes: true,  radius: 1.5 },
  { a: Status.Unravel, b: Status.ANY,    id: 'amplify',       consumes: false, cooldown: 4.0 },
];
```

The reaction system iterates only enemies whose `statusDirty` flag was set this tick (by a status application), not all enemies. Per enemy it checks the small reaction table, respects the **1.2s per-enemy reaction cooldown** (GDD Part 1 §4.3), resolves at most one reaction per tick, and emits a `ReactionTriggered` event for the view and audio layers.

**Reaction damage re-enters the same damage queue** as `IS_REACTION | ARCANE`. No special case, no parallel code path. Chained reactions (a Combustion applying Scorch that triggers a neighbour's Thermal Shock) work automatically, bounded by the per-enemy cooldown so they cannot runaway.

### 7.6 Wave spawner

```jsonc
{
  "waves": [
    {
      "id": 7,
      "autoStartDelay": 25,
      "groups": [
        { "enemy": "husk",     "count": 8, "interval": 0.6, "spawnPoint": 0, "delay": 0 },
        { "enemy": "rift_bat", "count": 5, "interval": 0.4, "spawnPoint": 1, "delay": 4 },
        { "enemy": "mender",   "count": 1, "interval": 0,   "spawnPoint": 0, "delay": 9 }
      ]
    }
  ]
}
```

Groups run in parallel with independent delays and intervals. The spawner is a tiny state machine per group. The **wave preview UI reads the exact same data**, so the preview can never drift from reality — a small decision that eliminates a whole category of trust-breaking bugs.

**Early call:** the player may call wave N+1 while N is alive. `bonusGold = floor(secondsRemaining × 1.5)`, capped at the wave's own total bounty. Multiple waves can be in flight simultaneously — the spawner handles an arbitrary number of active waves.

### 7.7 Soldiers & blocking

The most subtle system in any TD, and worth specifying precisely:

- A Barracks maintains up to 3 soldiers with a **rally point** (draggable, clamped to `rallyRange` from the tower).
- Soldiers walk to the rally point and idle. They **only block enemies whose `pathDist` is within a small window of the soldier's own path position**, which prevents the classic bug of a soldier body-blocking an enemy on a visually adjacent but logically different path.
- A blocked enemy sets `blockedBy = soldierId`, stops advancing `pathDist`, and enters melee. Both sides swing on their own timers.
- **Block release:** if the soldier dies, if the soldier is pulled away (rally moved), or after a per-enemy `maxBlockTime` — the last one prevents a permanent stall-lock on bosses and elites.
- Soldier respawn is a per-slot timer, respawning at the tower and walking to rally.
- **The hero uses the identical blocking code path** with different stats. One implementation, two consumers.

### 7.8 Abilities (Warden Powers) & the hero

```ts
interface AbilityDef {
  id: PowerId;
  cost: number;                     // Aether Charge
  cooldown: number;                 // seconds
  targeting: 'point' | 'self' | 'global' | 'path_segment';
  effects: EffectDef[];             // composable primitives
}
```

Effects are **composable primitives**, not bespoke code per ability:
`DamageInRadius` · `ApplyStatusInRadius` · `CreateGroundEffect` · `ModifyStat` · `ForceReactions` · `BlockPath` · `TauntInRadius` · `SpawnEntity`

Every one of the 5 Warden Powers, all 16 tier-5 tower abilities, and all 9 hero abilities in the GDD compose from this set. Adding a new ability becomes a **JSON entry**, not a code change — which is what makes post-launch hero content cheap.

---

## 8. Content pipeline

### 8.1 The rule

> **No balance number appears anywhere in `src/` except as a default in a Zod schema.**

Every stat, cost, duration, multiplier, wave and formula coefficient lives in JSON under `content/data/`. This is non-negotiable, because:
- Balance iteration must not require a rebuild or a code review.
- The headless balance simulator (§13) needs to mutate values programmatically.
- A designer (or the user) can tune the game without touching TypeScript.

### 8.2 Schema-first, with generated types

```ts
export const TowerTierSchema = z.object({
  cost: z.number().int().positive(),
  damage: z.number().nonnegative(),
  damageType: DamageTypeSchema,
  fireRate: z.number().positive(),           // shots per second
  range: z.number().positive(),              // tiles
  splashRadius: z.number().nonnegative().default(0),
  targets: z.enum(['ground', 'air', 'both']).default('both'),
  minRange: z.number().nonnegative().default(0),
  statusApplied: z.object({
    status: StatusIdSchema,
    stacks: z.number().int().positive(),
  }).optional(),
  perks: z.array(PerkSchema).default([]),
});

export const TowerSchema = z.object({
  id: z.string(),
  family: z.enum(['marksman', 'ordnance', 'arcane', 'control']),
  tiers: z.tuple([TowerTierSchema, TowerTierSchema, TowerTierSchema]),
  specialisations: z.tuple([SpecialisationSchema, SpecialisationSchema]),
  unlock: UnlockSchema,
});

export type Tower = z.infer<typeof TowerSchema>;   // type comes free
```

A build step scans `content/data/` and generates `content/ids.ts`:

```ts
export type TowerId = 'arbalest_post' | 'mortar_emplacement' | 'flame_vent' | /* … */;
export type EnemyId = 'riftling' | 'husk' | 'spore_swarm' | /* … */;
export type StageId = '1-1' | '1-2' | /* … */;
```

So a typo in a wave definition is a **compile error**, and the editor autocompletes every content ID. This one step eliminates the most common class of data-driven-game bug.

### 8.3 Content lint (CI gate)

`tools/content-lint` cross-validates the whole content set and fails the build on:
- A wave referencing a non-existent enemy or spawn point
- A stage whose build plots overlap, or sit off the map, or reference an undefined ley type
- An unlock chain that's unreachable, or circular
- A tower with a status but no matching damage type
- A stage whose **total wave bounty is less than the cheapest viable build** (an economically impossible stage — caught statically before anyone plays it)
- Any missing localisation key

---

## 9. Rendering layer

### 9.1 Sim → sprite synchronisation

```ts
class EntityView {
  private sprites = new Map<number, Sprite>();   // entityId → sprite
  private prevX = new Float32Array(MAX);         // last tick's position
  private prevY = new Float32Array(MAX);

  consume(events: SimEvent[]) {
    for (const e of events) switch (e.kind) {
      case 'EnemySpawned':  this.acquire(e.id, e.typeIdx); break;
      case 'EnemyDied':     this.playDeath(e.id, e.damageType); break;
      case 'ReactionTriggered': this.vfx.reaction(e.reactionId, e.x, e.y); break;
    }
  }

  render(alpha: number) {                         // alpha = partial tick, 0..1
    for (const [id, sprite] of this.sprites) {
      sprite.x = lerp(this.prevX[id], sim.x[id], alpha);
      sprite.y = lerp(this.prevY[id], sim.y[id], alpha);
    }
  }
}
```

**Interpolation is what makes a 60Hz sim look smooth on a 120Hz display** and, more importantly, what keeps it smooth when a frame runs long on a phone. Without it, the game visibly stutters under load even when the sim is keeping up.

### 9.2 Layers & batching

Pixi containers, back to front — and **sorted so that each layer is one draw call** from one atlas:

```
0 terrain (static, cached as a single RenderTexture — drawn once per stage)
1 path decals · ley line glow
2 ground effects (pools, fields, lava)
3 build plots + range previews
4 shadows
5 entities (enemies, soldiers, hero, towers)   ← y-sorted for depth
6 projectiles
7 particles  (ParticleContainer)
8 health bars + status icons
9 damage numbers + floating labels
```

- **The terrain layer renders once** into a RenderTexture at stage load. It never redraws.
- **One texture atlas per stage** (terrain + that stage's enemy set) plus one shared atlas (towers, UI, VFX). Two atlases ⇒ minimal texture swapping.
- **Particles use `ParticleContainer`** with a hard cap and an LRU eviction, tied to the accessibility particle-density setting (GDD Part 3 §18).
- **Health bars and status icons draw only when relevant** — full-health enemies with no statuses draw nothing.

### 9.3 Resolution & scaling

Logical **1920×1080**; a fit-scale letterbox with the safe-area inset respected on mobile. Assets authored at 2×, with Pixi resolution set from `devicePixelRatio` capped at 2 (beyond 2 costs fill rate and buys nothing visible on a phone).

---

## 10. UI layer

- **React 19 + Zustand**, rendered as a DOM overlay above the Pixi canvas. Not inside it.
- **Zustand holds UI state only**: which panel is open, the selected tower's entity ID, current screen. Never enemy positions, never gold-per-tick.
- HUD values (gold, lives, Aether) come from a **throttled subscription at ~10Hz**. A human cannot read a number changing at 60Hz; rendering it at 60Hz just burns battery.
- `pointer-events: none` on the overlay root, re-enabled per interactive element, so clicks fall through to the canvas everywhere else.
- **Every interaction dispatches a Command.** The UI has no direct access to world mutation — the same interface the AI in the balance simulator uses.

**Screens** (menu, region map, stage select, results, talents, codex, settings) are plain React routes with the Pixi canvas unmounted or paused. No game loop runs outside a stage.

---

## 11. Audio

```ts
class AudioDirector {
  private layers: Howl[];      // exploration / combat / boss, all playing, gain-mixed
  private sfx: Map<SfxId, Howl>;   // sprite-sheeted, pooled

  consume(events: SimEvent[]);           // sim events → SFX, with per-sound rate limiting
  setIntensity(level: 0 | 1 | 2);        // crossfades layers on the next bar boundary
  duck(db: number, ms: number);          // for reactions and boss events
}
```

- **Adaptive music** is three stems playing in sync, mixed by gain — not three tracks being swapped. Crossfades land on bar boundaries.
- **Rate limiting is essential**: 40 enemies dying in one Thermal Shock must not trigger 40 death sounds. Each SFX has a min-interval and a max-concurrency; beyond it, one sound plays with a slight pitch/volume variation.
- **Mobile audio unlock** on first touch (browsers require a gesture), and **audio focus handling** — the game mutes and pauses on app background (a phone call must not leave music playing).
- All SFX are packed into audio sprites to minimise request count and decode time.

---

## 12. Persistence

### 12.1 Two separate save concerns

| Save | Contents | When | Where |
|---|---|---|---|
| **Profile** | Stars, talents, unlocks, hero levels, codex, settings, best times | On every meaningful change | `localStorage` (small, synchronous, reliable) |
| **Session snapshot** | A full serialised `World` | On app background / tab hide | IndexedDB (can be large) |

The session snapshot is what makes the game survive a phone call mid-stage — which on Android is not an edge case, it's Tuesday.

### 12.2 Versioning & migration

```ts
interface SaveFile { version: number; data: unknown; }

const MIGRATIONS: Record<number, (d: any) => any> = {
  1: d => ({ ...d, heroLevels: {} }),           // v1 → v2 added heroes
  2: d => ({ ...d, codexReactions: [] }),       // v2 → v3 added the codex
};

function load(raw: string): Profile {
  let { version, data } = JSON.parse(raw);
  while (version < CURRENT_VERSION) data = MIGRATIONS[version++](data);
  return ProfileSchema.parse(data);   // Zod validates; corrupt saves fail loudly, not silently
}
```

**Migrations exist from v1, before there is anything to migrate.** Retrofitting a migration system after players have saves is painful; adding it on day one is free.

### 12.3 Platform adapter

```ts
interface SaveAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
// web/LocalStorageAdapter · web/IndexedDbAdapter · capacitor/PreferencesAdapter
```

The game imports `platform/index.ts`, which picks the implementation at runtime via `Capacitor.isNativePlatform()`. **No game code contains a platform conditional.**

---

## 13. Tooling (the force multipliers)

Two tools are worth more than any feature on the list, because they are what let a small team ship a *good* game rather than a finished one.

### 13.1 Map editor (`tools/map-editor`)

A browser route (`/editor`, dev-only) that authors stage JSON visually.

| Panel | Does |
|---|---|
| **Path tool** | Click to lay waypoints, drag to adjust, spline smoothing, branch points, live length readout |
| **Plot tool** | Place build plots, mark ley nodes and pick their type, see coverage circles for a chosen tower/tier |
| **Spawn & Core** | Place spawn points and the Rift Gate, assign paths, define flyer lanes |
| **Decor** | Paint terrain and props onto layers |
| **Wave composer** | Table UI: add groups, pick enemy, count, interval, delay, spawn point; shows total HP, total bounty and estimated wave duration live |
| **Coverage analysis** | Heatmap of how many plots cover each point of path — instantly reveals dead zones and overpowered plots |
| **Playtest** | Launch the stage in-editor without leaving |
| **Export** | Writes validated stage JSON |

**Why this is a real deliverable, not a nice-to-have:** hand-authoring 10 stages × ~16 waves × several groups as raw JSON is roughly 2,000 lines of error-prone data entry, and iterating on a map's *feel* would mean editing coordinates by hand. The editor pays for itself during Region 1 and pays again for every region after.

### 13.2 Headless balance simulator (`tools/balance-sim`)

This is the answer to the GDD's biggest risk (Part 3 §21: *balance is unsolvable by hand*).

```bash
$ npm run balance -- --stage 1-8 --difficulty veteran --runs 2000 --strategy greedy

Stage 1-8 (Veteran) · 2000 runs · strategy=greedy
──────────────────────────────────────────────────
  Win rate           68.4%   [target 55-75%]  ✅
  Median lives left  13 / 20
  Median clear time  5m42s   [target 5-7m]    ✅
  First loss wave    p10=11  p50=14  p90=—
  Peak gold unspent  340     ⚠️  economy loose
  Tower pick rate    flame_vent 91% ⚠️  frost_cairn 88%  arbalest 71%
                     tesla_coil 12% ⚠️  alchemist 9%  ⚠️
  Reactions/run      thermal_shock 142 · superconduct 8 ⚠️ · combustion 2 ⚠️
──────────────────────────────────────────────────
  ⚠️  3 towers below 20% pick rate — under-tuned or outclassed
  ⚠️  2 reactions near-zero — enablers may be mispriced
```

**How it works:** because `sim/` is pure TypeScript with no browser dependencies (§1), it runs directly under Node. A scripted AI plays the stage by dispatching the *same* `Command` objects the UI dispatches. Several strategies (`greedy`, `balanced`, `rush`, `single-type`, plus authored expert builds) approximate different player archetypes.

**What it gives us:**
- Win-rate targets per difficulty, enforced automatically
- **Tower pick rates** — the direct measurement of design pillar P1. If one tower is picked 90% of the time and another 9%, the design has failed and we know it before a player does.
- **Reaction trigger counts** — is the signature mechanic actually firing?
- **Parameter sweeps**: vary one JSON value across a range, chart the effect on win rate
- **A CI regression gate**: if a content change moves any stage's win rate more than ±10%, the PR fails and says so

Running 2,000 headless simulations takes seconds because there's no rendering. This is the single highest-leverage piece of infrastructure in the project.

### 13.3 Dev overlay (in-game, dev builds only)

`~` toggles: FPS + frame-time graph, entity counts by pool, sim ms vs render ms, spatial hash occupancy, event-bus volume, a "give 10,000 gold" button, wave skip, time scale 0.1×–10×, hitbox/range/path visualisation, and a **damage log for the selected enemy** showing every source that hit it with the resolved multipliers. That last one turns "why did that die so fast?" from a debugging session into a glance.

---

## 14. Performance

### 14.1 Budget

Target: **60fps on a 3-year-old mid-range Android phone** (the GDD's success criterion #5) during a worst-case late-game wave.

| Frame budget: 16.6ms | Allocation |
|---|---|
| Simulation tick | **≤ 4ms** |
| Render (Pixi) | **≤ 8ms** |
| UI (React) | **≤ 1ms** (throttled, mostly idle) |
| Headroom | 3.6ms |

Worst case entity counts: **300 enemies · 400 projectiles · 60 towers · 1,000 particles · 30 ground effects.**

### 14.2 Techniques

| Technique | Applied to |
|---|---|
| **Zero allocation in the tick loop** | No literals, no closures, no `.map/.filter` in `sim/systems/**`. Scratch vectors from a pool. Enforced by code review + a profiling test. |
| **Typed arrays (SoA)** | All hot entity fields (§6.3) — cache-friendly, no GC pressure |
| **Object pooling** | Enemies, projectiles, sprites, particles, damage events, VFX |
| **Spatial hash** | Every range query; rebuilt once per tick, queried into caller buffers |
| **Re-target on cooldown only** | Towers don't scan every tick — roughly a 10× reduction in query volume |
| **Squared distances** | No `Math.sqrt` in any comparison |
| **Texture atlases** | Two atlases per stage ⇒ near-minimal draw calls |
| **Static terrain RenderTexture** | Terrain drawn once per stage, never again |
| **ParticleContainer + density LOD** | Particles capped and tied to the accessibility setting |
| **Throttled React** | UI at 10Hz, not 60Hz |
| **Conditional health bars** | Only drawn when damaged or statused |
| **Culling** | Off-screen entities skip rendering (they still simulate — correctness first) |

### 14.3 Discipline

- **Profile on a real low-end Android device from M1 onward.** A perf problem found in M6 is an architecture problem; found in M1 it's a bug.
- A Playwright performance test runs a scripted worst-case wave in CI and **fails the build if mean frame time regresses more than 15%**.
- Chrome DevTools performance traces are captured per milestone and kept, so regressions have a baseline to compare against.

---

## 15. Testing

| Layer | Tool | What it covers |
|---|---|---|
| **Unit — maths** | Vitest | Damage formula across the armour/ward/status matrix, curves, RNG distribution, path sampling, spatial hash correctness |
| **Unit — systems** | Vitest | Each sim system in isolation against a synthetic world. *"Enemy with 3 Scorch and 1 Chill triggers Thermal Shock for exactly 76 damage."* |
| **Determinism** | Vitest | Same seed + same commands ⇒ byte-identical world hash after 10,000 ticks. **Runs on every PR.** |
| **Speed equivalence** | Vitest | A stage simulated at 1× and at 3× produces identical final state |
| **Integration** | Vitest | Full headless stage runs with scripted builds — asserts win/loss, lives, gold curve |
| **Content validation** | content-lint | Every JSON file, every cross-reference, every unlock chain |
| **Balance regression** | balance-sim | Win rates stay inside their authored band; fails the PR if not |
| **E2E smoke** | Playwright | Launch → menu → stage → build a tower → win. Chromium, Firefox, WebKit. |
| **Visual regression** | Playwright screenshots | Menus and HUD don't silently break |
| **Performance** | Playwright + trace | Worst-case wave frame timing |
| **Device matrix** | Manual, per milestone | Low/mid/high Android, iOS Safari, desktop browsers |

**Coverage targets:** `sim/` and `core/` at **≥85%** — that's where the game actually lives, and it's cheap to test because it's pure. `view/` and `ui/` are tested by E2E and screenshots, not by chasing a coverage number.

---

## 16. CI/CD

```yaml
on: [push, pull_request]

jobs:
  verify:
    - typecheck            # tsc --noEmit, strict
    - lint                 # ESLint incl. the layer-boundary rules
    - test:unit            # Vitest + coverage gate
    - test:determinism     # seed replay hash equality
    - content:lint         # cross-reference validation
    - build                # vite build, fails on bundle-size regression

  balance:                 # PRs touching content/data/** only
    - balance-sim over all stages, all difficulties
    - comment the win-rate delta table on the PR
    - fail if any stage moves > ±10%

  e2e:
    - Playwright across chromium/firefox/webkit
    - performance trace + regression gate

  deploy:                  # main only, after verify + e2e
    - build → GitHub Pages
    - tag + changelog on release
```

**Branching:** trunk-based on `main`, short-lived feature branches, PRs required. Conventional Commits, so the changelog generates itself.

**Bundle budget:** initial JS **≤ 500KB gzipped**. Stage assets load on demand, not upfront — the first playable frame is what the 15-second success criterion measures.

---

## 17. Android port

### 17.1 Packaging

```bash
npm run build
npx cap sync android
npx cap open android      # → Android Studio → signed AAB → Play Console
```

Capacitor plugins used: **Preferences** (save), **Haptics** (build/upgrade/damage feedback), **StatusBar** (immersive), **App** (lifecycle), **ScreenOrientation** (landscape lock), **SplashScreen**.

### 17.2 Mobile-specific work (this is the real content of the port, not the wrapper)

| Area | Requirement |
|---|---|
| **Touch targets** | 48dp minimum everywhere. The build menu becomes a radial arc — thumb-reachable, never a screen-edge trek. |
| **Gestures** | Tap = select/build · long-press = info + range preview · drag = rally flag and hero move · pinch = zoom · two-finger = pan. No gesture is *required*; each has a tap-based equivalent. |
| **Safe areas** | `env(safe-area-inset-*)` for notches, punch-holes and gesture bars |
| **Back button** | Intercepted: closes panel → pauses → confirms exit. **Never** drops out of the app mid-wave. |
| **Lifecycle** | `pause` → freeze sim, mute audio, write the session snapshot. `resume` → restore, show a "tap to continue" gate so the player isn't dropped straight into a wave. |
| **Battery/thermal** | Frame cap at 60. Pause rendering entirely when backgrounded. No busy loops. |
| **Orientation** | Landscape-locked (the HUD layout in GDD Part 3 §17.1 assumes it) |
| **Haptics** | Light on build, medium on tier-5, heavy on life lost. Fully disableable. |
| **WebView floor** | Android 7+ / Chrome WebView 80+. Detect and warn below that. |

### 17.3 Play Store checklist

Adaptive icon + feature graphic + 8 screenshots + a 30s trailer · store listing and short/long descriptions · privacy policy URL (required even with no data collection) · content rating questionnaire (targeting PEGI 7 / ESRB E10+) · target API level per current Play policy · signed AAB with a Play App Signing key · **internal testing track first**, then closed → open → production.

---

## 18. Coding standards

- **TypeScript strict**, `noUncheckedIndexedAccess`, no `any` outside declaration shims.
- **No magic numbers.** Balance → JSON. Technical constants → a named `const` in `core/constants.ts`.
- **Comments explain *why*, never *what*.** A comment restating the code is deleted in review.
- **Systems are functions over the world**, not classes with hidden state. `movementSystem(world)`, not `world.movement.update()`.
- **`sim/` never imports from `view/`, `ui/`, `audio/` or `platform/`.** Enforced by ESLint; a violation fails CI.
- `Math.random()` is **banned in `sim/`** by lint rule.
- Conventional Commits.
- **ADRs** (`docs/adr/NNNN-title.md`) for any decision that would be expensive to reverse — one per significant choice, written when it's made, not reconstructed later.

---

## 19. Risk register

| # | Risk | Sev | Mitigation | Trigger to act |
|---|---|---|---|---|
| T1 | **Pure-sim architecture costs more up-front code than a framework** | Med | Keep `core/` minimal and purpose-built. The payoff (balance sim, determinism, tests) is precisely what makes the design shippable. | If M0+M1 overrun by >50%, reconsider Phaser for the view layer only — `sim/` stays regardless |
| T2 | **Capacitor performance insufficient on low-end Android** | Med | Test on real hardware from M1. Particle LOD and entity caps as levers. | If a mid-range device can't hold 45fps at M3, evaluate a native runtime — `sim/` ports cleanly |
| T3 | **Reaction system is unreadable in dense waves** | High | Per-enemy reaction cooldown; VFX pooling with a hard cap; particle density setting; playtest in the **vertical slice**, before any content is built | If M1 playtesters can't explain what killed an enemy, simplify the matrix before building 16 towers on top of it |
| T4 | **Balance is intractable** | High | The balance simulator (§13.2) exists specifically for this, and lands in M3 — before the content wave | If pick-rate spread exceeds 4:1 at M3, redesign the outliers rather than nudging numbers |
| T5 | **Content authoring becomes the bottleneck** | Med | Map editor in M3, before Region 1 authoring starts | — |
| T6 | **Scope creep past Region 1** | High | Hard rule: v1.0 = Region 1. Regions 2-5 are milestone M7. | — |
| T7 | **Art becomes a blocking dependency** | Med | Placeholder-shape rendering through all of M1–M3. Art is a swap-in atlas, never a code dependency. | — |
| T8 | **PixiJS v8 API churn** | Low | Pin the version; wrap Pixi behind `view/` so an upgrade touches one layer | — |
| T9 | **Save corruption after a content update** | Med | Versioned saves with migrations from v1; Zod validation; corrupt saves fail loudly with a recovery path | — |

---

## 20. Milestones

| M | Name | Delivers | Exit criteria |
|---|---|---|---|
| **M0** | Foundations | Repo, tooling, CI, `core/`, content pipeline, Pixi + React shells | CI green on an empty game; the layer-boundary lint rule actually fails a bad import |
| **M1** | Vertical Slice | 1 map, 3 towers, 4 enemies, 8 waves, build/upgrade/sell, win/lose, placeholder art | **A stranger can play it and enjoy it.** Reactions are readable. A Capacitor build runs on a real phone. |
| **M2** | Core Systems | All 8 towers T1–T3, full status + reaction system, soldiers, Warden Powers, targeting modes, speed control, 18 enemy behaviours | Every GDD mechanic exists and is data-driven |
| **M3** | Content & Progression | 16 specialisations, hero, boss framework + Grendrix, **map editor**, **balance simulator**, Region 1's 10 stages, talents, save system, difficulty + challenge modes | Region 1 is fully playable start to finish, and its balance is measured rather than guessed |
| **M4** | Polish & Feel | Art pass, audio, VFX and juice, tutorial, UX pass, accessibility, i18n | Passes the GDD §15 juice checklist and the §18 accessibility table |
| **M5** | Web Launch | Performance pass, balance pass, PWA, GitHub Pages deploy, QA | 60fps budget met; all GDD §22 success criteria verified |
| **M6** | Android | Capacitor, touch UX, device matrix, Play Store | Live on the Play Store |
| **M7** | Post-Launch | Regions 2–5, more heroes, leaderboards, daily challenge, live balancing | — |

### Sequencing rationale

**M1 is the most important milestone in the project**, and it deliberately builds a *thin vertical slice* rather than a broad foundation. The GDD's central bet is the reaction system. M1 exists to answer one question — *is it fun, and is it readable?* — while it's still cheap to change the answer. Building 16 towers first and then discovering the reaction matrix is confusing would be the single most expensive mistake available.

The **map editor and balance simulator both land in M3, before Region 1's content authoring**, not after. Tools before the work they serve.

---

## 21. Next step

This plan is now broken out into individual tracked implementation issues, organised under the milestones above, with dependencies noted. No implementation code has been written yet — by design.

