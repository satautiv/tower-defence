# Reaction Gate Playtest

> **Status:** ready to run · **Tracked in:** [#62](https://github.com/satautiv/tower-defence/issues/62)
>
> The question [#19](https://github.com/satautiv/tower-defence/issues/19) was written to answer, run where it can finally be answered.

---

## The question

> **Is the Aether Reaction system fun, and can a player see it happening?**

This is the central bet of the design (`GAME_DESIGN.md` §4). Tower identity, enemy
counter-play, map layout and upgrade tension all hang off it. It is answered **now**, on a
three-tower slice, while changing the answer is still cheap — not after sixteen towers have
been built on top of it.

`PLAYTEST-M1.md` covered the fundamentals: is the loop legible, does building feel good,
can a stranger finish 1-1 unaided. Run that first if you have not. This one covers the
mechanic itself.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

Campaign → Emberfall Ridge → 1-1. Same stage, same three towers, same six enemies.

**Say nothing.** Not about reactions, not about fire and ice, not about which tower does
what. The entire value of this session is watching whether someone discovers the mechanic
without being pointed at it. If you name it, you have tested your explanation rather than
the design.

### What is new since the M1 session

| | |
|---|---|
| **Statuses** | Scorch burns, Chill slows and freezes at 5 stacks, Corrode eats armour |
| **Reactions** | All five in the matrix, though only **Thermal Shock** is reachable with these three towers |
| **Reaction visuals** | A distinct shape and colour per reaction, drawn at the blast's real radius |
| **Reaction labels** | The name floats up the first time each reaction happens in a stage |

**Not yet in:** sound. Audio is [#44](https://github.com/satautiv/tower-defence/issues/44) and Howler is not installed. If the session turns on
whether a reaction is noticeable, weigh that: one of the two channels the design calls for
is missing, and the visual is carrying the whole load.

---

## The setup that produces a reaction

You do not tell them this. You need to know it so you can tell whether it happened.

- **Flame Vent** applies **Scorch** (Pyro, a cone, 4 shots a second)
- **Frost Cairn** applies **Chill** (Cryo, an aura, once a second)
- Scorch + Chill on the same enemy → **Thermal Shock**: `40 + 12 × Scorch stacks` Arcane
  damage in a 1.5-tile burst, consuming both

So a reaction needs **both towers covering the same stretch of path**. One of each in
different corners produces nothing at all. That is the spatial play §4.4 is asking for,
and whether a stranger finds it is exactly what this session is measuring.

Two things worth knowing while you watch:

- **A single Frost Cairn cannot freeze.** It applies one Chill a second against a
  three-second duration, so it plateaus at three stacks. Freezing takes two with
  overlapping coverage. If a tester expects a freeze and does not get one, that is the
  reason — note it, do not explain it.
- **There is a 1.2-second lockout per enemy.** Reactions are punctuation, not a stream.
  If they say it felt like it "only sometimes worked", this is why, and whether that reads
  as rhythm or as unreliability is a real finding.

---

## What the automated measurements already found

Run on stage 1-1 across three seeds, with a scripted player rather than a person.

**The finding that should shape this session:** a board built by always taking the most
expensive affordable tower ends up **entirely Flame Vents** and triggers **zero reactions**
— on every seed, while still winning three stars with no leaks. One damage type cannot
react with itself.

A board that alternates towers instead triggers **82** reactions, deals **25% more damage**
(10,489 against 8,384) and clears 22 ticks sooner.

So the mechanic works and it pays. But **the lazy line on the opening stage ignores it
completely**, and a tester can finish 1-1 three-starred without ever seeing the thing the
whole game is built around.

This matters for how you read the session. If a tester never mixes towers and never
triggers a reaction, that is **not** a failure of the reaction system — it is stage 1-1
failing to create a reason to mix, which is [#36](https://github.com/satautiv/tower-defence/issues/36) and [#23](https://github.com/satautiv/tower-defence/issues/23) and [#50](https://github.com/satautiv/tower-defence/issues/50). Record it as such, and then
**give them a second run** with one instruction only: *"this time use at least two different
towers."* The gate's real question is about what happens once a reaction fires, and you
cannot answer it from a run where none did.

Other measurements, for context:

| | |
|---|---|
| Worst case (300 enemies, every status at max, packed) | 0.353 ms/tick for the whole pipeline, against a 4 ms budget |
| Peak reactions in one tick | 232, bounded by one per enemy per tick |
| Chains | Terminate — 40 packed enemies produce 40 reactions on the first tick and none after |

---

## What to watch for

### 1. Do they ever build two different towers?

Note it without prompting. If they do, note **why** they said they did afterwards — "I
wanted to slow them down" is a different answer from "I wondered what would happen".

### 2. Do they notice the reaction at all?

The burst is a pale ring with spokes, drawn at the true blast radius, and the words
"Thermal Shock" float up the first time. Watch their eyes, not the screen. Do they look at
it? Do they say anything? Does their next action change?

### 3. Can they say what caused it?

Not the formula. The gate is whether they arrive at *"putting the fire tower and the ice
tower together did something bigger than either"*. Anything in that neighbourhood counts.
"I don't know, something exploded" does not.

### 4. Do they do it again on purpose?

The single strongest signal in this session. Building a second pair, or deliberately
placing a new tower to overlap an existing one, means the mechanic has taught itself.

### 5. Does it stay readable in a dense wave?

Waves 8–10 are the test. A reaction that reads beautifully against two enemies and
vanishes into a crowd of twenty has failed the requirement that matters, because the
crowd is where the game lives.

---

## What to write down, and when

Two kinds of evidence, kept apart. Mixing them into one narrative is how a confident
answer covers for a board that contradicts it.

**During the run — behaviour, and only what they volunteer.** What they build and in what
order, where they hesitate and for how long, whether their next action changes after a
burst. Write down anything they say **unprompted**, verbatim; that is the most valuable
material the session produces, because you did not cue it. Ask nothing.

**After the run — their answers, verbatim.** This matters more than it sounds. The second
acceptance criterion is *literally* about their words: "can explain in their own words what
happened". No amount of watching answers it. The gate turns on whether something like
*"the fire one and the ice one together did something bigger"* actually comes out of their
mouth, and a paraphrase destroys the one piece of evidence that decides it. "They seemed to
get it" is not a finding.

**When the two disagree, behaviour wins.** What someone does is evidence; what they say
about why is a hypothesis about themselves. A tester who says they understood but never
built a second overlapping pair has told you less than their hands did. Criteria 1, 3 and 4
are behavioural and only 2 is verbal, so keep them in separate fields.

You cannot write verbatim while watching. Either record audio with their permission, or
jot keywords and reconstruct within minutes of the run — not after the third session.

---

## Questions to ask afterwards

In this order. Do not reorder them — each one gives away a little more, so an earlier
answer is worth more than a later one.

1. *"Talk me through what you built and why."*
2. *"Did anything unexpected happen at any point?"*
3. *"Did anything unexpected happen when you had both towers covering the same spot?"*
4. *"What do you think caused that?"*
5. *"Could you make it happen again?"* — then **hand them the mouse** and watch.
6. *"When there were a lot of enemies on screen, could you still tell what was going on?"*

---

## Acceptance criteria

From [#62](https://github.com/satautiv/tower-defence/issues/62). All of them, across at least three people who have not seen the
design:

- [ ] Every one of them triggers Thermal Shock
- [ ] Every one of them can explain in their own words what happened
- [ ] At least one of them does it again on purpose
- [ ] It stays readable in a dense wave, not just in isolation

---

## If it fails

**Stop.** Do not build the remaining towers, the remaining reactions, or any content on an
unproven core. In order of preference:

1. **Raise the VFX and audio distinctiveness.** Cheapest, and the most likely cause —
   especially while there is no sound at all. Ship [#44](https://github.com/satautiv/tower-defence/issues/44) and revisit before touching the
   design.
2. **Reduce the number of reactions.** Five pairs may be more than the player can hold.
   Three would still carry the design.
3. **Reconsider the mechanic.** Only after the first two.

If it fails specifically because nobody mixed towers, that is a **content** failure, not a
mechanic one, and the fix is in [#36](https://github.com/satautiv/tower-defence/issues/36)/[#23](https://github.com/satautiv/tower-defence/issues/23)/[#50](https://github.com/satautiv/tower-defence/issues/50) — see above.

---

## Recording the session

Three places, in this order — the same shape #19's session took.

1. **One comment on [#62](https://github.com/satautiv/tower-defence/issues/62) per tester**, written straight after their run rather than
   saved up. Raw notes, not conclusions.
2. **One final comment** with the verdict against the four acceptance criteria, and what
   happens next. This is the gate decision, and it belongs beside the evidence for it.
3. **The durable conclusion into `CLAUDE.md`**, if there is one — a finding that should
   change how later work is done, the way #19's Flame Vent pick rate did. Raw session
   notes do not go there; they are evidence for one decision, not reference material.

**This repository is public.** Testers are "Tester 1/2/3" — no names, no handles, no
workplace, nothing that identifies them. Quote what they said about the game, not about
themselves.

Per-tester template:

```
Tester N — [how much tower defence they have played]

Towers built, in order:
First reaction at:            [wave, or "never"]
Reaction noticed:             [yes / no / unclear]
Explanation, verbatim:        ""
Repeated on purpose:          [yes / no]
Readable in a dense wave:     [yes / no / partly]
Where they hesitated:         [timestamps]
Anything they said unprompted:
```

Verbatim quotes are worth more than summaries. "It's like a combo" is a design decision;
"they seemed to like it" is not.
