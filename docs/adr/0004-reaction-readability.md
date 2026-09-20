# ADR-0004 — Reaction readability, and placeholder audio without Howler

**Status:** Accepted · **Date:** 2026-09-20 · **Issue:** [#62](https://github.com/satautiv/tower-defence/issues/62)

## Context

The first run of the reaction gate ([#62](https://github.com/satautiv/tower-defence/issues/62)) failed. Of its four criteria only one passed
cleanly. The result that matters was not the one the criteria were shaped around:

> "I asked to play second time, he triggered thermo shock, but didn't notice"

A tester triggered the game's signature mechanic and did not register that anything had
happened. He was watching his towers and his gold, not one enemy among eight. Every
channel the game had at that point was visual — a 24-frame expanding ring, and a name
that appeared once per stage — and none of them reached someone whose eyes were
elsewhere.

That is risk **T3** in `TECH_DESIGN.md` §15 landing exactly where it was predicted to:
*"reaction system is unreadable in dense waves"*. The two testers who did read it were
both experienced tower-defence players, which is to say the people already primed to go
looking for a combo system. `GAME_DESIGN.md` §4.4 claims the mechanic teaches itself by
accident; on this evidence it teaches itself to people who expect it.

#62's own failure plan is explicit about the order of remedies: **raise the VFX and audio
distinctiveness first**, then reduce the matrix, and only then reconsider the mechanic.

## Decision

### 1. Fix readability before re-running the gate, and nothing else

The session produced a long list of real UI complaints — unlabelled HUD counters, towers
with no names, a flaky quit button. **None of them would have changed a single gate
criterion.** Testers are the scarce resource: each person can be surprised exactly once,
so a re-run that changes things which were not the cause burns three more people and
returns the same answer. The UI work is queued behind the gate, not bundled into it.

### 2. Show the reaction's name more than once

Showing it once per stage was wrong. It is correct for a player who already knows the
mechanic and useless for teaching one who does not — and if that player happens to be
looking elsewhere for the single occurrence, there is never another. The first three of
each reaction now announce themselves. Beyond that the name becomes wallpaper and stops
being read at all.

### 3. Add the damage as a floating number

The most direct answer there is to *"what just killed that?"* — the question §4.5 says a
player must be able to answer without a wiki. A name says a reaction happened; a number
says it was worth caring about. Reactions that deal no damage show none, because a
floating zero would state something false.

### 4. Build the audio channel, and do it without Howler

This is the decision most likely to be questioned later, so it is the reason for this ADR.

Sound is the only channel that does not require the player to be looking at the right
pixel, which makes it the direct answer to how this session was lost. `CLAUDE.md` says
Howler arrives with #44 and that no dependency should precede the issue that needs it.

We built the reaction stingers on the **Web Audio API the browser already ships**, and
did not install Howler.

- The gate needs one bullet of #44 — *"a unique, louder stinger per reaction"* — not the
  mixer, the adaptive music, the audio sprites or the voice barks.
- Five short synthesised stingers need an oscillator, a gain node and a noise buffer.
  Howler's value is sprite management, format fallback and a mixer, none of which this
  slice uses.
- It adds nothing to the dependency list or the bundle, so #44 remains free to bring
  Howler on its own terms when it brings the things Howler is actually for.

The sounds are **synthesised placeholders**, the same bargain `art:placeholder` makes for
sprites: the design needs the channel to exist long before anyone records anything. They
are built to be told apart with eyes shut — differing in sweep direction, waveform,
length and noise content at once, not in pitch alone, because a set of sounds
distinguished only by pitch is a set most people cannot distinguish.

Two constraints are honoured now rather than deferred, because both are invisible until
they bite:

- **Rate limiting.** #44 names it: forty enemies dying in one Thermal Shock must not
  produce forty sounds. A chain can resolve dozens of reactions in a handful of ticks,
  and played unthrottled that is not punctuation, it is a wall of noise carrying no
  information. There is a per-sound minimum interval and a global concurrency cap.
- **Determinism.** The pitch variation on repeated sounds comes from a counter, and the
  noise buffer from a seeded generator, never `Math.random`. A replay whose audio
  diverged would be a replay nobody trusts.

## Consequences

**The gate can be re-run honestly.** Before this, calling the mechanic unreadable would
have meant condemning it while half the readability budget §4.5 specifies was unspent.

**#44 is partially done, and says so.** `src/audio/` exists with the reaction stingers,
a rate limiter and the autoplay unlock. Adaptive music, damage-type sounds, UI sounds,
voice and the separate volume sliders remain open. The issue is not closed.

**Howler may still be the right answer** for what remains. Nothing here forecloses it; the
`AudioDirector` is the seam it would slot behind.

**Audio needs a gesture.** Browsers refuse to start audio outside a user interaction, so
the first tap on the board unlocks it and everything before that is silent. A context
created earlier would be born suspended and stay that way, which presents as a game with
no sound and no error anywhere — the failure mode worth naming, since it is invisible.

**A browser that refuses audio does not take the game down.** The director gives up once,
quietly, and the game runs silent.
