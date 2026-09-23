# M1 Playtest — Vertical Slice

> **Status:** superseded, kept for the record · **Tracked in:** [#19](https://github.com/satautiv/tower-defence/issues/19)
>
> **Run [`PLAYTEST-REGION1.md`](PLAYTEST-REGION1.md) instead.** This protocol was written
> against the vertical slice — three towers, six enemies, no reactions, no sound, no speed
> controls — and that game no longer exists. A tester handed the current build and this doc
> would be told half of what they are looking at is missing, and asked about a stage that has
> since been rebuilt twice.
>
> What is still worth reading here is the bottom half: **what the automated checks found on
> the slice**, and why "1-1 offers no resistance" was recorded rather than fixed. Those
> numbers are the baseline everything since is measured against.

---

## What this gate can and cannot answer

The M1 gate was written to answer one question: *is the Aether Reaction system fun and
readable?* It cannot answer that yet. **Reactions are [#22](https://github.com/satautiv/tower-defence/issues/22), in M2** — the slice has
three towers, six enemies and no reactions at all.

So this playtest covers the **fundamentals**: is the loop legible, does building feel
good, can a stranger finish stage 1-1 without being told how. Those are worth knowing
now and cheap to fix now.

**The reaction gate runs after #22**, against the same three-tower slice plus Thermal
Shock, and it keeps the original stopping rule: if playtesters cannot explain what
killed an enemy, simplify the matrix before building sixteen towers on top of it.
#21 and #22 have since landed, so that session is ready to run — its protocol is
[`PLAYTEST-REACTIONS.md`](PLAYTEST-REACTIONS.md).

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

Campaign → Emberfall Ridge → 1-1.

**Do not explain anything.** The single most valuable thing this session produces is
watching where someone gets stuck without help. Note the timestamp when they ask a
question; do not answer until the run is over.

### Controls

| Action | Touch / mouse | Keyboard |
|---|---|---|
| Select a plot or tower | Tap it | — |
| Build | Tap a tower in the arc | `1`–`3` with a plot selected |
| Upgrade selected tower | Button in the panel | `E` |
| Sell selected tower | Button in the panel | `Delete` |
| Undo last build (3s, full refund) | Button in the panel | `U` |
| Call the next wave early | Button, top right | `Space` |
| Dismiss | Tap elsewhere | `Escape` |
| Pan / zoom | Drag / pinch or wheel | — |

---

## What to watch for

Ranked by how expensive the answer is to act on later.

### 1. Does the board read?

- Can they tell which shapes are enemies and which are towers?
- Do they notice the range ring? Does it change how they place?
- Do they spot that two plots are a different colour (ley nodes), and do they ask why?
- Can they tell a flyer from a walker? **Anti-air is the first real decision the stage
  asks for** — if the difference is invisible, wave 5 is unfair rather than hard.

### 2. Do they understand what they are choosing?

- Do they read the tower cards, or build the first thing they can afford?
- Does the before-and-after on an upgrade change what they do?
- Do they ever sell? Do they ever undo?

### 3. Does the tempo work?

- Do they find the call-wave button? Do they use it more than once?
- Do they understand it paid them gold?
- Does the wait between waves feel like thinking time or dead time?

### 4. Failure

- If they lose a life, do they know **why**?
- If they lose the stage, can they say what they would do differently?
  *"I should have built X"* is the target; *"that was unfair"* is a failure
  (design pillar P4).

---

## Questions to ask afterwards

Open questions first, and stay quiet through the pauses.

1. *"Talk me through what you were trying to do."*
2. *"Was there a moment you didn't know what to do next?"*
3. *"What did the coloured rings mean?"*
4. *"Did you notice the button that starts the next wave early? What did you think it did?"*
5. *"If I asked you to play it again and do better, what would you change?"*
6. *"What did you expect to be able to do that you couldn't?"*

---

## What the automated checks already found

Run by `tests/sim/slice.test.ts`; these need no human.

| Check | Result |
|---|---|
| Plays start to finish, no crash | ✅ |
| Winnable by an unsophisticated board | ✅ five of five seeds |
| Lost by a player who builds nothing | ✅ |
| Identical outcome from the same seed | ✅ |
| Simulation budget (4 ms/tick) | ✅ **7 µs — 0.17% used** |
| No pool exhaustion or dropped commands | ✅ |

### The finding that matters

**Stage 1-1 offers no resistance.** A naive board — fill every plot with the most
expensive affordable tower, then upgrade — wins **3 stars, 20/20 lives, zero leaks, in
4:15**, on every seed.

Two numbers explain it:

- **Peak enemies alive at once: 8.** Fourteen towers against eight enemies.
- **Peak projectiles in flight: 1.** Things die before a second shot is needed.

The cheapest read is that the tutorial stage is doing its job and the difficulty curve
has not been authored yet ([#36](https://github.com/satautiv/tower-defence/issues/36)) — 1-1 is *supposed* to be gentle. But zero leaks
with no thought is past gentle, and it means this playtest cannot tell us anything about
whether the game is *satisfying*, only whether it is *legible*.

A secondary signal: the naive board builds almost entirely **Flame Vents**. At 100 gold
for a cone that hits everything in front of it, nothing else competes. Worth watching
whether human players converge on the same thing — a 1:14 pick rate is exactly what
design pillar P1 exists to prevent, and what the balance simulator ([#35](https://github.com/satautiv/tower-defence/issues/35)) is built to
measure.

**Neither is a blocker for M1.** Balance is [#50](https://github.com/satautiv/tower-defence/issues/50), content is [#36](https://github.com/satautiv/tower-defence/issues/36), and the towers that
would compete with the Flame Vent do not exist yet ([#23](https://github.com/satautiv/tower-defence/issues/23)). They are recorded here so
they are not rediscovered as surprises.

---

## What is not in the slice

So nobody reports these as bugs:

- **No reactions.** The signature mechanic is #22.
- **No sound.** #44.
- **No speed controls.** #28 — a run takes about 4–5 minutes at 1×.
- **No tutorial.** #45. Being un-taught is the point of this session.
- **Placeholder art.** Coloured shapes; real art is #42.
- **Ley nodes confer no bonus.** Marked on the board, inert until #30.
- **Only tier 1–3.** Specialisations are #32.

---

## Recording the session

For each tester, note:

- Where they hesitated, and for how long
- Every question asked, verbatim, with a timestamp
- Whether they finished, and their result
- One sentence: what surprised you about watching them

Three testers is enough to find the obvious problems. A fourth rarely changes the
conclusion.
