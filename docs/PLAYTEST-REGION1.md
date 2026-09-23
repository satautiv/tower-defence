# Region 1 Playtest

> **Status:** ready to run · **Tracked in:** [#19](https://github.com/satautiv/tower-defence/issues/19), [#36](https://github.com/satautiv/tower-defence/issues/36)
>
> The two human sessions that are now the only things standing between v1.0 content and done.

---

## Why this doc exists

[`PLAYTEST-M1.md`](PLAYTEST-M1.md) was written against the vertical slice: three towers, six
enemies, no reactions, no sound, no speed controls. **That game no longer exists.** A tester
handed the current build and that protocol would be told half of what they are looking at is
missing, and asked questions about a stage that has since been rebuilt. Run this instead.

[`PLAYTEST-REACTIONS.md`](PLAYTEST-REACTIONS.md) is still live and still correct — it answers
whether the Aether Reaction system reads, it was run twice, and it **passed**
([#62](https://github.com/satautiv/tower-defence/issues/62)). Nothing here re-asks that.

---

## What is left, and which session closes it

| Criterion | Issue | Session |
|---|---|---|
| Playtest with at least 3 people who have not seen the design | #19 | **A** |
| Playtested end to end by someone who hasn't seen the design | #36 | **A** |
| All 10 stages 1-starrable by a casual player | #36 | **A** |
| Two skilled players 3-star 1-8 with **meaningfully different boards** | #36 | **B** |
| Holds 60fps on a mid-range Android phone | #19, #20 | *neither — see below* |

Already answered, so nobody re-asks them:

- **Every tester triggers Thermal Shock and explains it in their own words** — #19's central
  criterion, met on #62 by three testers after the readability work in
  [`adr/0004-reaction-readability.md`](adr/0004-reaction-readability.md).
- **Every stage inside its target win-rate band**, and **3-starrable by a skilled player** —
  `npm run balance`, one CI job per stage.
- **Playable start to finish, no crash; determinism across the whole campaign** — the test
  suite, on every push.

**The phone is not a playtest.** 60fps on a mid-range Android device is a measurement, not an
opinion, and the steps are in [`adr/0003-android-packaging.md`](adr/0003-android-packaging.md)
(#20). It needs a physical handset and nobody else in the room.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

Campaign → Emberfall Ridge → pick a stage → pick a mode.

**Say nothing.** Not about reactions, not about which tower answers armour, not about the
Codex. Note the timestamp when a question is asked; do not answer until the run is over. The
one thing these sessions produce that nothing else can is the record of where somebody got
stuck with no one to ask.

**Do not open the dev overlay in front of a tester.** `~` puts frame times, pool counts and
cheats on screen; a tester who sees a "+1000 gold" button has been handed a different game.
It is a dev build only, so it cannot reach them by accident.

---

## What is in the build now

Everything below postdates `PLAYTEST-M1.md`, and a tester will meet all of it.

| | |
|---|---|
| **Towers** | All 8, tiers 1–3, plus tier 4 branches and tier 5 capstones |
| **Enemies** | 21, with eight behaviours — menders, shieldwrights, nullifiers, sappers, carriers, phase stalkers |
| **Bosses** | Grendrix at 1-10, two elites at 1-9, with phases and a boss bar |
| **Statuses and reactions** | The whole matrix, all five reactions, with their own shapes, colours and stingers |
| **Soldiers and the hero** | Barracks, rally flags, melee blocking; Kaelen from 1-5 |
| **Warden Powers** | Five, on the bar |
| **Map features** | Ley nodes, ground effects, one environmental interactable per map |
| **Campaign** | Ten stages, unlocks that follow what the player has cleared |
| **Progression** | Stars, best times, the forty-node Warden Talent tree, the region map |
| **Modes** | Relaxed, Normal, Veteran, Impossible, plus a Heroic, an Iron and an Endless per map |
| **The Codex** | Every tower, enemy, reaction, status and damage type, discovery-gated for enemies |
| **Saving** | Progress persists; a run survives being backgrounded |
| **Speed** | 1× / 2× / 3× |

**Sound needs a gesture.** Browsers refuse to start audio until the player taps something, so
the first tap on the board unlocks it. There is a **Sound on / off** toggle in the pause menu.

---

## What is *not* in, so nobody reports it as a bug

- **No tutorial.** [#45](https://github.com/satautiv/tower-defence/issues/45). Being un-taught is the point of Session A.
- **Placeholder art.** Coloured shapes. Real art is [#42](https://github.com/satautiv/tower-defence/issues/42), VFX polish is [#43](https://github.com/satautiv/tower-defence/issues/43).
- **Only reaction sound.** Stingers exist; adaptive music, damage-type sounds, UI sounds and
  voice are all [#44](https://github.com/satautiv/tower-defence/issues/44) proper.
- **Menus are unpolished**, [#46](https://github.com/satautiv/tower-defence/issues/46); accessibility is [#47](https://github.com/satautiv/tower-defence/issues/47); English only, [#48](https://github.com/satautiv/tower-defence/issues/48).
- **Region 1 only.** The second region is locked and is meant to be — [#58](https://github.com/satautiv/tower-defence/issues/58).

---

# Session A — a stranger plays the campaign

**Who:** three people who have not seen the design. Three is enough to find the obvious
problems; a fourth rarely changes the conclusion.

**What:** start at 1-1 on **Normal** and keep going for as long as they want to. Do not steer
them toward a stage, a mode or a tower. If they wander into the talent tree, the Codex or a
challenge mode, let them — where an unguided player goes is data.

**How long:** about an hour gets a careful player to 1-5 or 1-6. Two hours gets most of the
region. Stop when they want to stop, and note where that was.

## What to watch for

Ranked by how expensive the answer is to act on later.

### 1. Does one-new-thing-per-stage actually teach?

Every stage introduces exactly one thing (§12.2), and that is the spine of the region's
design. It is also the thing most likely to be true on paper and false in a chair.

- **1-2, Watchfire Bend — Arcane Spire against Ward.** Do they work out that their existing
  towers have stopped working, or do they just lose?
- **1-3, The Long Descent — air on its own lane.** The flyer lane does not trace the road.
  Do they notice before it costs them lives?
- **1-5, The Warden's Gate — the hero.** Do they move it, or does it stand where it spawned
  all stage?
- **1-6, Ironhold Crossing — the Barracks.** Do they find the rally flag? Blocking is the
  subtlest system in the game and the one with no on-screen explanation at all.
- **1-7, The Rusted March — the Alchemist's Still against armour.** Same question as 1-2,
  and the second time should be faster than the first. Is it?

### 2. Do they play the signature mechanic on purpose?

#62 established that a player can *see* a reaction and *explain* it. This asks something
harder: once they know, do they **build for it**?

- Do they ever place a tower because of what is already next to it?
- Do they say anything that means "these two work together"?
- The simulator's laziest scripted board triggers **one** reaction per run. A human who
  triggers dozens is playing a different and better game. Count roughly which they are.

### 3. Tempo and failure

- Do they use the speed controls? Do they call waves early? Do they understand it paid them?
- When they lose a life, do they know **why**?
- When they lose a stage, is it *"I should have built X"* or *"that was unfair"*? The second
  is a failure of design pillar P4, not of the player.
- **1-9 and 1-10 run long** — measured at 7 to 8.6 minutes against the 4-to-6 the design
  asks for. Does it feel long to them, or only on the clock?

### 4. Progression

- After the first clear, do they find the region map? The talent tree? Do they spend stars?
- Do they ever open the Codex unprompted, and does it answer what they went in for?
- Do they replay a stage for a better score, or only move forward?

## The criterion this session has to settle

> **All 10 stages are 1-starrable by a casual player.**

A casual player is the person in front of you, playing Normal, unaided. If they hit a stage
they cannot clear at all, that is the finding, and the stage number is the whole report.
Relaxed exists for exactly this — but if they *needed* it, say so.

## Questions to ask afterwards

Open questions first, and stay quiet through the pauses.

1. *"Talk me through what you were trying to do."*
2. *"Was there a moment you didn't know what to do next?"*
3. *"Which stage was hardest, and what was hard about it?"*
4. *"Did any two towers seem to work well together? What made you think so?"*
5. *"What were the coloured patches on some of the build spots?"*
6. *"If I asked you to play the whole thing again and do better, what would you change?"*
7. *"What did you expect to be able to do that you couldn't?"*

---

# Session B — two skilled players, stage 1-8

**Who:** two people who already know the game — the pair from Session A who got furthest is
fine, on a second visit. They may read anything they like. This is not a legibility test.

**What:** both 3-star **1-8, Emberfall Confluence** on Normal, separately, without seeing each
other's board.

**Why 1-8:** it is the last stage that hands the player a new tower (the Mortar), so it is the
first stage where the whole roster is in play and the map is not also teaching something.

## The criterion

> **Two skilled players 3-star stage 1-8 with meaningfully different boards.**
> — `GAME_DESIGN.md` success criterion #2

This is the one success criterion that the balance simulator structurally cannot answer. It
round-robins or buys by price; it has no taste. Whether *two humans who both want to win*
arrive at different answers is the question design pillar P1 exists to ask.

## How to record a board, and what "meaningfully different" means

**Record both boards.** A screenshot of the finished board plus the tower list is enough; the
dev overlay's replay recorder (`~` → record) captures the whole run if you want it exact.

Then compare, in this order — any **one** of these is a pass:

1. **Different tower composition.** Not the same six towers in different corners: a different
   set. Two boards that agree on every tower but one are the same board.
2. **Different specialisations on the same towers.** Both took Sniper Nests, one went Arbalest
   and one went Ranger Lodge, and both cleared. That is the tier-4 choice doing its job.
3. **Different answer to the same wave.** One blocked the elites with a garrison, one killed
   them at range. Same problem, different solution.

And the failure to write down if you see it:

> **Both players build almost entirely the same thing.** The known risk is the Flame Vent —
> at the M1 gate a naive board was 14 Flame Vents to 1 of anything else, and three of the
> eight single-tower boards can still clear 1-1 alone. If both humans converge, say so
> plainly and point [#50](https://github.com/satautiv/tower-defence/issues/50) at it. A 1:14 pick rate is exactly what P1 exists to prevent,
> and it is cheaper to know now than after the art is made.

---

## What the simulator already knows

So no human is asked a question a machine has answered. All from `npm run balance`.

| | |
|---|---|
| `balanced` clears all ten stages | **100%** |
| Median lives left, 1-1 → 1-10 | 20 · 20 · 14 · 7 · 17 · 5 · 10 · 5 · 1 · 3 |
| Clear times | 4.1 – 8.6 min, against §12.2's 4-to-6 |
| `greedy` — buys the dearest affordable tower | wins **0%** from 1-2 onward |
| `rush` — calls every wave early | loses every run, deliberately |
| Single-tower boards that still clear 1-1 alone | **3 of 8** — Flame Vent, Frost Cairn, Arcane Spire |

The last row is the open one. Pillar P1 wants it at zero, and it belongs to #50.

---

## Recording a session

For each tester, note:

- Where they hesitated, and for how long
- Every question asked, **verbatim**, with a timestamp
- Which stages they cleared, on which mode, and with how many lives left
- The stage they stopped at, and whether they stopped because they were stuck or done
- One sentence: what surprised you about watching them

Write the result onto the issue it closes — Session A onto #19 and #36, Session B onto #36 —
rather than into this file. This file is the protocol; the issues are the record.

## The stopping rule

If Session A finds a stage a willing player simply cannot clear, **fix the stage before
running Session B**. Balance is [#50](https://github.com/satautiv/tower-defence/issues/50) and content is #36; a second session run against a
board that is known to be broken measures the break rather than the design.
