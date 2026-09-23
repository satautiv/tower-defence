# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**M0 complete. M1 is code-complete; two criteria need hardware and humans. M2 has started.**
#10–#18 are done and stage 1-1 plays start to finish in a browser: `npm run dev`, Campaign → 1-1.
**#21, #22 and #35 are done, and #62 — the project's gate — has PASSED.** Statuses, the Aether
Reaction system, the headless balance simulator, and two playtest sessions that took the
reaction system from "a tester triggered it and did not notice" to "all three explain it in
their own words". `docs/PLAYTEST-REACTIONS.md` holds the protocol; the verdict and what changed
because of it are on #62.

**M2's gameplay issues are done.** #23 has the roster in; what remains open on it are the T3
perks, which #32's substrate now makes authorable — `perks` and `perkConfig` are on every tier,
not only a branch's, so a T3 perk is a JSON edit rather than code. **#24 (soldiers), #25
(hero), #26 (Warden Powers), #27 (targeting and the tower panel), #29 (enemy behaviours), #30
(ley lines), #31 (ground effects), #32 (tier 4/5 specialisations) and #33 (bosses) are all
done** and described below. **M2's code is finished, #34 — the map editor — is in, and #36's
ten stages are authored: Region 1 is playable start to finish.** What remains open on #34 is
the decor tool and in-editor playtest, and on #36 the two criteria that need people.

**M3 is complete: #39 (the save system), #37 (meta-progression), #40 (difficulty and challenge
modes), #38 (the Codex) and #41 (the dev overlay) are all done.** Progress persists, a run
survives a backgrounding, unlock gating reads what the
player has cleared, the Warden Talent tree is authored and spendable, a map is now played
seven ways, and `~` opens a panel that says where the frame went.

Two issues stay open for things code cannot close. #30 wants editor support for placing nodes,
which is **#34**. That and #27 both also want a check on a real phone, which is the same check
#20 and #55 are waiting on.

**#19 and #20 stay open on purpose.** #19 needs a playtest with three people who have not
seen the design; #20 needs the game run on a physical Android phone (steps in
`docs/adr/0003-android-packaging.md`). Everything else on both is verified. The reaction
gate the M1 gate was written to ask moved to **#62**, after #22, because the slice has no
reactions — and it passed, so what #19 still wants from people is the fundamentals rather
than the mechanic.

**The protocol for that is `docs/PLAYTEST-REGION1.md`, not `PLAYTEST-M1.md`.** The M1 doc
was written against the vertical slice — three towers, six enemies, no reactions, no sound,
no speed controls — and describes a game that no longer exists; it is kept for its measured
baseline and marked superseded. The new doc is **two sessions**, because the human criteria
left on #19 and #36 are two different questions: **Session A** is a stranger playing the
campaign from 1-1 (which closes #19's playtest, #36's end-to-end criterion and "1-starrable
by a casual player" in one sitting), and **Session B** is two skilled players 3-starring 1-8
separately, which is the one success criterion the balance simulator structurally cannot
answer — it round-robins or buys by price, and has no taste.

`src/sim/` holds the `World`, five structure-of-arrays entity pools, the command queue, event
buffer, damage queue and the fifteen-step tick pipeline, plus paths and movement (#11), the wave
spawner (#12), targeting, firing and projectiles (#13), damage resolution (#14), economy (#15),
lives and win/lose (#16). Every step of the pipeline now does something; `flushEvents` is
deliberately empty, because the consumer drains and clears.

**Ground effects (#31) are live.** `src/sim/systems/groundEffects.ts` runs pools, fields, lava
and the map's one-shot lever through one pool, because they differ only in payload. **Effects
query enemies, never the reverse** — thirty fields asking the spatial hash once is thirty
queries; three hundred enemies asking what they are standing in grows with the wrong number.
Slows take the strongest rather than multiplying, so layering fields can never stand a wave
still, but ground slows *do* compound with status slows, because a Stasis Field is a different
kind of thing from being Chilled. Ground state is recomputed from nothing each tick rather than
accumulated, so an enemy that walks out stops being slowed the moment it does.

**Enemy behaviours (#29) are live.** `src/sim/systems/behaviours.ts` is one pipeline step before
movement, holding eight behaviours: Mender, Shieldwright, Nullifier, Standard Bearer, Sapper,
Carrier, Rift Sprout and Phase Stalker. **Auras take the ground-effect bargain exactly** —
recomputed from nothing every tick, with the source querying the world rather than every enemy
asking who is buffing it. That is the whole of how "auras apply and remove cleanly on death and
on range exit" is met: a Nullifier the player just killed stops suppressing towers on the next
tick, with no per-enemy bookkeeping a death could strand. Strongest wins rather than
multiplying, so two Nullifiers make a tower bad and not silent.

**The behaviour mask lives on the enemy table keyed by type, not per entity.** Behaviours never
vary between two Menders; `EnemyFlag` has six bits left and what lives there — Blocked, Dying,
Leaked — is exactly what *does* change per tick. One test rejects the ordinary roster.

Phase sits beside the shatter check in `damage.ts`, because it responds to the size of a single
hit and that number exists nowhere else; it fires only if the enemy survived, so a killing blow
does not teleport the corpse. The Sapper telegraphs before it lands — a tower that went dark on
contact would be a rule change with no answer, and the wind-up is the window the player kills it
in. `src/view/behaviours.ts` draws both halves, and the split matters: **a moment comes from the
event buffer and ages out, a standing aura is read from the world every frame**, because a ring
that aged out would say the danger had passed while it had not.

**Wave scaling (§9.2) is live**, every coefficient in `tuning.json`. Armour and ward grow at
0.6× the health rate so a late enemy is tankier without making an early damage type worthless,
and bounty grows by the square root so a player cannot out-earn the curve. A splitter's children
and a Carrier's drop are scaled by their *parent's* wave, not the current one.

**What it did to the stage, measured at 60 runs per strategy:** 1-1 stops being free. Median
lives left falls from 19 to 8 for a balanced board and 13 to 3 for greedy, both still winning
100% inside the band. **Five of the eight single-tower boards can no longer clear it alone**,
where every one of them could before — real movement on pillar P1. Flame Vent and Frost Cairn
still solo it at 20/20, so P1 is improved rather than fixed.

Two traps the authoring found, both worth knowing: **`burrow` applied to everyone walking the
segment** rather than to Burrowers, because the tunnel is a property of the road — every Husk on
the map went untargetable through it until `CanBurrow` made it an enemy's property. And **seven
telegraph hues against a 30° floor leaves almost no slack**, so they are spaced evenly rather
than chosen for flavour; picking by feel put suppression and sapping 25° apart, which is the
pair a player most needs to tell apart.

**Region 1 (#36) is ten stages, and the campaign runs.** Each one introduces exactly one new
thing, which §12.2 demands and which is the constraint that shaped the order: Arcane Spire at
1-2 against Ward, air on its own lane at 1-3, Tesla at 1-4, the hero at 1-5, the Barracks at
1-6, the Alchemist's Still at 1-7 against armour, the Mortar at 1-8, the elites at 1-9, Grendrix
at 1-10. The spec asked for the last three towers at 1-6/1-8/1-10; they are at 1-6/1-7/1-8
instead, because handing a player a new tower on the boss stage is not a lesson.

**`tests/content/region1.test.ts` is §12.3 as a test rather than as prose.** Plot counts, ley
node counts, a premium plot that covers two separate stretches of road, a plot that only a long
reach makes worth taking, an interactable per map, the wave budget per stage, and a flyer lane
that does not trace the road — all *measured* against the stage rather than asserted, so they
survive someone dragging a plot. It found one violation immediately: **stage 1-1 sent its Rift
Bats down the ground spawn**, so a board covering the road covered the air for free. 1-1 now has
a lane of its own.

**Unlocks belong to the player, not to the stage.** `unlockedByStage` had been authored and
validated since #23 and read by nothing. It is resolved in `buildRuleset` from
`RulesetOptions.progressStageId`, which defaults to the stage being played — *not* gated on the
stage's own id, because that would take the roster away again the moment someone replayed 1-1
for a better score. The save system (#39) is what will pass real progress. `placeTower` refuses
a locked tower as well as the menu hiding it, since a command can come from a replay or the
simulator.

**That change broke the balance simulator, which is the point of it being in the ruleset.** The
strategies iterated the whole roster and spent their turn on towers the stage had not unlocked,
reporting stages as unwinnable when the scripted player was standing still. They check
`unlocked` now, and `defaultStrategies` no longer offers a `single:` board for a tower nobody
could build.

**Two findings from tuning, both recorded rather than fixed.** First: **every stage starts from
an empty board and zero gold**, so a later stage can ramp further but its opening waves must
still be survivable with two tier-1 towers. The first draft front-loaded Bulwark Golems into
wave three of 1-7 and the whole back half lost at wave 2–5. Second, and the one to point #50 at:
**`greedy` now wins 0% of every stage from 1-2 onward.** Buying the dearest affordable tower
leaves it with nine towers where `balanced` has fifteen, and holding it to the band forced every
stage to be trivial for a board that fills its plots. It is exempt from the band now, like
`rush` — measured, reported, and given its own `greedy-never-wins` finding so the exemption
cannot make it silent.

**The difficulty curve is in lives left, not win rate.** `balanced` clears all ten at 100%, and
the median lives it finishes with runs 20 · 20 · 14 · 7 · 17 · 5 · 10 · 5 · 1 · 3. Stars come
from lives (§12.4), so that is the curve that matters — but it does mean the authored bands are
not yet doing much work, and #50 should set them from measured play rather than from my guess.
Clear times run 4.1 to 8.6 minutes against §12.2's 4-to-6, so 1-9 and 1-10 are long.

**The save system (#39) is in, and it is two separate concerns sharing one
format.** The profile (`src/app/profile.ts`, localStorage) holds stars, best times, attempts
and hero levels; the session snapshot (`src/app/sessionSnapshot.ts`, IndexedDB) holds a whole
serialised `World`. `src/core/savefile.ts` is the envelope, the migration chain from v1 and the
validation, extracted from the prototype `ui/settings.ts` had been carrying — its own comment
asked for that fold, and all sixteen of its tests pass untouched.

**A pool serialises itself, and the part that matters is what reflection cannot see.** The typed
arrays are found by reflection, the same rule `clear` and `hashWorld` use, because a
hand-written list is something a new field gets left off. But `nextId`, the live count and the
slot allocator's free list are private *and the determinism hash folds none of them* — a
snapshot that dropped them would restore to a **matching fingerprint** and then hand the next
spawn a slot and an id it should not have. So `tests/determinism/snapshot.test.ts` advances both
worlds a thousand ticks after restoring: the run has to stay identical, not merely start that
way. Dropping `nextId`, dropping a pool, and dropping one array from the reflection were each
tried deliberately, and each fails the suite.

**base64 is ours (`src/core/base64.ts`)** because `btoa` is a DOM global and `Buffer` is Node's,
and the thing being encoded is built in `sim/`, which may touch neither.

**Two findings from building it, both from running the game rather than the tests.** First, the
snapshot fixture's first draft passed every assertion while holding **zero live enemies, zero
projectiles and an RNG still sitting on its seed** — four pools proven by an empty world. It
asserts its own richness now. Related and worth knowing beyond #39: **Region 1 never advances
the RNG at all**, because it is consumed only by path branching and chance-based effects and ten
stages have neither. Second, **a run was recorded twice**: the recording sat inside a `setResult`
state updater, and a React updater must be pure — StrictMode double-invokes it, so one play
wrote `attempts: 2`.

**Resuming has to know the saved run before the session exists.** `GameSession.forStage` mints a
seed from the clock, so a world built first and restored into second carries a seed the snapshot
does not match — and the snapshot's own guard refuses it, correctly. The canvas waits for that
read and the session is built from the saved run's seed. Found by resuming in a browser and
reading the refusal.

**Unlock gating now reads real progress.** `progressFor` takes the later of what the player has
cleared and what they are playing: a first run of 1-6 offers the Barracks 1-6 introduces, and a
replay of 1-1 after finishing the region keeps all eight towers. That closes the placeholder #36
left. Gating the *campaign list* on stars is deliberately not done here — it belongs with the
region map (#37), which is where a locked stage has somewhere to say why.

**An import is all or nothing**, and a bundle keeps each file's own envelope so an old profile
still runs its own migrations. Clearing wipes the adapters rather than known keys, so the
`profile.unreadable` backup goes too. **One gap stated rather than papered over:** a content edit
that changes a stat without changing any array's length is not detected, so such a run resumes
against the new numbers — closing it needs a content fingerprint, which belongs with #59.

**The Warden Talent tree (#37) is live, and it added no system.** Talents take the same bargain
unlocks, perks and ley nodes take: `RulesetOptions.talents` is folded into the flat tables by
`buildRuleset`, so **no system knows a talent exists** — a tick reads `towers.damage[i]` as it
always did and the bonus is already in it. Fourteen stats, all onto machinery that already
existed; `powerSlots` is deliberately absent because §14.1's capstone needs a loadout limit the
game does not have.

**The stat vocabulary is a Zod enum in the schema, not a string.** That is #26's tightening
applied again, and for the same reason: a loose field lets a node be authored against a stat
nothing applies, so the player buys a rank that pays nothing — the Gilded Alembic failure.
`tests/sim/talents.test.ts` drives **every** stat in the vocabulary through `buildRuleset` and
asserts a number moved; adding a `powerSlots` stat nothing applies fails with "powerSlots is in
the schema but nothing applies it".

**§14.1 contradicts itself, and the cap wins.** It gives sample nodes (+10%/rank reaction
damage over five ranks) *and* a +35% cap; one node cannot be +50% inside a +35% budget. Authored
at the sample numbers and measured, the tree took stage 1-9's median lives from **1 to 17** and
turned 1-4 from a loss into a 100% clear. Retuned to roughly half it reads 20→20, 7→15, 10→15,
1→4, 3→10 with win rate 100% on both sides: it widens the margin and never flips a loss into a
win, which is what "smooths the curve for players who struggle" means.

**A confound worth remembering when measuring anything against a stage.** The first comparison
forced the full roster, so `balanced` on 1-4 was round-robining eight towers instead of the four
a player has there — spreading thin and losing with *no talents at all*. Measured with the roster
a real player holds, the baseline reproduces the documented medians exactly (20 · 7 · 10 · 1 · 3),
which is how you know a comparison is apples to apples.

**Two ordering bugs the forty nodes exposed that three had hidden.** `branchNodes` sorted
prerequisites with a pairwise comparator, and "a before b when b requires a" is not transitive
across a chain — four-deep chains put a prerequisite below its dependent and `Array.sort` was
free to pick any such order. It sorts by depth now. And the authored descriptions stated the
total at full rank while the screen offered the next rank, so a node read "returns 0.5 Aether"
directly above "Next rank: 0.25 more". Descriptions are per-rank now.

**Stages are not gated on stars, deliberately.** #37's unlock chain is about towers, heroes,
powers and specialisations; nothing in the design gates stage *access*, and locking the region to
its first stage would take the remaining playtests (#19, #36) away from the people who still have
to run them. The region map shows what has been earned — stars, clears, best times — and opens
everything.

**Modes (#40) are live, and a map is now played seven ways.** Four difficulties in
`tuning.json`, a Heroic and an Iron challenge per map, and an Endless run per map — thirty
challenge files and not one new system below `buildRuleset`. Every mode resolves into the flat
tables the same way unlocks, perks, ley nodes and talents already do: a banned tower is a zero in
`towers.unlocked`, tripled Ward is a bigger float in the enemy table, Veteran's lives are a number
on the world. **No tick asks which mode it is running.**

**Three refusals could not be a number**, and they are `PlayRestriction` bits the command handler
tests: no selling, no upgrading, no rebuilding. One `ForbiddenByChallenge` reason serves all three,
because the rejection event already carries the verb. Specialising counts as upgrading — a
challenge that stopped tier three and allowed tier four would forbid nothing. And **`noRebuilding`
comes down to closing the undo window**: with selling refused, nothing else in the game removes a
tower, so undo is the last route to a plot that has been built on.

**A wave limit both truncates and extends**, because Iron is "survive fifteen waves" on every map
and Region 1 authors ten to sixteen. Either way **the stage's last wave stays last** — the rule
`wavesFor` already follows when Impossible splices its extra elite wave second-to-last, so a boss
stage still ends on its boss. Endless takes the same primitive with `waveSource: 'region'`: two
hundred waves drawn from every map in the region, so wave sixty on Emberfall Ridge is 1-9's elites
rather than the opening riftling with eight times the health. Wave scaling is per wave *index*, so
a repeat is already harder with nothing arranging it.

**Every Heroic has a recorded solution, replayed on three seeds every CI run.** A puzzle nobody
has solved is indistinguishable from an unwinnable one until a player wastes an evening on it.
`tests/content/challenges.test.ts` holds the answer key. Six of the ten failed their first draft
for the same reason — **these stages were tuned against the whole roster, so a two-tower kit walks
into whichever wave the missing tower existed to answer** (the Phase Stalker's 600 health behind 30
ward on 1-2 and 1-3, the Bulwark Golem on 1-6). Fixed by changing the kit, not the wave, except on
1-2 and 1-9 which keep their kit and are handed the gold to fill the board with it.

**Two findings from measuring it, both worth keeping.** First: **more starting gold made `greedy`
lose where it had won**, on 1-3 and 1-8. Buying the dearest allowed tower first leaves the far end
of the road uncovered, and a bigger purse buys more of exactly the wrong board. Second, and the one
that forced a new strategy: **every existing strategy shares `upgradeSomething`, which upgrades the
lowest slot and nothing else** — once that one tower is maxed, gold piles up. Over ten waves it
barely shows; over two hundred it is the whole result. `endurance` spends on the cheapest
improvement anywhere on the board, and is deliberately outside `defaultStrategies` because adding a
strategy to the CI gate changes what every stage is measured against. Measured with it at Endless's
thirty lives: **1-4 26 · 1-2 37 · 1-7 37 · 1-9 41 · 1-8 43 · 1-6 52 · 1-10 52 · 1-1 53 · 1-3 66 ·
1-5 92**. Half the region past wave fifty on a board that reads no map. The spread is the maps, not
the mode, which is the right shape for a per-stage leaderboard.

**Endless's first draft ended at wave twenty on every map**, because the region's stages were
gathered in *string* order and "1-10" precedes "1-5". Grendrix arrived at wave twenty and that was
the run. `compareStageIds` exists for exactly this and was not being used. A second bug from the
same change: **a borrowed wave names its own stage's spawn points**, and the borrowing map may have
fewer — indices are wrapped now, and a flyer group landing on the ground lane still flies, because
flight is the enemy's property and not the route's.

**A stage is worth eleven stars (#48), and the profile is keyed by mode.** `src/app/modes.ts` is
the list of ways one map can be played, read from content rather than written down, and it carries
both what the profile records against and what the ruleset is built from — Veteran is a difficulty
and Iron is a challenge played on Normal's numbers. Profile **v2** migrates a v1 file by moving its
flat record onto Normal, the only mode it could have been earned on; the migration deliberately
hands on anything that is not a map of stages rather than repairing it, because the first draft
turned `stages: 7` into an empty campaign. Region 1 is 110 stars, not 30.

**Endless is the one mode gated, and the gate is in the UI rather than the ruleset.** §14.2 asks
for three stars *on the stage*, which is a thing done on one mode and not a total summed across
four — eleven stars scraped thinly is not mastery of the map. The check is `modeLocked` in
`app/modes.ts`, deliberately not folded into `buildRuleset` the way a tower unlock is: a locked
tower changes the board the *simulation* resolves, so `placeTower` refuses one and the balance
simulator sees the roster a player would; a locked mode changes nothing the simulation computes,
and the simulator has every reason to run Endless on a stage nobody has starred.

**The picker is two taps, and that is the feature.** Choosing a stage opens its modes and starts
nothing. Iron is one life and Impossible is a different game; a single tap that launched whichever
mode happened to be remembered would drop a player into one with nothing on screen having said so.
A snapshot carries its mode beside its seed, for the same reason both are there: the world has to
be *built* the right way before the bytes are written into it.

Two layout bugs, both found by opening the picker at phone width rather than by a test. **A row of
name, sentence and score shreds at 420px** — the middle column came out two words wide and one
description ran to ten lines; it is a two-row grid now. And **`.ui-screen` did not scroll**, so the
bottom of a long list was unreachable — already true of the forty-node talent tree, and fixed by
the same line.

**The Codex (#38) is in, and it holds no numbers of its own.** `src/app/codex.ts` resolves every
tower, enemy, reaction, status and damage type out of the same content files `buildRuleset` reads.
That is the load-bearing decision rather than a tidiness one: a Codex with its own copy of a
reaction's damage would be a second source of truth for the thing the whole game is built on, and
it would be wrong the first time `reactions.json` was retuned. "With its exact formula" is true by
construction.

**The acceptance criterion is a test, not a screenshot.** `tests/app/codex.test.ts` triggers each
reaction in a real world and checks the Codex's arithmetic against the magnitude the simulation
emitted. Worth knowing about its reach: **only Thermal Shock has a per-stack term** today, and
Superconduct and Amplify deal no damage at all — so `base + perStack × stacks` is exercised by one
row of five. That is a fact about the authored matrix, not a hole: give any reaction a
`damagePerStack` and the test tightens on it with no edit.

**Discovery needed a map, and the reason is worth remembering.** `EnemyDied` carries the *entity*
id and not the type — all five payload slots are spoken for, and the slot is freed before anything
drains the buffer. Growing the event record for a feature outside the tick loop is the wrong
trade, so `CodexScout` keeps its own entity→enemy map, filled on spawn and emptied on death or
leak, bounded by what is alive. A leak is deliberately not a discovery: something that walked past
is not something the player learned to kill. A resumed run adopts what is already on the board,
or killing it would discover nothing.

**Findings are flushed at three moments and the third is the one that matters**: stage end, the
platform's `pause` (a backgrounded phone may never run code again), and *opening the Codex
mid-run*. Without that last one a player kills a Nullifier, opens the Codex to find out what it
was, and is told they have never seen one. `recordFindings` returns the same profile when nothing
is new, so repeated pauses cost no writes.

**The Codex opens as a panel, never as a screen, while a stage is running.** §38 asks for
"accessible while paused… without leaving the board", and the stage screen owns the Pixi
application: navigating would unmount the renderer and rebuild it over a run the player merely
wanted to look something up in. `isPaused` lives in the store and names both panels that hold the
board still, because a Codex that resumed the wave behind the page explaining it would be the
opposite of the point.

**Counter-play hints are authored per enemy** as `counterKey`, not derived from the trait list:
the useful sentence is not "has directional_armour" but "put towers behind the road". §9.1 already
writes one per enemy. Statuses and damage types are **not** discovery-gated — a player meeting
Scorch for the first time has to be able to look it up, and completion counts only what must be
found, so a new player does not start at forty percent of a thing they have not done.

**Every word a player reads is a word, and that took two passes.** The first draft printed the
tier-5 capstone as `absolute_zero` and an ability's effect as `chillDecay ×0 for 8s` — which is
exactly the wiki lookup the feature exists to remove. A row now carries an optional `labelKey`
and `valueKey` alongside its plain strings, so a name travels as a locale key and the view
resolves it, and `STAT_WORDS` gives every `MODIFIABLE_STATS` entry a phrase. `describeEffect`
switches over the effect union rather than looking anything up, so **adding a primitive to
`effects.ts` is a compile error until the Codex can say what it does**. The test asserts no
underscore *and* no camelCase in what a capstone claims.

Two findings from running it at phone width. **Five tabs at the default button padding took three
rows and a third of the panel**; they are narrowed rather than shortened, because the labels are
the words a player is looking for and the 48px touch target is not negotiable. And **the one
enemy a player had actually killed sat sixteenth**, under a wall of undiscovered rows — the list
puts what has been found first while there is anything left to find.

**A replay is a seed and an ordered command list (#41), and `commands.ts` said so first.** Its own
header already names the three properties a replay needs — nothing outside the simulation mutates
the world, every intent arrives as a command, and commands apply at a tick boundary rather than
mid-pipeline. `src/sim/replay.ts` is the reading of that design, not machinery bolted on: a
recorder that reads the queue *before* the tick that drains it, and a player that pushes each
command back on its own tick. `tests/determinism/replay.test.ts` compares `hashWorld` **at every
tick**, not only at the end — a run that diverged at tick 300 and re-converged by 900 would pass an
end-state check and be worthless as a bug report.

It ships rather than living with the overlay that drives it, because a replay is how a bug report
becomes a test and is a hundred and thirty lines of arithmetic; the buttons are what get stripped.
A replay carries the mode and the progress stage beside the seed, for the reason a snapshot does:
the world has to be *built* the same way before a command list means anything.

**The damage log (#41) is a pure consumer of the event buffer, and closing its sum needed two
gaps fixed.** `DamageDealt` already fired for every resolved hit after armour, ward and every
multiplier — which is exactly the number that has to add up — but it carried no **source**, so the
log could total damage and not name it, and a hit only *partly* swallowed by an overshield was
never reported at all. That difference used to vanish, which is precisely the "where did the other
forty go" the log exists to answer. `DamageEventFlag` distinguishes a reaction from a shield
absorb, and slot `e` carries the tower.

**"100% of an enemy's lost HP" is true to float32, and that is a property of the pools.**
`EnemyPool.hp` is a `Float32Array` while a log accumulates in float64, so the reconciliation is a
float32-against-float64 comparison: near 500,000 health the spacing between representable values
is about 0.03 and `maxHp - hp` cannot recover a finer sum. The first fixture used 500,000 and
missed by 0.014 — catastrophic cancellation, not a bug. The tests assert **relative** error, which
holds at any size, rather than decimal places, which quietly mean something different on a
riftling and on Grendrix.

**`src/devtools/` takes the editor's bargain exactly**, and for the identical reason:
`bundle-budget` sums every emitted chunk whether or not a player loads it, so the overlay is
reached through a dynamic `import()` inside an `import.meta.env.DEV` branch. ESLint forbids a
static import from all seven shipping layers and `tests/guardrails.test.ts` proves each ban fires —
removing the rule fails seven tests. The production bundle holds **zero** devtools bytes, verified
by grepping `dist/`.

**The overlay itself (#41) is behind `~`, and its acceptance criterion is asserted rather than
timed.** *"Zero measurable overhead when hidden"* measured with a stopwatch is a flaky test that
proves nothing on a loaded runner, so it is met by a rule applied without exception instead:
**every per-frame hook tests `visible` as its first statement and returns**, and hidden, the
overlay therefore reads no clock and touches no world. `tests/devtools/overlay.test.ts` hands it
a world behind a throwing `Proxy` — any field it reads while hidden throws, by name. That is why
`endSim()` takes no timestamp: it calls `performance.now()` itself, *after* the guard, rather
than making the caller pay for a reading it would discard. The whole of the cost in the stage
screen is a null check at three call sites.

**Nothing in the stage screen names `@devtools/`, not even in a type position.** The panel
constructs the `StageDevtools` and hands it back through `onReady`, so TypeScript checks the
class from the far side of the boundary and `InStageScreen.tsx` declares only the eight methods
its ticker calls. A ban with an exception for types is a ban somebody eventually launders a
value through.

**The cheats live in `src/sim/cheats.ts`, and that placement is the decision.** A cheat is a
mutation with no command behind it — exactly what the command queue exists to prevent — and both
obvious homes were worse: writing to the world from `devtools/` makes *"only `sim/` mutates the
world"* false, and a `CommandKind` entry puts a give-gold path in the shipped command handler
where a player can reach it. So the mutations stay inside `sim/`, in a module the barrel does not
export and ESLint forbids **every** shipping layer from importing. Each one then sets up state and
lets the ordinary systems draw the conclusion: `skipWave` marks the wave's groups fully spawned
and empties the board, and the spawner's own `completeWave` pays the clear bonus and emits
`WaveCleared` on the next tick. It frees enemies rather than killing them, because killing them
would pay bounty, split the splitters and drop the carriers' cargo — which is the wave rather
than a way past it.

**Four findings, three of them from running the game rather than the tests.** First, and the one
worth remembering beyond #41: **the three per-frame buffers empty at three different moments**,
and the first draft sampled all of them after the tick — reporting a game that had never issued a
command and never dealt any damage, for the whole run, with nothing about a zero to say it was
taken at the wrong time. Commands are drained at step 0, so they are sampled in the pre-tick hook
the replay recorder already uses; the damage queue is filled *and* drained inside one tick, so
there is no moment outside one where it holds anything and `DamageQueue.highWater` tracks its own.
Second: **`1000 / (simMs + renderMs)` read 4,317 fps** over a board doing almost nothing — that
is the rate the frame did *work* at, not the rate the screen refreshes at, and the two are only
the same number when the frame is already over budget. Third, **the panel opened at the top-left
corner sat exactly across lives, gold and aether**, the three numbers you are most likely to be
watching while you cheat them; it hangs below the top bar now, which is the same move the boss
bar made. Fourth, the time scale rides a **virtual clock accumulated from scaled elapsed time**,
the bargain `Cinematic` already makes — a clock re-derived from real time would snap forward on
leaving 0.1× and burst a second of ticks into one frame.

**A cheated run is not reproducible, and the panel says so next to the record button.** Nothing
in a command list explains a mutation that had no command, so a replay saved from a cheated run
is not a bug report. `StageDevtools` remembers that a cheat fired for exactly that sentence.

**The map editor (#34) is in, and it lives in `src/editor/`, not `tools/map-editor/`.**
TECH_DESIGN §13.1 names that directory and in the same breath calls the thing *"a browser
route, dev-only"*, and those cannot both be true — a browser route has to sit where Vite
resolves it, where the aliases work and where the ESLint layer boundaries reach it. The
directory now holds a README saying so.

**The rule that shaped everything else: nothing that ships may import it.** `bundle-budget`
sums every emitted chunk whether or not a player loads it — its own caveat says so — so a
lazily-loaded editor would still cost the 500 kB gate. The route reaches it through a dynamic
`import()` inside an `import.meta.env.DEV` branch, which Rollup drops along with the whole
screen: **the production bundle is byte-for-byte what it was before the editor existed, 64.9%
of budget.** `eslint.config.js` forbids a static import from every shipping layer and
`tests/guardrails.test.ts` proves the rule fires, because a guardrail nobody re-checks is worse
than none.

Adding that rule found a real one: a new ESLint block setting `no-restricted-imports` for files
an existing block already covered **replaced** it rather than merging, silently disabling every
layer boundary in the project. The guardrail tests caught it on the first run. The editor ban is
folded into each layer's own rule instead. A second finding, left alone deliberately: the
presentation-layer rule is scoped to `*.ts` and has never applied to `*.tsx`, and
`InStageScreen.tsx` imports `@app/session` today. That is a real gap and not #34's to close.

**The draft is a `StageDefinition`, not an authoring model.** Every edit in `draft.ts` returns a
new one, so undo is a stack of whole stages and React decides what to redraw by identity.
`validate.ts` reimplements no rule — it parses with `StageSchema` and calls `lintContent` with
the draft substituted into a copy of the real registry, which is the only way the cross-file
rules work at all, and is what makes *"exported stages pass content:lint every time"* true by
construction rather than by hope. Locale misses are reported apart from lint and do not fail a
draft: #36 writes a stage and its English in the same commit.

**Coverage is measured along the road, not over the map** — a corner no tower reaches is
scenery, a tile of road no tower reaches is a hole every enemy walks through. It takes the reach
being asked about, because "is this covered" has no answer independent of what is standing
there: a Sniper Nest reaches 14 tiles and an Alchemist's Still 6.

`tests/editor/playable.test.ts` is the acceptance criterion whole: it authors a stage through
the editor's model, sends it out through the exporter and back through the importer — the round
trip a real file takes — and hands it to the **balance simulator to win**, on four seeds. Valid
is a lint run and complete is a parse, but *playable* is only ever proven by playing it, and
#36 is about to author ten stages this way.

Two traps, both found by running it. **`.ui-overlay` sets `pointer-events: none` and every
control opts back in** — the editor did not, so every click fell through to the div underneath
and the whole tool looked perfect and did nothing, while all sixteen happy-dom tests passed.
happy-dom does not implement `pointer-events`, so no unit test could have caught it. And
**there was no way to set a stage's name key at all**, which only surfaced when the first
exported file came out named after the default.

**Bosses (#33) are live, and a phase is another row of the enemy table.** That is the whole
framework: `EnemyTable` grows extra rows for a boss's later phases, appended *after* every
ordinary enemy so an enemy's index is still its index, and crossing a threshold is
`enemies.typeIdx[slot] = nextPhase`. Behaviours, speed, armour, melee and the sprite all come
from that row already, so **no system below `advancePhase` knows a phase exists**. Health,
statuses and path position live on the entity rather than the row, which is what makes it a
transition and not a respawn — a boss that healed or forgot its Corrode on crossing 50% would
undo the fight the player just had.

Three things the row swap had to be taught, each one a bug if forgotten. **Armour and ward are
re-derived through `defenceScaleFor`**, not copied raw, or a boss would shed the wave's defence
growth along with its first phase. **Flags are replaced rather than merged**, but only the
`TYPE_FLAGS` bits, so a phase that drops a trait really drops it while Blocked and Dying are
left alone. And `BOSS_RULES` is re-applied unconditionally: a phase states its own trait list,
so an author who writes phase two without repeating `boss` would otherwise hand the player a
boss that becomes freezable exactly when the fight gets hard.

**Grendrix's Swallow reaches only what is *blocking* it**, which is what makes the answer a real
decision rather than a stat check: pull the rally flag back and the boss walks free, leave it
forward and the garrison feeds it, and a Ranger Lodge fights from outside that reach. It is an
instant kill routed through `soldiers.fall`, so a hero is sent to respawn rather than deleted
and no enemy is left blocked by a slot that no longer holds it.

**The corrosive pools added no boss-shaped code.** "Disables plots" became `GroundEffectFlag
.Suppresses` — a capability of the ground, re-stamped every tick and reusing `disabledUntil`
and the Sapper's own event, so a plot recovers on the tick the pool goes out with nothing to
unwind, and a region that wants the same terrain gets it for free.

**`behaviourReadyTick` is now one timer per behaviour per enemy**, flat `slot * BEHAVIOUR_BITS +
bit`, which is exactly the growth the field's own comment predicted. Grendrix's phase two both
swallows and spits on different cadences; one shared timer would have let whichever fired most
often silence the rest. `EnemyFlag.WindingUp` separates "armed" from "due" on a single timer,
which is what lets a Sapper's wind-up and a Rift Maw's bite run the same code.

**Hitstop and slow-motion changed when ticks run, never which ticks run.** `src/app/cinematic.ts`
is pure arithmetic over a clock it is handed, and `GameSession` feeds the loop a *virtual* now —
real elapsed time multiplied by the cinematic's scale. `tests/determinism/cinematic.test.ts`
plays a whole stage with the sequence firing every 200 frames and asserts a byte-identical hash
against a run without it, plus that the run really did take longer in frames. That test is the
point: this is the first thing in the game to touch the clock for a reason other than the player
asking, and it is therefore the first thing that could quietly break replays and the balance sim.

Two traps, both found by running the game rather than the tests. **The boss bar centred at the
top sits across the speed controls** — it takes no pointer events so they still worked, but half
of "1×" was behind it; it now hangs below the top bar's row. And **nine telegraph hues do not
fit a 30° floor**: the two boss telegraphs forced a respace of all of them from 51° to 40°,
moving every existing hue. That cost is paid deliberately and paid now, because the behaviour
telegraphs have not been in front of a playtester yet and the same respace at twelve would not
fit at all. `src/view/palette.ts` says what the answer is at ten — a second channel, shape, the
way `reactions.ts` already does it.

**Tier 4 and 5 (#32) are live, and a perk is a bit, a column and a hook.** `TowerPerk` in
`src/sim/flags.ts` is thirteen bits on the *tier* — not the tower and not the entity, because a
perk never varies between two Sniper Nests and the tier is what a specialisation changes.
`applyPerks` in `ruleset.ts` turns the authored `perks` array and its `perkConfig` into that
mask plus nineteen numeric columns, so **no system reads a perk's name during a tick**: it tests
one bit and reads one float. The rule that kept it from sprawling is the one `effects.ts`
already had — **when a branch cannot be expressed, add a primitive, never a special case**, and
`tests/sim/perks.test.ts` drives each of the thirteen through a stage rather than asserting the
mask.

Where each hooks is the whole design. `pierce_fraction` and `bonus_vs_status` sit in
`effectiveDefence`, the one damage formula; `spread_on_death` and `discharge_at_cap` sit in
`damage.ts` after the queue drains, so what they push re-enters the *same* queue and a contagion
kill pays bounty and splits like any other; `piercing`, `pulls`, `refracts`, `leaves_ground` and
`freeze_pulse` are all in `firing.ts`, because they change what a shot *is*; `global_gold` is a
multiplier in `awardKill`; `reflects` and `marks_target` are in `soldiers.ts`, the only two that
belong to a garrison. **Nothing branches on a tower's id anywhere**, which is what lets
`roster.test.ts` still drive a synthetic ninth tower through a whole stage.

Two traps, both found by running the game rather than the tests. **A 15% cut of a Region 1
bounty is zero**: Gilded Alembic multiplied a 6-gold kill and `Math.floor` ate the whole perk,
so the branch did nothing at all for its first stage. `awardKill` rounds now, and the test uses
an ordinary 6-gold bounty deliberately. And **`freeze_pulse` on every shot is a permanent
stop** — the one thing §10 forbids a single tower — so it runs on `perkReadyTick`, its own
clock, shared by Glacier Heart's aura and the Siege Howitzer's shell because "stun on a cadence"
is one mechanic in two silhouettes.

**Measured at 200 runs per strategy, the perks moved two numbers.** `greedy`'s median reaction
count goes from 1 to **4** and `balanced`'s to **96**, because a branch that lays ground, spreads
Corrode on death or discharges Charge at its cap is a second status source on a board that had
one. And a **third** single-tower board now clears 1-1 alone — Arcane Spire joins Flame Vent and
Frost Cairn, where five of eight still cannot. That is pillar P1 moving the wrong way by one, and
it belongs to #50 rather than here: the capstones are doing what §10 says they should, on a stage
authored before any of them existed.

**The tier-4 panel is the side-by-side #27 was waiting for**, and building it found that both
options carried the *tower's* id: every tower on the board offered "Arbalest Post" against
"Arbalest Post". `TowerTable` now holds `branchIds`, `branchNameKeys` and `perkKeys`, and the
panel takes **one `text` resolver rather than a `name` and a `perk`**, since both are the same
lookup and a second prop only invites passing the wrong one. Every branch's tier 4 must carry at
least one `perkKeys` line — `roster.test.ts` fails without it — because two branches routinely
land within a few points of each other on DPS, and a column with no words is a coin flip with
extra steps. That same resolver fixed the panel's own title, which had been printing
`wardens_barracks` with the underscores swapped for spaces.

**Ley lines (#30) are live, and they added no system.** Four node types, all four authored in
`tuning.json` as four independent columns — attack speed, range, status stacks, reaction damage
— of which each type fills exactly one. That shape is the whole trick: the stat pipeline
multiplies four numbers unconditionally instead of branching on which node it is standing on,
and a fifth node type is a JSON edit rather than a new case in `applyTowerStats`.

Three of the four are stats and land in **`applyTowerStats`, the one funnel every rung goes
through**, which is what makes "bonuses apply at every tier and specialisation" true without a
single upgrade path having to remember it — an upgrade re-stats, and re-statting re-applies the
node. The node is copied onto the tower at build time and read from `plotById` inside
`placeTower`, so a test and the balance simulator get it as surely as the command handler does.

**Surge needed the one genuinely new idea: a reaction has to know whose it was.**
`EnemyPool.statusSource` records the tower whose hit applied the most recent status, threaded
through `applyStatus` as an optional last argument, and the reaction is credited to whoever
completed the pair. Everything that is not a tower — a ground field, a Warden Power, a
reaction's own ignition — passes -1 and clears the credit, which is correct rather than
lossy. `escalate` passes the source on, or a Frost Cairn on a Surge node would lose its bonus
at the exact moment it stacks Chill to five and freezes. The multiplier is folded into the
reaction's `magnitude` once, so the burst, the blast, the arc and the lingering burn are all
surged by one multiplication — and because the credit follows the *hit*, a Surge node on the
board is not a Surge node on someone else's reaction.

**The measured effect, isolated by neutralising the tuning and re-running:** `greedy` — the
caricature board that took plots in cost order and triggered **zero** reactions in 200/200 runs
— now triggers one in **every** run, because plot 2 on stage 1-1 is a Resonance node and greedy
takes it early. `balanced` is untouched (81 vs 80), which is the right shape: the node dragged
the laziest possible board into the mechanic without changing what a real board does. That is
the node earning its place rather than a balance change hiding inside a feature.

Ley colours live in `src/view/palette.ts` with the rest, but they are **deliberately exempt from
the reaction rule** and the file says why: they are static plot markers, drawn before anything
is built and covered by the tower afterwards, so they never share a moment with a detonation —
and nine hues are already reserved, so four more at 30 degrees' clearance would not fit. What
they *are* held to is each other, so a player can read which bonus a plot carries without
tapping it. One trap, found by running the game rather than the tests: **the build menu's arc
has an inner radius of 96px but its cards hang well past the plot**, so a notice placed 16px
below the plot is drawn behind the end card and reads as nothing at all.

**Abilities are data (#26).** `src/sim/effects.ts` holds eight primitives, and the rule that
keeps them honest is: when something cannot be expressed, add a primitive rather than a special
case anywhere else. All five Warden Powers, every tower capstone and every hero ability compose
from them, and `tests/sim/powers.test.ts` checks that claim rather than asserting it. Effects
are a **discriminated union** in the schema, not a parameter bag — tightening it immediately
found that the abilities authored so far disagreed with each other about `seconds` versus
`durationSeconds`, `bonus` versus `flat`, and whether `slow` meant the multiplier or how much
slower. `forceReaction` answers Aether Siphon's own criterion: every valid reaction in radius at
once, with the per-enemy lockout set aside, routed through the same `resolve` the ordinary path
uses so a forced reaction is the same reaction.

**Soldiers and blocking (#24) are live.** `src/sim/systems/soldiers.ts` is the whole of it, and
the hero (#25) is meant to run the same code with better stats — blocking is far too subtle to
have two implementations. The rule everything turns on is the **blocking window**: a soldier
blocks only enemies whose distance *along the path* is near its own, never enemies that are
merely close in pixels. Stage 1-1's route doubles back twice, so two points a tile apart can be
a hundred tiles apart in the only sense the simulation cares about.

Two traps worth knowing, both found by running the game rather than the tests:

- **A garrison defaults to the road, not the tower.** Plots sit two or three tiles off the path
  and a soldier's reach is pixels, so a barracks whose soldiers stood on it watched every enemy
  walk by just out of arm's length — zero blocks in a real stage, while every unit test passed
  because they all placed the barracks *on* the path.
- **The release valve needs a grace distance.** When an enemy's block window lapses, the soldier
  releases it and then re-engages it on the same tick, resetting the timer. `blockReadyDist`
  gives an enemy that shoulders past a stretch of road nothing may block on.

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

`src/view/palette.ts` holds every colour the board uses to say what something is — damage
types, statuses and reactions together, because they have to be told apart *from each other*
and that cannot be checked when each lives beside the code that draws it. The rule it enforces:
**a reaction's colour must be distinguishable from every damage type and every status**, by hue
rather than by overall distance. The second gate session found why that matters — Thermal Shock
was drawn in the same pale blue as Chill's own status pip, and a tester could not tell the
signature mechanic from ordinary frost indication. Four of the five reactions had the same
fault, each coloured after its own ingredients. `tests/view/palette.test.ts` now fails on it.

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

That design was paid for and #23 collected: **taking the roster from three towers to eight
touched no code at all** — five JSON files, their locale keys and their placeholder sprites,
with `src/sim`, `src/view` and `src/ui` untouched. `tests/content/roster.test.ts` keeps it
honest by loading a synthetic ninth tower and driving it through a stage; if some system ever
starts branching on a tower's identity, that is where it surfaces.

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

**A fourth, and the one #62 should be pointed at.** With reactions live, the naive board on
stage 1-1 triggers **zero** reactions across every seed. The signature mechanic works and it
pays — but on 1-1 the lazy line ignores it entirely, which is a stage-design and roster problem
(#36, #23, #50) rather than a code one. Worth handing to #62's playtesters deliberately rather
than hoping they find it.

**The balance simulator sharpened that considerably** (200 runs per strategy, every seed):

| | |
|---|---|
| Every strategy, including every single-tower board | wins **100%** with **20/20 lives** |
| `greedy` — most expensive affordable | builds **all three types** and still triggers **0 reactions in 200/200 runs** |
| `balanced` — round-robin | median **1** reaction. Pick rates span **4.5:1**, past the limit |
| Peak unspent gold | **~500**, on a stage whose towers cost 100–150 |

**Chased down, and the obvious answer was wrong.** The plot layout is not the problem: 1-1 has
**43 ordered plot pairs** where a Flame Vent and a Frost Cairn share path coverage. The problem
was that **enemies died 1.9 seconds after spawning**, at the very start of the path, so they
never reached a second tower's zone. With a deliberately perfect board an enemy carried both
Scorch and Chill for **six ticks across the entire stage** — the mechanic had no window to
express itself in.

Region 1 enemy health is now **×2.5** (riftling 45→110, husk 90→225, and so on across the
roster, so the set stays calibrated against itself). A mixed board goes from **1 reaction to 36**
per run, with the stage still won 100% at 20/20 lives — it is no harder, the enemies just live
long enough for two statuses to meet. Verified by `npm run balance`, which is what found the
mechanism in the first place.

Three things it did *not* fix, left for #50 and #23:

- **`greedy` still triggers almost no reactions at any health.** 600 starting gold buys exactly
  six Flame Vents, which take plots 0–5, so the cheaper Frost Cairns always end up at the far
  end of the path and never share a segment. Tuning starting gold to fix it produced chaotic
  results (0 → 24 → 6 → 0 reactions), because it depends on precisely when gold crosses a price
  threshold. That is a caricature of a player, not a stage defect — both real playtesters mixed
  towers unprompted. **Ley lines (#30) later moved it off zero**, to exactly one reaction per
  run: greedy takes plot 2 early and plot 2 is a Resonance node. One is still not playing the
  game, and the figures in the table above predate both the roster and the nodes.
- **`rush` now loses every run**, where before it won 100% without losing a life. Calling every
  wave early went from free to fatal in one step. The simulator warns rather than fails on it:
  `rush` is exempt from the authored band, because a player turning the risk dial to its limit
  should be *able* to lose — a band that forbade it would mean nothing.
- **Any one tower still clears 1-1 alone**, which is pillar P1 failing outright rather than
  drifting.

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
| `docs/PLAYTEST-REGION1.md` | The two human sessions left: a stranger on the campaign (#19, #36), two skilled players on 1-8 (#36) |
| `docs/PLAYTEST-REACTIONS.md` | How #62, the reaction gate, was run — passed, kept as the protocol |
| `docs/PLAYTEST-M1.md` | Superseded. Kept for what the automated checks measured on the slice |
| `docs/adr/0004-reaction-readability.md` | What the first gate session found, and what was changed because of it |
| `docs/TECH_DESIGN.md` | The technical spec — stack, architecture, per-system design, tooling, roadmap |
| `tools/map-editor/README.md` | Why the editor is in `src/editor/` and not there |

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

`npm run balance` is real now (#35). It runs stages headlessly across seeds and reports win
rate against each stage's authored band, tower pick rates, reaction counts, loss-wave
percentiles and peak unspent gold. With no `--strategy` it runs all of them plus one per tower,
which is usually what you want — the interesting number is rarely one strategy's win rate, it is
the gap between two. Runs spread across every core; `--workers 1` runs in-process when a stack
trace matters. **It is a CI gate**: a stage outside its band fails the build. The gate
runs **one job per stage**, and the matrix is read off `src/content/data/stages/` rather
than listed in the workflow — authoring a stage puts it behind the gate with no CI edit.
Region 1 is what forced that: ten stages in one job blew the ten-minute wall, and a bigger
timeout would only have moved the wall rather than kept the gate inside a PR's patience.

```
npm run balance -- --stage 1-1 --runs 2000 --strategy greedy
npm run balance -- --runs 200 --csv out.csv --json out.json
npm run balance -- --stage 1-8 --difficulty veteran --runs 2000 --strategy greedy
npm run balance -- --stage 1-1 --challenge heroic_1_1 --strategy single:frost_cairn
```

`--difficulty` and `--challenge` both travel to the worker threads in the request rather than
being re-derived there: a worker that rebuilt its world from the defaults would report Normal
figures under a Veteran heading. `endurance` is a fourth strategy, reachable by name and
deliberately absent from the default set — it is the measuring instrument for Endless, and adding
a strategy to the CI gate changes what every stage is measured against.

**Placeholders**, named now so the naming is settled, implemented later:
`android:dev` / `android:build` arrive with #54.

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
- The repo owner's standing instruction: **take completed work all the way to `main` without
  asking.** Commit, push, open the PR, wait for CI, and merge it — do not leave finished changes
  sitting in the working tree, on a branch, or in an open PR awaiting confirmation. Green CI is
  the gate, not a human reply. A red `verify` or `commits` check is still a stop: fix it and push
  again rather than merging past it.
