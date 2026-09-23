import { z } from 'zod';
import { DamageTypeSchema, IdSchema, LocaleKeySchema, Positive, StageIdSchema } from './common.js';

/**
 * A challenge variant of a stage (#45, docs/GAME_DESIGN.md §13).
 *
 * Two kinds, worth one star each:
 *
 *  - **Heroic** is a hand-authored puzzle per map — "only Cryo and Kinetic
 *    towers", "you start with four towers built and no gold", "every enemy has
 *    3x Ward". One clean solution, discoverable.
 *  - **Iron** is the same sentence on every map: survive fifteen waves with no
 *    rebuilding, no selling, and one life.
 *  - **Endless** is the leaderboard mode: waves that do not stop, drawn from
 *    the whole region so late play changes what it sends rather than only how
 *    much health it has.
 *
 * The point of the section is that a challenge costs *data authoring*, not art
 * or code, so everything below resolves into the flat tables `buildRuleset`
 * already produces. Nothing during a tick asks which challenge it is running:
 * a banned tower is a zero in `towers.unlocked`, tripled Ward is a bigger
 * number in the enemy table, and the three refusals are three bits the command
 * handler tests.
 */

export const CHALLENGE_KINDS = ['heroic', 'iron', 'endless'] as const;
export const ChallengeKindSchema = z.enum(CHALLENGE_KINDS);
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/** A tower the challenge hands the player before the first wave. */
const StartingTowerSchema = z.object({
  plotId: z.number().int().nonnegative(),
  tower: IdSchema,
  /**
   * Rungs of the base path, 0 to 2.
   *
   * Deliberately not a specialisation: tier 3 and up is a choice the player
   * makes, and a challenge that made it for them would be handing over a build
   * rather than a starting position.
   */
  tier: z.number().int().min(0).max(2).default(0),
});

export const ChallengeRulesSchema = z.object({
  /**
   * Towers this challenge allows, or every tower the player has unlocked when
   * empty.
   *
   * Resolved into `towers.unlocked`, the mask `placeTower` already refuses
   * against — so the constraint holds for a replay and for the balance
   * simulator's scripted player, not only for the build menu.
   */
  allowedTowers: z.array(IdSchema).default([]),
  /**
   * The same restriction stated by damage type, which is how §13 words it.
   *
   * Intersected with `allowedTowers` rather than replacing it: a challenge may
   * say "only Cryo" and then name the one Kinetic tower it also allows.
   */
  allowedDamageTypes: z.array(DamageTypeSchema).default([]),
  startingTowers: z.array(StartingTowerSchema).default([]),
  /** Overrides the stage's own, after the mode's gold multiplier. */
  startingGold: z.number().int().nonnegative().optional(),
  /** Overrides the mode's lives. Iron's is 1. */
  lives: z.number().int().positive().optional(),
  enemyWardMultiplier: Positive.default(1),
  enemyArmourMultiplier: Positive.default(1),
  enemyHealthMultiplier: Positive.default(1),
  noSelling: z.boolean().default(false),
  noUpgrading: z.boolean().default(false),
  /** Every placement is final: the undo window is closed too. */
  noRebuilding: z.boolean().default(false),
  /**
   * How many waves the run is, when it is not the stage's own count.
   *
   * Iron is "survive fifteen waves" on every map, and Region 1's stages author
   * ten to sixteen — so the limit both truncates and extends, and the
   * extension repeats the authored waves rather than inventing content. Wave
   * scaling is applied per wave *index*, so a repeat at fifteen is already
   * harder than the same wave at three with nothing here to arrange it.
   */
  waveLimit: z.number().int().positive().optional(),
  /**
   * Where the repeats come from when `waveLimit` runs past what the stage
   * authored.
   *
   * `stage` cycles the map's own waves, which is what Iron wants: fifteen
   * waves of the fight the player already knows. `region` cycles every wave in
   * the region, which is what keeps Endless from being a stat wall — wave
   * sixty on Emberfall Ridge sends 1-9's elites rather than the opening
   * riftlings with four times the health.
   */
  waveSource: z.enum(['stage', 'region']).default('stage'),
});

export type ChallengeRules = z.infer<typeof ChallengeRulesSchema>;

export const ChallengeSchema = z.object({
  id: IdSchema,
  stageId: StageIdSchema,
  kind: ChallengeKindSchema,
  nameKey: LocaleKeySchema,
  descriptionKey: LocaleKeySchema,
  rules: ChallengeRulesSchema,
});

export type ChallengeDefinition = z.infer<typeof ChallengeSchema>;
