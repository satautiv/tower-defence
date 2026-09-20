import { TICK_HZ, TILE_SIZE } from '@core/constants';
import type { EffectDefinition } from '@content/schema/common';
import { DAMAGE_INDEX } from './damage.js';
import { DamageFlag } from './damage.js';
import { EnemyFlag } from './flags.js';
import { STATUS_INDEX } from './status.js';
import { createGroundEffect } from './systems/groundEffects.js';
import { forceReaction } from './systems/reactions.js';
import { applyStatus } from './systems/status.js';
import type { World } from './world.js';

/**
 * The eight primitives every ability is built from (#26, docs/TECH_DESIGN.md
 * §7.8).
 *
 * The point is that **a new ability is JSON, not code**. Five Warden Powers,
 * sixteen tower capstones and nine hero abilities all compose from this list,
 * and the rule that keeps it honest is: when something cannot be expressed,
 * add a primitive here rather than a special case anywhere else. A special
 * case is invisible to the next person and multiplies.
 *
 * Effects are resolved into these flat records once at load, so casting one
 * reads numbers rather than a JSON object — the same bargain the ruleset makes
 * for everything else.
 */

export const enum EffectKind {
  DamageInRadius = 0,
  ApplyStatusInRadius,
  CreateGroundEffect,
  ModifyStat,
  ForceReactions,
  BlockPath,
  TauntInRadius,
  SpawnEntity,
}

export const enum ModifiedStat {
  Damage = 0,
  FireRate,
  Armour,
  Ward,
  Defence,
  Speed,
  ChillDecay,
  GoldPerKill,
  ReactionPower,
  ReactionCooldown,
  TowerDamage,
}

const STAT_INDEX: Readonly<Record<string, number>> = {
  damage: ModifiedStat.Damage,
  fireRate: ModifiedStat.FireRate,
  armour: ModifiedStat.Armour,
  ward: ModifiedStat.Ward,
  defence: ModifiedStat.Defence,
  speed: ModifiedStat.Speed,
  chillDecay: ModifiedStat.ChillDecay,
  goldPerKill: ModifiedStat.GoldPerKill,
  reactionPower: ModifiedStat.ReactionPower,
  reactionCooldown: ModifiedStat.ReactionCooldown,
  towerDamage: ModifiedStat.TowerDamage,
};

/**
 * One effect, in the units the simulation works in.
 *
 * A plain record of numbers built once at load — not a JSON object, and with
 * no string ids left in it, which is what the no-JSON-in-a-tick rule is
 * actually protecting. Casting an ability happens a handful of times a stage,
 * not per entity per tick.
 */
export interface ResolvedEffect {
  readonly kind: EffectKind;
  /** World pixels. */
  readonly radius: number;
  readonly amount: number;
  readonly damageType: number;
  readonly statusId: number;
  readonly statusStacks: number;
  readonly ticks: number;
  readonly intervalTicks: number;
  readonly multiplier: number;
  readonly flat: number;
  readonly charges: number;
  readonly slowMultiplier: number;
  readonly blocks: boolean;
  readonly stat: number;
  /** Enemy type index for a spawn, or -1. */
  readonly entityType: number;
  readonly count: number;
}

const KIND_INDEX: Readonly<Record<string, EffectKind>> = {
  damage_in_radius: EffectKind.DamageInRadius,
  apply_status_in_radius: EffectKind.ApplyStatusInRadius,
  create_ground_effect: EffectKind.CreateGroundEffect,
  modify_stat: EffectKind.ModifyStat,
  force_reactions: EffectKind.ForceReactions,
  block_path: EffectKind.BlockPath,
  taunt_in_radius: EffectKind.TauntInRadius,
  spawn_entity: EffectKind.SpawnEntity,
};

/**
 * Turns an authored effect into numbers, once, at load.
 *
 * `enemyIndexOf` resolves a spawn's enemy id, and is passed rather than looked
 * up so this stays usable before the world exists.
 */
export function resolveEffect(
  effect: EffectDefinition,
  enemyIndexOf: (id: string) => number,
): ResolvedEffect {
  const params = effect.params as Record<string, unknown>;
  const number = (key: string, fallback = 0): number =>
    typeof params[key] === 'number' ? (params[key] as number) : fallback;
  const flag = (key: string): boolean => params[key] === true;
  const text = (key: string): string | undefined =>
    typeof params[key] === 'string' ? (params[key] as string) : undefined;

  const status = text('status');
  const entity = text('entity');
  const damageType = text('damageType') ?? 'arcane';
  const stat = text('stat');

  return {
    kind: KIND_INDEX[effect.kind] ?? EffectKind.DamageInRadius,
    radius: number('radiusTiles') * TILE_SIZE,
    amount: number('damage'),
    damageType: DAMAGE_INDEX[damageType as keyof typeof DAMAGE_INDEX] ?? DAMAGE_INDEX.arcane,
    statusId: status === undefined ? 255 : STATUS_INDEX[status as keyof typeof STATUS_INDEX],
    statusStacks: number('stacks', 1),
    ticks: Math.round(number('durationSeconds') * TICK_HZ),
    intervalTicks: Math.max(1, Math.round(number('intervalSeconds', 1) * TICK_HZ)),
    multiplier: number('multiplier', 1),
    flat: number('flat'),
    charges: number('charges'),
    slowMultiplier: number('slowMultiplier', 1),
    blocks: flag('blocks'),
    stat: stat === undefined ? -1 : (STAT_INDEX[stat] ?? -1),
    entityType: entity === undefined ? -1 : enemyIndexOf(entity),
    count: number('count', 1),
  };
}

/**
 * Carries out a list of effects at a point.
 *
 * Order is the authored order, because an ability that damages and then
 * applies a status is a different ability from one that does the reverse — the
 * status changes what the damage meets.
 */
export function runEffects(
  world: World,
  effects: readonly ResolvedEffect[],
  x: number,
  y: number,
): void {
  for (const effect of effects) runEffect(world, effect, x, y);
}

function runEffect(world: World, effect: ResolvedEffect, x: number, y: number): void {
  switch (effect.kind) {
    case EffectKind.DamageInRadius:
      damageInRadius(world, effect, x, y);
      break;
    case EffectKind.ApplyStatusInRadius:
      forEachEnemyIn(world, x, y, effect.radius, (enemy) => {
        applyStatus(world, enemy, effect.statusId, effect.statusStacks);
      });
      break;
    case EffectKind.CreateGroundEffect:
    case EffectKind.BlockPath:
      createGroundEffect(world, {
        x,
        y,
        radiusTiles: effect.radius / TILE_SIZE,
        seconds: effect.ticks / TICK_HZ,
        intervalSeconds: effect.intervalTicks / TICK_HZ,
        damagePerSecond: effect.amount,
        damageType: effect.damageType,
        statusId: effect.statusId,
        statusStacks: effect.statusStacks,
        slowMultiplier: effect.slowMultiplier,
        /* A Rift Seal is a blocking patch of ground and nothing else, which is
           why it needs no primitive of its own. */
        blocks: effect.blocks || effect.kind === EffectKind.BlockPath,
      });
      break;
    case EffectKind.ModifyStat:
      modifyStat(world, effect, x, y);
      break;
    case EffectKind.ForceReactions:
      forEachEnemyIn(world, x, y, effect.radius, (enemy) => {
        /* Aether Siphon's whole point: every valid reaction at once, with the
           per-enemy lockout set aside. */
        forceReaction(world, enemy, true);
      });
      break;
    case EffectKind.TauntInRadius:
      taunt(world, effect, x, y);
      break;
    case EffectKind.SpawnEntity:
      /* Carriers and summons arrive with #29; nothing authored uses this yet,
         and a silent no-op is better than a half-implementation that looks
         like it works. */
      break;
    default:
      break;
  }
}

/**
 * Damage now, or spread over time.
 *
 * Over-time damage becomes a patch of ground rather than per-enemy state,
 * which is why it needs no machinery of its own: a lingering burn on a point
 * is what a ground effect already is.
 */
function damageInRadius(world: World, effect: ResolvedEffect, x: number, y: number): void {
  if (effect.ticks > 0) {
    createGroundEffect(world, {
      x,
      y,
      radiusTiles: effect.radius / TILE_SIZE,
      seconds: effect.ticks / TICK_HZ,
      intervalSeconds: effect.intervalTicks / TICK_HZ,
      damagePerSecond: effect.amount / (effect.ticks / TICK_HZ),
      damageType: effect.damageType,
    });
    return;
  }

  forEachEnemyIn(world, x, y, effect.radius, (enemy) => {
    world.damage.push(enemy, effect.amount, effect.damageType, -1, DamageFlag.None);
  });
}

/**
 * A temporary change to a stat.
 *
 * Only the enemy-facing stats are wired: the tower-facing ones (`damage`,
 * `fireRate`, `goldPerKill`) belong to tier-5 capstones, which are #32, and a
 * capstone that silently did nothing would be worse than one that does not
 * exist yet.
 */
function modifyStat(world: World, effect: ResolvedEffect, x: number, y: number): void {
  if (effect.stat === ModifiedStat.ReactionPower) {
    world.reactionPower *= effect.multiplier;
    return;
  }

  const until = world.tick + effect.ticks;
  const isDefence =
    effect.stat === ModifiedStat.Defence ||
    effect.stat === ModifiedStat.Armour ||
    effect.stat === ModifiedStat.Ward;
  if (!isDefence) return;

  forEachEnemyIn(world, x, y, effect.radius, (enemy) => {
    /* The same generic softening a Superconduct sets, so the damage formula
       does not have to know which effect did it. */
    world.enemies.defenceMultiplier[enemy] = effect.multiplier;
    world.enemies.defenceMultiplierUntil[enemy] = until;
  });
}

/**
 * Pulls nearby ground enemies onto the soldiers holding the line.
 *
 * Implemented as a block that the soldier system then owns: a taunted enemy is
 * one that has stopped advancing, which is the same state blocking produces,
 * so it reuses the same release valve rather than inventing a second one.
 */
function taunt(world: World, effect: ResolvedEffect, x: number, y: number): void {
  const until = world.tick + effect.ticks;
  forEachEnemyIn(world, x, y, effect.radius, (enemy) => {
    const flags = world.enemies.flags[enemy] as number;
    if ((flags & EnemyFlag.Flying) !== 0) return;
    world.enemies.flags[enemy] = flags | EnemyFlag.Blocked;
    /* Held until the taunt lapses, even if no soldier is holding it: the
       banner is the thing doing the holding. */
    if (until > (world.enemies.blockUntilTick[enemy] as number)) {
      world.enemies.blockUntilTick[enemy] = until;
    }
  });
}

/**
 * Every live enemy within a radius.
 *
 * Reads the spatial index, which is rebuilt at step 7. An ability cast between
 * ticks therefore sees positions as of the last rebuild — a pixel or two, and
 * identical in every run.
 */
function forEachEnemyIn(
  world: World,
  x: number,
  y: number,
  radius: number,
  visit: (enemy: number) => void,
): void {
  const buffer = world.queryBuffer;

  for (const index of [world.groundIndex, world.airIndex]) {
    const found = index.query(x, y, radius, buffer);
    for (let i = 0; i < found; i++) {
      const enemy = buffer[i] as number;
      if (!world.enemies.isAlive(enemy)) continue;
      const flags = world.enemies.flags[enemy] as number;
      if ((flags & (EnemyFlag.Dying | EnemyFlag.Leaked | EnemyFlag.Burrowed)) !== 0) continue;
      visit(enemy);
    }
  }
}
