# Aetherfall — Game Design Document

> **Status:** v1.0 draft, 2026-09-18 · **Tracked in:** [#1](https://github.com/satautiv/tower-defence/issues/1)
>
> This is the design source of truth. Every implementation issue refers back to it.
> The companion technical plan is [`TECH_DESIGN.md`](./TECH_DESIGN.md).
>
> **All numbers here are first-pass.** They exist so the systems are implementable and
> internally consistent, not because they are correct. Final values come out of the
> headless balance simulator plus playtesting, and every one of them lives in JSON.

## Contents

**Concept**
1. [Vision](#1-vision) · 2. [Setting & Fiction](#2-setting--fiction) · 3. [Core Loop](#3-core-loop)

**Mechanics**
4. [The Signature Mechanic: Aether Reactions](#4-the-signature-mechanic-aether-reactions) · 5. [Ley Lines](#5-second-mechanic-ley-lines) · 6. [Economy](#6-economy) · 7. [Defence Model](#7-defence-model-armour-ward-and-how-damage-resolves)

**Content**
8. [Towers](#8-towers) · 9. [Enemies](#9-enemies) · 10. [Bosses](#10-bosses) · 11. [The Hero](#11-the-hero-the-warden)

**Structure**
12. [Campaign Structure](#12-campaign-structure) · 13. [Replayability](#13-replayability) · 14. [Meta-Progression](#14-meta-progression)

**Presentation**
15. [Game Feel](#15-game-feel) · 16. [Art & Audio Direction](#16-art--audio-direction) · 17. [UX & UI](#17-ux--ui) · 18. [Accessibility](#18-accessibility)

**Production**
19. [Monetisation Stance](#19-monetisation-stance) · 20. [Scope](#20-scope-what-ships-when) · 21. [Risks](#21-risks) · 22. [Success Criteria](#22-success-criteria)

---

## 1. Vision

> **Working title: AETHERFALL**

A hand-crafted, fixed-path tower defence game where victory comes from **how your towers combine**, not from how many you can afford.

The genre's best games (Kingdom Rush, Bloons TD 6, Defender's Quest) all won on the same thing: every tower has a *job*, and the player feels clever when they work out the right combination for a wave. The genre's worst games are DPS calculators with art on top — you buy the strongest tower, you spam it, you win.

Aetherfall's answer is the **Aether Reaction system**: damage types leave *statuses* on enemies, and when two statuses meet on the same enemy they **detonate** into something far stronger than either. A Frost Cairn alone is a mediocre slow. A Frost Cairn next to a Flame Vent is a chain of Thermal Shock explosions that clears a lane. The tower isn't strong — the *pairing* is.

That single idea drives everything else: tower identity, enemy design, map layout, upgrade choices, and the reason to replay a stage a third time.

### 1.1 Design pillars

| # | Pillar | What it means in practice | What it forbids |
|---|---|---|---|
| **P1** | **Combinations over accumulation** | Two different towers next to each other beat two of the same tower. Power comes from interaction. | No single "best tower". No strategy that is "build 8 of X". |
| **P2** | **Readable depth** | A player can *see* why something died. Reaction VFX are distinct, statuses show as icons, damage numbers are colour-coded by type. | No hidden multipliers. No stat that only exists in a wiki. |
| **P3** | **Every second is a decision** | Early-call bonuses, active Warden Powers, hero repositioning, rally flags, mid-wave selling. You are never just watching. | No "build and idle" stages. No 3-minute waves with nothing to do. |
| **P4** | **Fair, then brutal** | Normal teaches. Veteran tests. Impossible demands mastery of P1. Losing always has a legible cause. | No stat-check walls. No unwinnable RNG. No damage you couldn't have seen coming. |
| **P5** | **Respects your time and your wallet** | Stages are 4–8 minutes. No energy timers, no forced ads, no paywalled difficulty. Progress is earned by playing well. | No grind loops. No pay-to-win. No dark patterns. |
| **P6** | **Touch-first, desktop-perfect** | Designed so a thumb can play it, but keyboard/mouse gets hotkeys and precision. Same build serves both. | No UI element smaller than 48dp. No hover-only information. |

### 1.2 What this is *not*

- Not an open-field maze builder (Bloons/Desktop TD style). Paths are authored, build plots are fixed. This is deliberate: it makes maps *designable*, keeps mobile performance predictable, and makes balance tractable.
- Not an idle/incremental game.
- Not a roguelite. The campaign is authored and repeatable, not randomly generated. (A roguelite mode is a plausible *post-launch* addition — see §17.)

---

## 2. Setting & Fiction

The **Aether** is the raw substance the world is made of. Centuries ago the Spire-wrights learned to tap it — and cracked the vessel. Now the Aether bleeds back through **Rifts**, and everything it touches comes back *wrong*: stone walks, the dead remember, light learns to hunt.

You are a **Riftwarden**. You don't have an army. You have the same broken science that caused this: you drive **Conduits** into the ground along the Rift's path, bind raw Aether into them, and let the flow do the killing.

**Why this setting earns its place (it is not decoration):**

| Fiction | Mechanic it justifies |
|---|---|
| Aether is a raw element that *reacts* | The entire Aether Reaction system, diegetically |
| Conduits tap the ground, not a supply line | Fixed build plots with no hand-waving |
| **Ley lines** are where Aether runs closest to the surface | Bonus build plots — a real spatial decision |
| The Rift bleeds charge as you kill its spawn | The Aether Charge resource for active abilities |
| Aether corrupts its own wielders | The late-game boss is a fallen Warden who uses *your* towers |

**Tone:** grim but not grimdark. Weird, physical, a little industrial. Brass and crystal against chitin and rot. Closer to *Bloodborne's* alchemy than to *Warcraft's* heroism — but readable and colourful, never muddy. No gore; this needs a PEGI 7 / ESRB E10+ rating for the Play Store.

**Naming note:** "Aetherfall" is a working title. It is thematically load-bearing but trademark-checkable alternatives (*Riftwarden*, *Leyfall*, *Conduit*) should be validated before store submission.

---

## 3. Core Loop

### 3.1 Moment-to-moment (seconds)
Read the incoming wave → pick the tower that counters it → place it where its range covers the most path → watch statuses land → spend Aether Charge when the reaction lines up → reposition the hero → adjust rally flags.

### 3.2 Per-stage (4–8 minutes)
```
 Stage start  →  Build phase (free, untimed)
      ↓
 [ Wave N spawns ]  ←──────────────────────┐
      ↓                                     │
 Kill enemies → earn gold + Aether Charge   │  ×12–20 waves
      ↓                                     │
 Build / upgrade / sell / cast powers ──────┘
      ↓
 Final wave cleared → Stage results → Stars awarded
```

- Waves are **player-triggered** via a "Call Wave" button, or auto-start after a timer. Calling early grants **bonus gold scaled to the seconds saved** — this is the game's core risk/reward tempo dial, and it's what separates a 1-star and a 3-star run.
- **Lives: 20.** A leaked enemy costs 1 (bosses cost 10). Lives never regenerate within a stage.
- Losing all lives = immediate restart offer, no penalty, no ad, no wait.

### 3.3 Per-session (20–40 minutes)
Clear 3–5 stages, or grind one stage on a harder mode for stars. Stars spend into the talent tree. There is always a next unlock within ~2 stages.

### 3.4 Meta (weeks)
Campaign → harder modes → challenge variants → endless leaderboards. Full 3-star completion of everything is a genuine long-tail goal (~40–60 hours).

---

## 4. The Signature Mechanic: Aether Reactions

**This is the most important section of this document.** Everything else serves it.

### 4.1 The rule

1. Towers deal one of **six damage types**.
2. Five of those types apply a **status** to the enemy they hit.
3. When **two specific statuses exist on the same enemy**, they immediately **react** — consuming the statuses and producing a powerful effect, usually in an **area**.
4. Reactions can chain: an area reaction applies statuses to neighbours, which can trigger *their* reactions.

That's it. One sentence a new player understands in the first 30 seconds, with a skill ceiling measured in hours.

### 4.2 Damage types & statuses

| Type | Colour | Applies | Status effect | Max stacks | Duration |
|---|---|---|---|---|---|
| **Kinetic** | steel grey | — | *(no status; reduced by Armour)* | — | — |
| **Pyro** | orange | **Scorch** | 6 dmg/s per stack | 5 | 4s (refreshing) |
| **Cryo** | pale blue | **Chill** | −12% move speed per stack | 5 | 3s |
| **Volt** | violet-white | **Charge** | +1 chain target per 2 stacks | 5 | 3s |
| **Toxic** | sickly green | **Corrode** | −8 Armour **and** −8 Ward per stack, 4 dmg/s | 5 | 5s |
| **Arcane** | magenta | **Unravel** | +8% damage taken per stack | 5 | 4s |

Two derived states:
- **Freeze** — reaching 5 stacks of Chill immobilises the enemy for **1.5s**, then Chill drops to 2. Bosses are Freeze-immune; they take a 25% slow cap instead.
- **Fracture** — a physical-only mark from Marksman towers: **+3% Kinetic damage taken per stack, max 10.** It is *not* an Aether status and does not react — it's the pure-physical build's own scaling lane, so Kinetic isn't left out of the fun.

### 4.3 The reaction matrix

| Status A | Status B | Reaction | Effect |
|---|---|---|---|
| Scorch | Chill | **⚡ Thermal Shock** | `40 + 12 × ScorchStacks` Arcane damage in a 1.5-tile burst. Consumes both. |
| Chill | Charge | **❄ Superconduct** | −60% Armour **and** Ward for 5s to everything in a 2-tile radius. Consumes both. |
| Charge | Corrode | **☇ Electrolysis** | Arc jumps to 4 nearby enemies for 25 damage each and applies 1 Corrode. Consumes both. |
| Scorch | Corrode | **☣ Combustion** | 80 damage over 3s to the target, plus a 1.5-tile ignition applying 2 Scorch to neighbours. Consumes both. |
| Unravel | *any other status* | **✦ Amplify** | Target status gains **+2 stacks** and **+50% duration**. Does **not** consume. 4s per-enemy cooldown. |
| Freeze | Kinetic hit ≥40 dmg | **✹ Shatter** | That hit deals **×2.5** damage and ends the Freeze. |

**Anti-spam rule:** each enemy has a **1.2s internal reaction cooldown** (Amplify: 4s). Without this, a Flame Vent + Frost Cairn pair would machine-gun Thermal Shocks and trivialise the game. With it, reactions are *punctuation*, not a damage stream.

**Reaction damage is Arcane**, so it ignores Armour but is reduced by Ward — which is what makes Warded enemies a genuine puzzle rather than a stat wall.

**Reaction scaling:** a global `reactionPower` multiplier (default 1.0) is raised by talents and by certain tier-5 towers. Reactions stay relevant into the endgame without needing per-reaction retuning.

### 4.4 Why this design works

- **It makes towers into verbs.** Frost Cairn is not "the slow tower", it's "the tower that sets up Thermal Shock and Superconduct". Its value changes depending on its neighbours.
- **It rewards spatial thinking without maze-building.** A Flame Vent and a Frost Cairn must have *overlapping coverage* on the same path segment. Placement matters even though plots are fixed.
- **It gives enemies meaningful counters.** A heavily Armoured Bulwark Golem laughs at Kinetic — until Superconduct strips 60% of its Armour and the Arbalest volley lands.
- **It creates upgrade tension.** Tier 4 asks: do you deepen this tower's own damage, or turn it into a better *enabler* for the tower next to it?
- **It is teachable.** The tutorial can hand the player exactly two towers and let them discover Thermal Shock by accident. That moment is the game's hook.

### 4.5 Readability requirements (non-negotiable)

Depth that the player can't see is just noise. Therefore:
- Each status has a **distinct icon shape as well as colour** — colourblind players read shape (see §16).
- Status icons render as a small row above the enemy health bar, with a stack count.
- Each reaction has a **unique VFX, a unique sound, and a named floating label** on first occurrence in a stage.
- The **Codex** records every reaction the player has triggered, with its full formula. No wiki required.
- A toggleable **damage number** stream, colour-coded by damage type.

---

## 5. Second Mechanic: Ley Lines

Threaded across each map are visible glowing seams — **ley lines**. A small number of build plots (typically **2–4 per map**) sit on a ley node.

A tower built on a ley node gains **one** of these, chosen by the plot (authored per map, shown on the plot before you build):

| Ley node type | Bonus |
|---|---|
| **Flux** | +25% attack speed |
| **Depth** | +20% range |
| **Resonance** | +1 status stack applied per hit |
| **Surge** | Reactions triggered by this tower deal +50% damage |

Ley nodes are a **pure placement decision** with zero extra UI complexity and zero extra systems — they reuse the existing tower stat pipeline. They also give level designers a precision tool for steering builds without hard-scripting them.

**Design intent:** a Resonance node under a Flame Vent turns it into a Scorch engine. A Surge node under a Frost Cairn makes every Thermal Shock hurt. The *same* node rewards different towers differently, so there's no single right answer.

---

## 6. Economy

Two resources, deliberately: one for **planning**, one for **reacting**.

### 6.1 Gold — the building resource
- Earned per kill (enemy `bounty`), plus a **wave-clear bonus**, plus the **early-call bonus**.
- Spent on building, upgrading, and re-specialising towers.
- **Resets every stage.** No cross-stage gold. This keeps every stage a self-contained puzzle and makes balance tractable.
- **Selling refunds 70%** — enough to make mid-stage pivots viable, cheap enough that they cost you.
- Starting gold is authored per stage (typical: 500–800).

**Early-call bonus:** `floor(secondsRemaining × 1.5)` gold, capped at the wave's own bounty total. Calling wave 12 the instant wave 11 dies is worth roughly a free tower upgrade — and may well kill you. This is the tempo dial and the primary reason speedrun-style play exists.

### 6.2 Aether Charge — the ability resource
- A bar, 0–100. Fills from: **+1 per kill**, **+4 per reaction triggered**, **+0.5/s passive**.
- Spent on **Warden Powers** (§6.3).
- Also resets per stage, and starts at 0.

**Why a second resource:** it decouples "I saved money" from "I can act now", and it explicitly rewards playing into the reaction system — the more you engage with P1, the more agency you get. A pure-DPS build genuinely has fewer buttons to press.

### 6.3 Warden Powers (active abilities)

The player equips **2 of 5** before a stage (a 3rd slot unlocks via talents).

| Power | Cost | Cooldown | Effect |
|---|---|---|---|
| **Riftfall** | 40 | 12s | Meteor at target point: 150 Pyro damage in 2.5 tiles, applies 3 Scorch. The generic "oh no" button. |
| **Stasis Field** | 35 | 20s | 3-tile zone, 4s: enemies inside move at 25% speed and gain 2 Chill/s. A reaction *setup* tool. |
| **Rally Banner** | 30 | 18s | All soldiers gain +100% HP and taunt everything within 4 tiles for 6s. Stall + reposition. |
| **Aether Siphon** | 50 | 25s | Detonate *all* statuses on all enemies in 4 tiles, forcing every valid reaction simultaneously, ignoring the reaction cooldown. The skill-expression power. |
| **Rift Seal** | 60 | 40s | Seal a path segment for 5s: ground enemies stop and pile up. The panic button, and a devastating combo enabler. |

Aether Siphon is intentionally the highest-ceiling ability in the game: used correctly on a stacked pack it can delete an entire wave, but it needs the player to have *built* the statuses first.

---

## 7. Defence Model: Armour, Ward, and how damage resolves

### 7.1 Formulas

```
effectiveArmour = max(0, armour − corrodeStacks×8 − armourPierce)
effectiveWard   = max(0, ward   − corrodeStacks×8)

kineticMult = 1 − effectiveArmour / (effectiveArmour + 50)      // 50 armour = 50% reduction
elementMult = 1 − effectiveWard   / (effectiveWard   + 50)

finalDamage = baseDamage
            × (kinetic ? kineticMult : elementMult)
            × (1 + 0.08 × unravelStacks)
            × (kinetic ? 1 + 0.03 × fractureStacks : 1)
            × reactionPower (reactions only)
            × superconductMod (0.4× armour/ward if active)
```

Diminishing-returns armour (rather than flat subtraction) is chosen so that **no enemy is ever fully immune to a damage type** — a heavily armoured enemy is a *bad target* for Kinetic, never an impossible one. That preserves P4 (fair, then brutal): the player is always making a value judgement, never hitting a wall.

- Armour is capped at **200** (80% reduction).
- Some towers deal **True damage** (ignores both) in small amounts — used sparingly, only on tier-5 abilities.

### 7.2 Enemy defensive traits

| Trait | Behaviour | Counter-play it creates |
|---|---|---|
| **Armour** | Reduces Kinetic | Use elements, or Corrode/Superconduct first |
| **Ward** | Reduces all five elements | Use Kinetic/Fracture stacking |
| **Overshield** | Flat absorb pool that regenerates after 5s out of combat | Burst it down; sustained chip damage fails |
| **Directional Armour** | 60 Armour from the front, 10 from behind | Towers placed *behind* the path do far more — a pure placement puzzle |
| **Evasion** | % chance to ignore a projectile entirely | Beams/auras/DoT never miss — hard-counters evasion |
| **Flying** | Ignores the ground path; flies straight to the Core | Needs dedicated anti-air coverage on a different axis |
| **Burrow** | Underground for a path segment, untargetable | Kill it before, or cover the exit |
| **Phase** | Teleports 2 tiles forward when it takes a hit over 100 damage | Punishes pure burst; rewards sustained chip |

Each trait exists to invalidate one dominant strategy. Together they force a *diverse* board, which is the whole point of P1.

**Units:** 1 tile = 64 logical px. Range is in tiles. Speed is tiles/second. DPS is sustained single-target unless noted.

---

## 8. Towers

### 8.1 Structure

- **8 base towers**, each in one of four families.
- Tiers **1 → 2 → 3** are straight power upgrades (same identity, bigger numbers, one new small perk at T3).
- At **Tier 4** the tower **branches into one of two specialisations** — a permanent, identity-changing choice made mid-stage. Re-specialising is possible but costs the full T4 price again (no refund), so it's a real commitment.
- **Tier 5** is the specialisation's capstone and unlocks a **per-stage active ability** on that tower.

**8 towers × 2 branches = 16 distinct endgame towers.** That is the proven Kingdom Rush shape, and it's the right one: it gives depth without demanding 40 unique towers' worth of art and balance.

**Cost curve** (multipliers on the tower's T1 cost):

| Tier | Multiplier | Cumulative |
|---|---|---|
| T1 | ×1.0 | 1.0 |
| T2 | ×1.6 | 2.6 |
| T3 | ×2.6 | 5.2 |
| T4 (spec) | ×4.5 | 9.7 |
| T5 | ×8.0 | 17.7 |

So a maxed tower costs ~17.7× a fresh one. On a 20-wave stage a strong player fields roughly **2 maxed + 4 mid-tier + 2 utility** towers. Selling refunds 70% of *total invested*.

### 8.2 Family: MARKSMAN — precision single-target, Kinetic

#### T1 — Arbalest Post · 80g
| Stat | Value |
|---|---|
| Damage | 12 Kinetic |
| Rate | 1.2/s → **14.4 DPS** |
| Range | 7.0 |
| Targets | Ground + Air |
| Perk (T3) | Applies 1 **Fracture** per hit |

The reliable baseline. Hits everything, counters Ward, never the *best* answer but never the wrong one.

**T4a — Sniper Nest** — Range 14.0, damage 110, rate 0.45/s (49.5 DPS), **ignores 50% Armour**, always targets the *strongest* enemy on screen regardless of range mode. Map-wide artillery for elites and bosses. Cannot hit air at T4; regains it at T5.
> *T5 ability — **Deadeye** (25 Aether): instantly executes any non-boss enemy below 20% HP anywhere on the map. Against bosses: 800 True damage.*

**T4b — Repeater Battery** — Damage 14, rate 4.0/s (56 DPS), range 6.5, applies **2 Fracture per hit** (to the cap of 10 = +30% Kinetic taken). Melts single high-HP targets and turbo-charges every other Kinetic tower on the board.
> *T5 ability — **Suppressing Fire** (20 Aether): 4s of double fire rate, and Fracture stacks applied during it don't decay.*

### 8.3 Family: ORDNANCE — area denial, Kinetic & Pyro

#### T1 — Mortar Emplacement · 120g
| Stat | Value |
|---|---|
| Damage | 45 Kinetic, 1.5-tile blast |
| Rate | 0.4/s → **18 DPS** (far more vs packs) |
| Range | 9.0, **minimum range 2.5** |
| Targets | **Ground only** |
| Perk (T3) | Blast applies a 1s 30% slow |

The min-range dead zone is deliberate: mortars must be placed *away* from the action, which competes with every short-range tower for the good plots.

**T4a — Siege Howitzer** — Damage 140, blast 2.2 tiles, rate 0.35/s. Blast **stuns ground enemies for 0.8s**. The crowd-control answer to ground swarms.
> *T5 ability — **Barrage** (30 Aether): 6 shells over 3s across the tower's whole range.*

**T4b — Firestorm Cannon** — Damage 90 **Pyro**, blast 2.0, rate 0.5/s, applies 3 Scorch and leaves a **burning pool** (12 Pyro/s, 4s, 2-tile radius). The single best Scorch source in the game and the backbone of every Combustion/Thermal Shock build.
> *T5 ability — **Immolation Field** (30 Aether): the next 4 shells leave permanent pools for 10s.*

#### T1 — Flame Vent · 100g
| Stat | Value |
|---|---|
| Damage | 8 Pyro per tick, 4 ticks/s |
| Shape | **Cone**, 3.5 range, 60° arc |
| Effective | ~32 DPS on one target, scales hard with pack size |
| Targets | Ground + Air |
| Status | 1 Scorch per tick (so it caps stacks fast) |
| Perk (T3) | **Never misses** — ignores Evasion |

**T4a — Pyroclast Vent** — 14/tick, arc 80°, range 4.0. **Scorch spreads**: an enemy dying with Scorch applies its remaining stacks to everything within 1.5 tiles. Deals **+60% damage to Corroded** targets. A wave-clearing engine when paired with the Alchemist.
> *T5 ability — **Eruption** (25 Aether): 250 Pyro in 3 tiles and applies 5 Scorch to everything hit.*

**T4b — Plasma Lance** — Converts to a **continuous piercing beam**: 55 **Arcane** damage/s, range 8.0, hits *every* enemy in a line, applies **Unravel** instead of Scorch. Turns a lane into an Amplify machine that supercharges every other tower's statuses.
> *T5 ability — **Overcharge Lance** (35 Aether): 6s of 150 Arcane/s, and Unravel stacks cap raised to 8.*

### 8.4 Family: ARCANE — elemental damage, ignores Armour, punished by Ward

#### T1 — Arcane Spire · 110g
| Stat | Value |
|---|---|
| Damage | 22 Arcane |
| Rate | 0.8/s → **17.6 DPS** |
| Range | 6.5 |
| Targets | Ground + Air |
| Status | 1 Unravel per hit |
| Perk (T3) | +1 Unravel on a target already Unravelled |

**T4a — Void Obelisk** — Damage 70 Arcane in a 2-tile pulse, rate 0.6/s, and **pulls enemies 0.4 tiles toward the tower**. The compression effect clusters enemies into every other tower's AoE and into reaction blast radii. A force multiplier disguised as a damage tower.
> *T5 ability — **Singularity** (35 Aether): 3s vortex that holds all non-boss ground enemies in 3 tiles in place and deals 60 Arcane/s.*

**T4b — Prism Tower** — Fires 3 beams at 3 separate targets, 40 Arcane each, rate 1.0/s. **Refraction:** for each *distinct damage type* dealt by towers within 3 tiles, Prism adds that type to its beams (up to 3). A Prism between a Flame Vent and a Frost Cairn fires Pyro+Cryo+Arcane beams — applying both halves of Thermal Shock *by itself*. This is the most "P1" tower in the game.
> *T5 ability — **Spectrum Burst** (30 Aether): 5s where every beam carries **all** absorbed types at full strength.*

#### T1 — Tesla Coil · 130g
| Stat | Value |
|---|---|
| Damage | 16 Volt, chains to 2 targets (−25% per jump) |
| Rate | 0.7/s |
| Range | 5.5 |
| Targets | Ground + Air |
| Status | 1 Charge per enemy hit |
| Perk (T3) | Chain range +1 tile |

**T4a — Storm Pylon** — 45 Volt, chains to 6, rate 0.8/s, range 6.5. Enemies at **5 Charge stacks are stunned 1s** and the stacks discharge in a 2-tile AoE applying 2 Charge to neighbours. Chain-stun-locks ground swarms and sets up Superconduct across a whole pack.
> *T5 ability — **Tempest** (30 Aether): 5s of continuous chain lightning across the entire range, 80 Volt/s.*

**T4b — Arc Net** — Places a **persistent electric field** on up to 3 tiles of path within range. Enemies inside take 35 Volt/s and gain 1 Charge/s, and move 20% slower. Zero targeting, zero miss, zero downtime — the reliable "this lane is handled" tower.
> *T5 ability — **Overload Grid** (25 Aether): fields deal triple damage and apply Charge 3×/s for 6s.*

### 8.5 Family: CONTROL & SUPPORT

#### T1 — Frost Cairn · 90g
| Stat | Value |
|---|---|
| Damage | 5 Cryo pulse, 1.0/s, hits all in range |
| Range | 4.5 (aura) |
| Targets | Ground + Air |
| Aura | Passive **−15% move speed** to everything in range |
| Status | 1 Chill per pulse |
| Perk (T3) | Aura slow → −22% |

Low damage by design. Its value is entirely in enabling Thermal Shock and Superconduct, and in buying time.

**T4a — Glacier Heart** — Pulse 25 Cryo, aura −30%, and every **6s emits a Freeze pulse** that applies 3 Chill instantly to everything in range (usually triggering Freeze on anything already Chilled). The hard-lock control tower.
> *T5 ability — **Absolute Zero** (35 Aether): Freezes every non-boss enemy in range for 4s; bosses take 400 Cryo and −50% speed.*

**T4b — Rime Spire** — Pulse 40 Cryo, range 6.0. Each Chill stack now also grants **−6 Armour**, and any Kinetic hit on a Chilled (not just Frozen) enemy gains a **Shatter bonus of +15% per stack**. Converts the Cryo package into an anti-Armour engine for Marksman/Ordnance builds.
> *T5 ability — **Permafrost** (25 Aether): Chill stacks stop decaying for 8s.*

#### T1 — Alchemist's Still · 100g
| Stat | Value |
|---|---|
| Damage | 18 Toxic, 1.2-tile splash |
| Rate | 0.6/s → **10.8 DPS** |
| Range | 6.0 |
| Targets | Ground only |
| Status | 2 Corrode per hit |
| Economy | **+2 gold** per enemy killed while Corroded |
| Perk (T3) | Splash 1.6 tiles |

**T4a — Plague Vat** — 45 Toxic, splash 2.0, Corrode 3/hit. **Contagion:** an enemy dying with Corrode passes its full stacks to everything within 2 tiles. In a dense wave this cascades and strips the entire pack's Armour and Ward.
> *T5 ability — **Virulence** (25 Aether): 8s where Corrode stacks cap at 10 and never decay.*

**T4b — Gilded Alembic** — Damage drops to 30, but grants **+6 gold per Corroded kill** and **+15% global gold gain** while it stands. The economy tower — a deliberate gamble: it wins you the late game if you survive the mid game.
> *T5 ability — **Transmutation** (20 Aether): the next 25 kills each grant +15 gold.*

#### T1 — Warden's Barracks · 100g
| Stat | Value |
|---|---|
| Soldiers | 3 × (120 HP, 8 Kinetic per 0.8s, 5 Armour) |
| Respawn | 12s per fallen soldier |
| Rally range | 8.0 from the tower |
| Blocks | Ground only — enemies **stop** to fight |
| Perk (T3) | Soldiers regen 4 HP/s out of combat |

Blocking is the most important non-damage mechanic in the genre. It holds enemies inside your damage zone, and it's how a player *buys time* when a wave goes wrong. The rally flag is draggable at any moment, including mid-wave.

**T4a — Bulwark Order** — 3 × (340 HP, 12 dmg, 25 Armour). **Shield Wall:** a 2s taunt on a 10s cooldown pulls nearby ground enemies onto them. Reflects 20% of melee damage taken.
> *T5 ability — **Last Stand** (30 Aether): soldiers become invulnerable and taunt everything for 5s.*

**T4b — Ranger Lodge** — 3 × (180 HP, ranged 20 Toxic per 1.0s at 4 tiles, applies 1 Corrode). They block, but prefer to fight at range, and **mark** their target (+10% damage taken from all sources). Mobile, flexible, softer.
> *T5 ability — **Volley** (20 Aether): all rangers fire a 5-arrow spread for 6s, applying 2 Corrode per arrow.*

### 8.6 Tower coverage audit

Every design constraint the enemy roster creates has at least two answers — never exactly one (that would be a stat check, violating P4):

| Threat | Answers |
|---|---|
| High Armour | Arcane Spire, Alchemist (Corrode), Superconduct, Sniper Nest pierce, Rime Spire |
| High Ward | Arbalest, Repeater (Fracture), Mortar, Siege Howitzer |
| Air | Arbalest, Flame Vent, Arcane Spire, Tesla, Frost Cairn |
| Swarms | Mortar, Pyroclast, Storm Pylon, Plague Vat, Void Obelisk |
| Single elite/boss | Sniper Nest, Repeater, Plasma Lance, Arc Net |
| Evasion | Flame Vent, Frost Cairn, Arc Net, all DoTs |
| Need to stall | Barracks, Frost Cairn, Rift Seal, Stasis Field, Void Obelisk |
| Economy | Alchemist, Gilded Alembic, early-call bonus |

---

## 9. Enemies

### 9.1 Baseline roster (Region 1 values)

| Enemy | HP | Spd | Arm | Ward | Bounty | Lives | Behaviour |
|---|---|---|---|---|---|---|---|
| **Riftling** | 45 | 1.6 | 0 | 0 | 4 | 1 | Fast fodder. Teaches "cover the path". |
| **Husk** | 90 | 1.0 | 5 | 0 | 6 | 1 | The reference enemy. All balance normalises to it. |
| **Spore Swarm** | 25 ×6 | 1.3 | 0 | 10 | 2 ea | 1 ea | Spawns as a pack of 6. Punishes single-target-only boards. |
| **Rift Bat** | 60 | 2.0 | 0 | 5 | 5 | 1 | **Flying**, erratic path. First air check. |
| **Ironclad Revenant** | 260 | 0.7 | 40 | 0 | 14 | 1 | Armour wall. Forces elements or Corrode. |
| **Aether Wisp** | 120 | 1.2 | 0 | 45 | 12 | 1 | **Flying**, high Ward. Forces Kinetic anti-air. |
| **Mender** | 140 | 0.9 | 10 | 20 | 16 | 1 | Heals 15 HP/s to the 2 most-damaged allies in 4 tiles. **Kill priority.** |
| **Sapper** | 110 | 1.4 | 0 | 0 | 15 | 1 | On reaching a tower's plot, **disables it for 8s**. Demands a player reaction. |
| **Shieldwright** | 180 | 0.8 | 15 | 15 | 18 | 1 | Grants a 120-pt **Overshield** to 3 allies, refreshing every 8s. |
| **Chitin Mother** | 320 | 0.8 | 15 | 15 | 20 | 2 | Dies → 2 **Broodlings** (90 HP) → each dies → 2 **Mites** (30 HP). |
| **Bulwark Golem** | 400 | 0.6 | **60 front / 10 rear** | 0 | 25 | 2 | Directional armour. Rewards towers placed behind the path. |
| **Burrower** | 200 | 1.1 | 20 | 0 | 16 | 1 | Untargetable for one authored path segment. Cover the exit. |
| **Phase Stalker** | 240 | 1.3 | 0 | 30 | 22 | 1 | Teleports 2 tiles forward on any hit >100. Punishes burst-only boards. |
| **Nullifier** | 300 | 0.9 | 20 | 40 | 28 | 2 | Aura: towers in 4 tiles fire **25% slower**. Escort-killer. |
| **Standard Bearer** | 220 | 1.0 | 25 | 10 | 20 | 1 | Aura: allies in 5 tiles move **+30%** faster and gain 15 Armour. |
| **Carrier** | 380 | 0.7 | 10 | 25 | 30 | 3 | **Flying**. Every 6s drops a Husk onto the ground path beneath it. |
| **Rift Sprout** | 260 | 0 | 30 | 30 | 25 | 0 | **Stationary**. Spawns 2 Riftlings every 4s until killed. Appears mid-map. |
| **Dread Wyrm** | 900 | 1.0 | 20 | 20 | 60 | 5 | **Flying** elite. Breath attack disables a tower for 4s. |

Later regions reuse these archetypes with **retextured, restatted variants** (`husk_swamp`, `husk_cinder`, …) rather than inventing 30 more behaviours. This is a deliberate content-efficiency decision: **behaviours are expensive, stat blocks are cheap.** ~18 behaviours × 5 regional variants reads as ~90 enemies to the player.

### 9.2 Wave scaling

```
hp     = baseHP     × regionMult × (1 + 0.075 × globalWaveIndex) × difficultyMult
bounty = baseBounty × regionMult^0.5 × difficultyMult^0.5
```

| Region | regionMult | | Difficulty | HP/Armour mult | Gold mult | Lives |
|---|---|---|---|---|---|---|
| 1 Emberfall Ridge | 1.0 | | **Normal** | 1.00 | 1.00 | 20 |
| 2 Sunken Reliquary | 1.9 | | **Veteran** | 1.35 | 0.85 | 15 |
| 3 Cindervault Deeps | 3.4 | | **Impossible** | 1.80 | 0.70 | 10 |
| 4 Shattered Spire | 5.8 | | | + extra enemies per wave | | |
| 5 The Rift Heart | 9.5 | | | + one extra elite wave | | |

Armour and Ward scale at **0.6×** the HP rate, so late-game enemies get *tankier* without making early-game damage types feel worthless.

### 9.3 Design rules for enemies

- **Every enemy must be readable at a glance** — silhouette first, colour second, icon third. A Mender must be obviously a Mender at 2× speed on a 5" phone screen.
- **No enemy is immune to a damage type.** Resistances only. (Exception: Freeze-immunity on bosses, which is explicitly iconed.)
- **Every enemy that changes the rules gets a telegraph**: Sappers flash before disabling, Phase Stalkers shimmer, Carriers show a drop marker.
- **Support enemies always outrank damage enemies in threat.** Menders, Nullifiers and Standard Bearers exist to make the player *aim* rather than spray.

---

## 10. Bosses

One per region (5), plus 2 elite mini-bosses per region. Boss rules:

- **Multi-phase**, with a visible phase marker on the health bar.
- **Freeze-immune, stun-immune**, slow capped at 25%, but **fully affected by Corrode, Unravel, Fracture and all reactions.** Bosses are where the reaction system gets to show off.
- Costs **10 lives** if leaked — a boss leak is effectively a loss.
- Every boss has **one mechanic the player must actively respond to**, not just out-DPS.

| Boss | Region | Mechanic |
|---|---|---|
| **Grendrix, the Rift Maw** | 1 | **Swallow** — devours a soldier every 12s (instant kill, heals 15%). Phase 2 at 50%: spits corrosive pools that disable plots. *Counter: Ranger Lodge fights at range; reposition rally flags.* |
| **The Hollow Chorus** | 2 | Three linked bodies sharing a damage pool. Killing one revives it in 8s **unless all three die within 5s of each other.** *Counter: even damage spread, then a burst finish — this is what Aether Siphon exists for.* |
| **Aurex the Sunderer** | 3 | Regenerates 3% max HP/s, **suppressed entirely while Corroded**. Phase 2: splits into two half-HP copies. *Counter: mandatory Toxic uptime.* |
| **The Loom** | 4 | **Stationary** at mid-map, continuously weaving new enemies. Doesn't attack — it out-produces you. A pure burst-DPS race against a spawn economy. |
| **Vareth, Warden Turned** | 5 | **Builds towers.** Plants corrupted copies of the player's own tower types on unused plots, which attack your soldiers and Core. *Counter: you must spend damage on destroying buildings while the wave continues.* |

Vareth is the intended thesis statement of the campaign: the final test is a mirror of the player's own system knowledge.

---

## 11. The Hero (the Warden)

Unlocked at **stage 1-5**, after fundamentals are taught.

A single deployable, **directly commandable** unit:
- Tap/click anywhere on a path to send them there. They auto-engage, block ground enemies (like a soldier but far stronger), and respawn at the Core after **25s** if killed.
- Auto-attacks with their own damage type.
- **3 abilities**, on their own cooldowns, independent of Aether Charge.
- **Levels 1→10** across the campaign via stage completion. Levelling grants stats and ability ranks.

**Why include a hero:** it converts the player from an architect into a participant. It's the single highest-impact feature for moment-to-moment engagement (P3), and it's also the cleanest place to hang future content (more heroes = more replay value with no new maps).

### Launch heroes

| Hero | Type | Auto-attack | Abilities |
|---|---|---|---|
| **Kaelen, Spire-Wright** *(default)* | Arcane | 35 Arcane, 1.0/s, range 3 | **Aether Bolt** (180 Arcane + 3 Unravel) · **Ward Break** (−50 Ward, 6s, 3-tile AoE) · **Conduit Surge** (all towers in 5 tiles: +40% fire rate, 8s) |
| **Vel the Ashbound** *(unlock: 3-star all of Region 1)* | Pyro | 28 Pyro cleave, 1.4/s | **Cinder Dash** (dash through a line, 4 Scorch) · **Pyre** (burning ground, 10s) · **Wildfire** (all Scorched enemies on the map instantly Combust) |
| **Sera Coldwater** *(unlock: complete Region 2)* | Cryo | 22 Cryo, 1.2/s, slows | **Frostbind** (root 2s + 3 Chill) · **Aegis** (shield self + nearby soldiers, 250 pts) · **Winter's Hold** (freeze everything in 4 tiles, 3s) |

Heroes are **not** stronger than towers — they are *flexible*. A hero plugs the hole your build didn't anticipate. Balance target: a max-level hero contributes roughly the damage of one tier-3 tower, plus the utility of a Barracks.

---

## 12. Campaign Structure

### 12.1 Shape

**5 regions × 10 stages = 50 stages** at full build-out.
Each region: **8 standard stages + 1 elite stage + 1 boss stage**.

| # | Region | Theme | Introduces |
|---|---|---|---|
| 1 | **Emberfall Ridge** | Grass, foothills, broken watchtowers | Fundamentals, the reaction system, the hero |
| 2 | **The Sunken Reliquary** | Drowned temple, swamp, bog | Water lanes (ground slowed, Volt amplified), Corrode theme, split paths |
| 3 | **Cindervault Deeps** | Volcanic caverns, forge-works | Lava channels that damage enemies, heat vents that buff Pyro towers, darkness (reduced tower range without a lit brazier) |
| 4 | **The Shattered Spire** | Floating islands, storm winds | Heavy air pressure, wind that curves projectiles, plots that crumble after N waves |
| 5 | **The Rift Heart** | Raw Aether, non-euclidean | Mid-map rift portals that spawn *behind* your defence, everything at once |

### 12.2 Difficulty curve

| Stages | Waves | Target clear time | Player is learning |
|---|---|---|---|
| 1-1 → 1-3 | 10–12 | 4 min | Placement, range, gold, the first reaction |
| 1-4 → 1-7 | 12–15 | 5 min | Damage types, Armour/Ward, air, the hero, upgrading vs expanding |
| 1-8 → 1-10 | 15–18 | 6 min | Specialisation choices, support-enemy priority, first boss |
| Region 2+ | 16–20 | 6–8 min | Multi-path attention, active ability timing, economy risk |

**Pacing rule:** every stage must introduce **exactly one new thing** — a new enemy, a new tower, a new terrain rule, or a new combination pressure. Never two. Never zero.

### 12.3 Map authoring rules

Each map is data (see technical plan) and must satisfy:
- **12–20 build plots**, of which **2–4 are ley nodes**.
- At least one plot that covers two path segments (a "premium" plot worth fighting for).
- At least one plot that is clearly bad for short range and good for Mortar/Sniper.
- **1–3 ground paths**, plus flyer lanes that do *not* trace the ground path.
- **One environmental interactable** per map — a one-shot, gold-cost lever: collapse a bridge (blocks a path for 20s), drop a boulder (150 damage in a line), ignite a gas vent (Scorch field). Cheap to build, huge for map identity.
- Enemies enter from 1–3 spawn points and target a single **Rift Gate** (the Core).

### 12.4 Stars & scoring

| Stars | Requirement |
|---|---|
| ★ | Complete the stage with ≥1 life |
| ★★ | Finish with ≥12 of 20 lives |
| ★★★ | Finish with **20/20 lives** |

Stars are awarded **per difficulty**, so a stage can yield up to 9 stars (3 modes × 3). Plus **2 challenge stars** (§13). **Max per stage: 11.** Region 1 alone therefore holds 110 stars — more than enough to fund the talent tree without demanding 50 maps.

---

## 13. Replayability

Rather than building 50 more maps, each map is reused in five distinct ways:

1. **Normal / Veteran / Impossible** — stat and resource scaling (see §9.2), plus extra elite waves on Impossible.
2. **Heroic Challenge** — a fixed-constraint puzzle per map, authored by hand. Examples: *"Only Cryo and Kinetic towers"*, *"You start with 4 towers already built and 0 gold"*, *"All enemies have 3× Ward"*. One clean solution, discoverable. 1 star.
3. **Iron Challenge** — *"Survive 15 waves with no rebuilding, no selling, and 1 life."* Brutal, optional, 1 star.
4. **Endless Mode** — unlocked at 3 stars. Infinite escalating waves, local + global leaderboard on wave reached.
5. **Speedrun timing** — every completion is timed; best times shown on the stage-select map. No reward, pure pride. Feeds the early-call tempo loop.

This is the highest-ROI content strategy available: challenge modes cost *data authoring*, not art or code.

---

## 14. Meta-Progression

### 14.1 The Warden Talent Tree

Stars are the currency. The tree is **fully respeccable at any time, for free** — pillar P5. Locking a player out of experimentation in a strategy game is a design failure.

Four branches, ~10 nodes each, each node 1–5 ranks:

| Branch | Theme | Sample nodes |
|---|---|---|
| **Conduction** | Reactions | *Resonant Bloom*: +10%/rank reaction damage · *Cascade*: reaction cooldown −0.1s/rank · *Overflow*: reactions refund 2 Aether/rank |
| **Foundry** | Towers | +2%/rank tower damage · −3%/rank build cost · +1%/rank range · *Salvage*: sell refund +4%/rank |
| **Command** | Hero & soldiers | Soldier HP +8%/rank · Hero respawn −2s/rank · Rally range +0.5/rank · Hero ability cooldown −4%/rank |
| **Dominion** | Economy & powers | Starting gold +40/rank · Aether regen +0.1/s/rank · Power cooldowns −5%/rank · **3rd Warden Power slot** (capstone, 30 stars) |

**Cap:** total talent contribution must not exceed roughly **+35% effective power**. Talents are a *smoothing* system for players who struggle, not a replacement for skill. A fully-talented player should find Impossible hard; a zero-talent player must still be able to 3-star Normal.

### 14.2 Unlocks

| Unlock | Gate |
|---|---|
| Towers 1–3 | Start |
| Tower 4 (Arcane Spire) | Clear 1-2 |
| Tower 5 (Tesla Coil) | Clear 1-4 |
| Hero system | Clear 1-5 |
| Towers 6–8 | Clear 1-6, 1-8, 1-10 |
| Warden Powers 2–5 | Progressive through Region 1 |
| Tier 4 specialisations | Clear 1-10 (region boss) |
| Heroes 2 & 3 | 3-star Region 1 / clear Region 2 |
| Endless | 3-star the stage |

**Design intent:** the player has *every core system* by the end of Region 1, and Region 2 onward is about mastery, not acquisition. Nothing important is gated behind 20 hours.

### 14.3 The Codex

An in-game encyclopedia, auto-populated by play: every tower (with full stats at each tier), every enemy encountered (with stats and traits revealed on first kill), and every **reaction** discovered with its exact formula. This is the anti-wiki feature, and it directly serves P2.

---

## 15. Game Feel

The mechanics above are the skeleton. This section is the difference between a competent game and a good one, and it should be treated as a hard requirement, not polish-if-time.

### 15.1 Juice checklist

| Moment | Feedback |
|---|---|
| Tower placed | Ground-slam dust ring, 2px screen punch, satisfying low thud, plot snap |
| Tower upgraded | Light sweeps up the tower, brief pillar of Aether, ascending chime |
| Tier-5 reached | Full-screen desaturate for 120ms, tower flashes gold, unique fanfare |
| Enemy hit | Sprite flash white 60ms, hit spark oriented to impact, small knockback on light units |
| Enemy killed (Pyro) | Burns to drifting ash |
| Enemy killed (Cryo/Frozen) | **Shatters** into ice shards |
| Enemy killed (Volt) | Skeleton X-ray flash, then collapse |
| Enemy killed (Toxic) | Dissolves into a green puddle that lingers 2s |
| **Reaction triggered** | Unique VFX + unique SFX + named label + 80ms hitstop on the first one each stage |
| Boss killed | 400ms hitstop, slow-motion to 0.25× for 1s, radial shockwave, screen flash, music sting |
| Life lost | Red vignette pulse, screen shake, low horn, lives counter shakes |
| Last life | Heartbeat layer enters the music, permanent red vignette edge |
| Wave cleared | Gold counter counts up with a ticking sound, next-wave panel slides in |
| Stage won | Confetti of Aether motes, stars stamp in one at a time with rising pitch |

### 15.2 Rules

- **Nothing pops in or out.** Everything scales, fades, or slides — 120–250ms, ease-out.
- **Screen shake is trauma-based** (accumulating, decaying), amplitude-capped, and **fully disableable** (§16).
- **Hitstop is reserved** for reactions, boss deaths, and tier-5 unlocks. Overused, it becomes mush.
- **Every player action makes a sound within 50ms.** Latency is the enemy of feel.

### 15.3 Speed control

**1× / 2× / 3×**, plus pause. Speed persists across stages. The simulation must be *frame-rate independent and identical* at all speeds — 3× runs 3 sim ticks per frame, it does not multiply delta time. (This is a correctness requirement on the engine, detailed in the technical plan.)

---

## 16. Art & Audio Direction

### 16.1 Visual

- **2D, hand-painted-feel sprites**, orthographic top-down at a slight 3/4 tilt (~25°) — enough to give towers presence without demanding true isometric assets.
- **Logical resolution 1920×1080**, scaled to fit; assets authored at 2× for high-DPI.
- **Palette discipline:** environments are desaturated and low-contrast; **only gameplay-relevant elements are saturated.** Enemies, projectiles, statuses and reactions own the bright colours. This is the single most important readability rule, and it's what lets a busy late-game screen stay legible.
- Damage-type colours (§4.2) are **reserved** — no environment art may use them at high saturation.
- Enemy design leads with **silhouette**: flyers are wide and thin, armoured units are wide and blocky, support units carry a tall distinctive standard, fast units lean forward.
- Towers must read at a glance at both T1 and T5, and **specialisations must be visually distinct from each other** — a Sniper Nest and a Repeater Battery should never be confused.

### 16.2 Audio

- **Adaptive music**: each region has a base track with 3 stacked layers that mix in by wave threat — exploration/build → combat → boss/last-life. Crossfades on bar boundaries, not instantly.
- **Damage types have signature sounds**: Pyro whooshes, Cryo has a glassy shimmer, Volt cracks, Toxic bubbles, Arcane hums.
- **Reactions each get a unique, louder stinger** — the player should learn to recognise a Thermal Shock without looking.
- **Ducking**: when a reaction or boss event fires, the music ducks 3dB for 300ms.
- **Voice**: minimal. Short Warden barks on build/upgrade/low-lives. Fully skippable, and cheap to localise because there are so few lines.
- Separate **Music / SFX / Voice** volume sliders, plus a master mute that survives app backgrounding (critical on mobile).

---

## 17. UX & UI

### 17.1 Layout (landscape, touch-first)

```
┌────────────────────────────────────────────────────────────┐
│ ♥20   ⛁ 640   [▮▮▮▮▯ Aether 72]        ⏸  1×2×3×   ⚙      │  top bar
├────────────────────────────────────────────────────────────┤
│                                                            │
│                    GAME WORLD                              │
│                                                            │
│                                             ┌───────────┐  │
│                                             │ Wave 7/15 │  │
│                                             │ 🗲 🗲 🛡 ✈  │  │  wave preview
│                                             │ [CALL +36]│  │  (early-call bonus)
│                                             └───────────┘  │
├────────────────────────────────────────────────────────────┤
│  [Riftfall 40] [Stasis 35]              🦸 Hero  ⟲ 12s     │  ability bar
└────────────────────────────────────────────────────────────┘
```

- **Build menu** is a radial/arc menu on the tapped plot — thumb-reachable, no travel to a screen edge, works identically with a mouse.
- **Range preview** shows on tower hover/long-press *and* while the build menu is open.
- **Selected tower panel** slides from the bottom: live DPS, damage type, status applied, targeting mode, upgrade preview (with a **before → after stat diff**), and sell value.
- **Targeting modes** per tower — First / Last / Strongest / Weakest / Closest — persisted per tower, and **remembered as a per-tower-type default** across stages (a small quality-of-life thing that players notice immediately).

### 17.2 Screen flow

```
Splash → Main Menu ─┬─ Campaign → Region map → Stage detail ─┬─ Normal/Veteran/Impossible
                    │      (stars, best time, challenges)    └─ Heroic/Iron/Endless
                    │                                              ↓
                    │                                        [ IN STAGE ]
                    │                                              ↓
                    │                                     Results (stars, stats, retry/next)
                    ├─ Talents (spend stars, free respec)
                    ├─ Codex (towers / enemies / reactions)
                    ├─ Heroes (select, view levels)
                    └─ Settings (audio, graphics, accessibility, language, save data)
```

### 17.3 Non-negotiable UX rules

- **Instant restart** from the pause menu and the defeat screen. One tap. No confirmation dialog, no loading screen over 500ms.
- **Pause is a real pause** — the player can inspect towers, read enemy stats, and plan while paused. Not a menu that hides the board.
- **Wave preview is always available**, showing composition and counts, so a loss is never a surprise.
- **Undo the last build** within 3 seconds for a full refund (misplacement on a touchscreen is common and infuriating).
- **No modal popup ever interrupts an active wave.**
- Progress is saved on **every** stage completion and talent change, and the game **auto-saves a mid-stage snapshot** on app background (essential on Android, where a phone call kills a 7-minute run).

---

## 18. Accessibility

Treated as a launch requirement, not a patch.

| Need | Provision |
|---|---|
| **Colour blindness** | Every status and damage type has a **distinct icon shape** as well as colour. A high-contrast mode raises enemy/background separation. Three palette presets (deuteranopia, protanopia, tritanopia). |
| **Motion sensitivity** | Toggles for screen shake, hitstop, particle density (High/Medium/Off), and background parallax. |
| **Low vision** | UI scale slider 80–150%. Minimum 16px body text at 100%. No information conveyed by colour alone. |
| **Motor** | Everything playable one-handed with a thumb. 48dp minimum touch targets. No double-tap or drag *required* (drag is always an optional accelerator). Full keyboard control on desktop with rebindable hotkeys. |
| **Cognitive / difficulty** | Normal mode is genuinely beatable by a casual player. A **Relaxed** modifier (30 lives, 1.5× gold, no star penalty on 1★/2★) is available on any stage with no shame and no lockout. |
| **Hearing** | No gameplay information is audio-only. Reactions, low-life warnings and Sapper attacks all have visual equivalents. |

---

## 19. Monetisation Stance

**Web: entirely free.** No ads, no accounts required.

**Android:**
- **Preferred: premium, one-time purchase (~€3.99)** with a generous free trial of Region 1. Clean, honest, and the right fit for a strategy audience that hates interruptions (P5).
- **Acceptable alternative:** free with a single non-consumable "Full Campaign" unlock, plus optional cosmetic tower skins.
- **Explicitly rejected:** energy/stamina timers, interstitial ads between waves, paid consumables that affect gameplay outcomes, loot boxes, timed events that demand daily play, any paid item that raises tower stats.

Nothing purchasable may affect balance. Ever.

---

## 20. Scope: what ships when

### v1.0 — Web launch
- ✅ Region 1: 10 stages, all 3 difficulties, Heroic + Iron challenges, Endless
- ✅ All 8 towers, all 16 specialisations, all tier-5 abilities
- ✅ Full reaction system, ley lines, both economies, all 5 Warden Powers
- ✅ 18 enemy behaviours, 1 boss (Grendrix), 2 elite mini-bosses
- ✅ Hero: Kaelen (+ Vel as the 3-star Region 1 reward)
- ✅ Talent tree, stars, codex, save system
- ✅ Tutorial, full audio, accessibility, English localisation
- ✅ PWA, offline-capable

**That is a complete, finishable, genuinely good game** — not a demo. Region 1 with 11 stars per stage is 20–30 hours of content.

### v1.1 — Android
Same content, packaged natively, touch-tuned, Play Store release.

### v1.2+ — Post-launch content
Region 2 → 3 → 4 → 5, one per update. Heroes 3–5. Global leaderboards. Daily challenge (seeded, shared by all players). Possibly a roguelite "Rift Run" mode reusing all existing content with random modifiers — very high value per unit of work.

---

## 21. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Reaction system is confusing in practice** | **High** | Tutorial teaches it in one authored moment; Codex records formulas; unique VFX/SFX per reaction; playtest this *first*, in the vertical slice, before building anything else. If it doesn't land there, it doesn't land. |
| **Balance is unsolvable by hand at 16 towers × 18 enemies × 3 difficulties** | **High** | Headless balance simulator from M3 onwards; all numbers in JSON; CI regression on win rates. This is why the technical plan puts the sim layer in pure, engine-free code. |
| Scope creep to 50 stages before shipping anything | High | Hard commitment: ship Region 1. Regions are content updates. |
| Mobile performance with 300 entities + particles | Medium | Explicit perf budget, pooling, atlas batching, particle LOD tied to the accessibility setting. Profile on a real low-end device from M1, not M6. |
| Art becomes the bottleneck | Medium | Build entirely on placeholder shapes through M3. Art is a swap-in layer, never a dependency. |
| Reaction VFX spam makes late waves unreadable | Medium | The 1.2s per-enemy reaction cooldown; particle density setting; VFX pooling with a hard cap. |
| Android port reveals architectural assumptions | Medium | Platform code isolated behind adapters from day one; test a Capacitor build during M1, not M6. |

---

## 22. Success Criteria

The game is good if, at launch:

1. A new player triggers their first reaction **inside the first 90 seconds** and understands what happened.
2. Two skilled players who both 3-star stage 1-8 did it with **meaningfully different boards**.
3. Median time from launching the app to being in a wave is **under 15 seconds**.
4. A stage loss produces *"I should have built X"*, never *"that was unfair"*.
5. It holds a stable **60fps on a 3-year-old mid-range Android phone** during the heaviest wave.
6. The player never has to open a browser tab to understand a mechanic.

