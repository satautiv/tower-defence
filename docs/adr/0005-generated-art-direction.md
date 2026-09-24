# ADR-0005 — Flat generated art, and the one clause of §16.1 it replaces

**Status:** Accepted · **Date:** 2026-09-24 · **Issues:** [#42](https://github.com/satautiv/tower-defence/issues/42), [#43](https://github.com/satautiv/tower-defence/issues/43)

## Context

`GAME_DESIGN.md` §16.1 opens with **"2D, hand-painted-feel sprites"**. Everything else in
that section — the palette discipline, the reserved damage-type hues, silhouette-led enemy
design, the ~25° tilt, authoring at 2× — is a *rule about readability*. That first clause is
the only one that is a rule about **technique**, and it is the only one nobody on this project
can execute: the repo owner does not draw, and the agent doing the work cannot paint.

So the decision was never "which art style is best". It was: which of the four available
routes to ~130 sprites do we take, knowing that no one involved can produce a painted image?

The scope, measured rather than guessed:

| | |
|---|---|
| Towers | **56** — 8 towers × 7 rungs (three tiers, then two specialisations × tier 4 and tier 5) |
| Enemies | **23**, boss phases included — all 23 exist as placeholders today |
| Projectiles, plots, soldier, hero, rally flag | ~12 |
| Region 1 terrain and props | no tileset exists; terrain is drawn procedurally and baked by `TerrainCache` |
| Status and reaction icons | ~10, required by [#47](https://github.com/satautiv/tower-defence/issues/47) to differ by **shape** and not only hue |

And the fact that makes the whole thing tractable: **nothing animates.** There is no
`AnimatedSprite` anywhere in `src/view/`, no walk cycle, no frame sheet. 130 still images is a
bounded job; 130 animated ones would not be.

## Decision

**Region 1 ships flat, geometric, generated art.** Sprites are produced by code and by
hand-authored SVG that live in the repo as *source*, extending
`tools/placeholder-art/` rather than replacing it with a folder of binaries.

**§16.1's "hand-painted-feel" clause is struck. Every other rule in §16.1 stands unchanged** —
and that is the point of writing this down. Desaturated environments, saturated gameplay
elements, reserved damage-type hues, silhouette-led enemies (flyers wide and thin, armoured
blocky, support tall with a standard, fast units leaning forward), the ~25° tilt, towers that
read at T1 and T5, specialisations that cannot be mistaken for each other: all of those are
*more* achievable in this direction, not less. The acceptance criteria on #42 do not move.

### Why this rather than the alternatives

1. **The project already took this exact bargain for audio.** The reaction stingers are
   synthesised, not sampled (ADR-0004), because a sampled library was a dependency nobody
   wanted to own. Generated art is the same trade in the same shape: a generator is source
   that regenerates, reviews as a diff, and cannot rot the way an undocumented binary can.
2. **The palette already carries meaning, and painted art fights it.** `src/view/palette.ts`
   reserves nine hues at 40° of clearance and holds a rule that a reaction must be
   distinguishable from every damage type *and* every status, enforced by
   `tests/view/palette.test.ts`. Texture and painted shading add noise to exactly the channel
   the game's signature mechanic is read through. #62 already failed once on that channel.
3. **"Identifiable by silhouette alone at 2× speed on a 5-inch phone"** is a flat-shape
   criterion. It is easier to *pass* with bold geometry than with rendered detail, which is
   what a phone's pixel budget discards first.
4. **300 enemies and 400 projectiles on a mid-range Android device** is the worst case the
   whole architecture is shaped around.

The three rejected routes, recorded so they are not re-litigated:

- **CC0 asset packs (Kenney).** Free, and #42's own sourcing plan names them. Rejected because
  a pack is fitted to *its* roster, not to 23 enemies whose silhouettes have to encode eight
  behaviours; the distinctness criterion becomes whatever the pack happens to supply.
- **Commissioning an artist.** Highest ceiling, and the pipeline is built so a delivery is a
  file copy. Rejected for v1.0 on cost and on being the only route with an outside dependency
  on the critical path. This ADR does not close it — see Consequences.
- **AI image generation.** Cheap and closest to painted, but holding one style across ~130
  assets is the hard part rather than producing any one of them, and the licence position is
  worth settling before a store release rather than after.

## Consequences

- **The ceiling is stated plainly: this will read as clean, deliberate and readable. It will
  not read as painted.** That is the cost, it is accepted, and it is written here so nobody
  later mistakes it for an oversight.
- **The swap-in layer survives.** #42's framing — *"art has been a swap-in layer, never a
  dependency"* — is exactly what makes this reversible. Generated sprites go through the same
  atlas build as any other PNG, so commissioning a painted set later remains a file drop plus
  an atlas rebuild, with no code change. This ADR chooses what ships in v1.0, not what the
  game must look like forever.
- **#43 is unblocked and does not depend on this at all.** VFX, hitstop, screen shake, the
  per-damage-type death variants and the damage numbers are code. Its stated dependency on #42
  is a dependency on the *palette*, which has existed since #22.
- **The generator stops being a placeholder and becomes a shipping tool.** `art:placeholder` is
  named for a job it will no longer be doing; it is renamed when the real generator lands
  rather than in this ADR, so the rename travels with the code that earns it.
