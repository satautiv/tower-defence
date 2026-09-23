import { GAME_SPEEDS, TICK_HZ } from '@core/constants';
import { CommandKind } from '../commands.js';
import { PlayRestriction } from '../flags.js';
import {
  addGold,
  buildCost,
  canAfford,
  sellValue,
  specialiseCost,
  spendAether,
  spendGold,
  upgradeCost,
} from '../economy.js';
import { createGroundEffect } from './groundEffects.js';
import { HeroCastResult, castHeroAbilityAt, orderHero } from './hero.js';
import { moveRally } from './soldiers.js';
import { emitCommandRejected, emitPowerCast } from '../events.js';
import { runEffects } from '../effects.js';
import {
  placeTower,
  plotOccupant,
  raiseTowerTier,
  removeTower,
  setTowerSpecialisation,
} from '../towers.js';
import { earlyCallBonus } from '../waves.js';
import { startWave } from './waves.js';
import type { World } from '../world.js';

/**
 * Applies queued player intent, atomically, before anything else runs.
 *
 * Only the commands whose systems exist are handled. Build, upgrade, sell and
 * the rest arrive with #17; until then they are rejected explicitly rather than
 * ignored, so the UI can say why instead of appearing to swallow a click.
 */

/**
 * Why a command was refused.
 *
 * Every rejection carries one, so the UI can say "you cannot afford that"
 * rather than appearing to swallow the click. A command that silently does
 * nothing is indistinguishable from a bug to the person playing.
 */
export const enum RejectReason {
  NotImplemented = 0,
  NoSuchWave,
  TooManyWavesActive,
  InvalidSpeed,
  NoSuchPlot,
  PlotOccupied,
  NoSuchTower,
  Unaffordable,
  AlreadyMaxTier,
  NothingToUndo,
  UndoWindowExpired,
  TowerChangedSinceBuild,
  MustSpecialise,
  NotReadyToSpecialise,
  PoolFull,
  /** A rally flag was dragged for a tower that keeps no soldiers. */
  NoGarrison,
  /** The map's lever was pulled twice, or the map has none. */
  NoInteractable,
  InteractableSpent,
  NoSuchPower,
  PowerOnCooldown,
  NotEnoughAether,
  NoHero,
  HeroDown,
  AbilityOnCooldown,
  /**
   * The challenge being played forbids it (#45).
   *
   * One reason for all three restrictions rather than three: the rejection
   * event already carries the command kind, so "you cannot sell" and "you
   * cannot upgrade" are the same fact read against two different verbs, and a
   * second enum entry would only invite pairing the wrong one.
   */
  ForbiddenByChallenge,
}

/** Whether the challenge this run is played under forbids something. */
function forbids(world: World, restriction: PlayRestriction): boolean {
  return (world.rules.restrictions & restriction) !== 0;
}

export function drainCommandQueue(world: World): void {
  for (let i = 0; i < world.commands.count; i++) {
    const command = world.commands.at(i);

    switch (command.kind) {
      case CommandKind.CallWave:
        applyCallWave(world);
        break;

      case CommandKind.SetSpeed:
        applySetSpeed(world, command.a);
        break;

      case CommandKind.BuildTower:
        applyBuild(world, command.a, command.b, command.c);
        break;

      case CommandKind.UpgradeTower:
        applyUpgrade(world, command.a);
        break;

      case CommandKind.Specialise:
        applySpecialise(world, command.a, command.b);
        break;

      case CommandKind.SellTower:
        applySell(world, command.a);
        break;

      case CommandKind.UndoBuild:
        applyUndo(world);
        break;

      case CommandKind.SetTargetMode:
        applyTargetMode(world, command.a, command.b);
        break;

      case CommandKind.SetRally:
        applySetRally(world, command.a, command.b, command.c);
        break;

      case CommandKind.UseInteractable:
        applyInteractable(world);
        break;

      case CommandKind.CastPower:
        applyCastPower(world, command.a, command.b, command.c);
        break;

      case CommandKind.MoveHero:
        applyMoveHero(world, command.a, command.b);
        break;

      case CommandKind.CastHeroAbility:
        applyHeroAbility(world, command.a, command.b, command.c);
        break;

      default:
        emitCommandRejected(world.events, command.kind, RejectReason.NotImplemented);
        break;
    }
  }
  world.commands.clear();
}

/**
 * Starts the next wave early and pays for the risk.
 *
 * The bonus is computed from the timer that is being skipped, before the wave
 * starts and resets it — reading it afterwards would always pay zero.
 */
function applyCallWave(world: World): void {
  const next = world.wave.index + 1;
  if (next >= world.rules.waves.count) {
    emitCommandRejected(world.events, CommandKind.CallWave, RejectReason.NoSuchWave);
    return;
  }

  const bonus = earlyCallBonus(world.rules, next, world.wave.autoStartIn);
  if (!startWave(world, next)) {
    emitCommandRejected(world.events, CommandKind.CallWave, RejectReason.TooManyWavesActive);
    return;
  }
  world.resources.gold += bonus;
}

const reject = (world: World, kind: number, reason: RejectReason): void => {
  emitCommandRejected(world.events, kind, reason);
};

function applyBuild(world: World, plotId: number, typeIdx: number, targetMode = 0): void {
  const plot = world.rules.plots.find((candidate) => candidate.id === plotId);
  if (plot === undefined) return reject(world, CommandKind.BuildTower, RejectReason.NoSuchPlot);
  if (plotOccupant(world, plotId) >= 0) {
    return reject(world, CommandKind.BuildTower, RejectReason.PlotOccupied);
  }

  const cost = buildCost(world, typeIdx);
  if (cost < 0) return reject(world, CommandKind.BuildTower, RejectReason.NoSuchTower);

  /* Checked before anything is placed, so a refusal leaves no half-built
     tower and no gold spent. */
  if (!spendGold(world, cost)) {
    return reject(world, CommandKind.BuildTower, RejectReason.Unaffordable);
  }

  const slot = placeTower(world, typeIdx, plot.x, plot.y, plotId);
  if (slot < 0) {
    addGold(world, cost, false);
    reject(world, CommandKind.BuildTower, RejectReason.PoolFull);
    return;
  }

  world.towers.targetMode[slot] = targetMode;
  world.lastBuild.towerSlot = slot;
  world.lastBuild.towerId = world.towers.ids[slot] as number;
  world.lastBuild.cost = cost;
  world.lastBuild.atTick = world.tick;
}

/**
 * Takes back the last build at full price.
 *
 * Full, not the sell refund: misplacing a tower on a touchscreen is a slip, and
 * charging thirty percent for a slip is the kind of small cruelty that makes a
 * game feel hostile. Selling remains the lossy option for changing your mind.
 *
 * Refused once the tower has been upgraded, since the thing being undone is no
 * longer the thing that was built.
 */
function applyUndo(world: World): void {
  if (forbids(world, PlayRestriction.NoRebuilding)) {
    return reject(world, CommandKind.UndoBuild, RejectReason.ForbiddenByChallenge);
  }

  const last = world.lastBuild;
  if (last.towerSlot < 0) {
    return reject(world, CommandKind.UndoBuild, RejectReason.NothingToUndo);
  }

  const window = world.rules.tuning.undoWindowSeconds * TICK_HZ;
  if (world.tick - last.atTick > window) {
    return reject(world, CommandKind.UndoBuild, RejectReason.UndoWindowExpired);
  }

  /* The id guards against the slot having been recycled by a later build. */
  if (
    !world.towers.isAlive(last.towerSlot) ||
    (world.towers.ids[last.towerSlot] as number) !== last.towerId
  ) {
    clearUndo(world);
    return reject(world, CommandKind.UndoBuild, RejectReason.NothingToUndo);
  }

  if ((world.towers.tier[last.towerSlot] as number) !== 0) {
    return reject(world, CommandKind.UndoBuild, RejectReason.TowerChangedSinceBuild);
  }

  addGold(world, last.cost, false);
  world.stats.goldSpent -= last.cost;
  world.stats.towersBuilt -= 1;
  removeTower(world, last.towerSlot);
  clearUndo(world);
}

function clearUndo(world: World): void {
  world.lastBuild.towerSlot = -1;
  world.lastBuild.towerId = -1;
  world.lastBuild.cost = 0;
  world.lastBuild.atTick = -1;
}

function applyUpgrade(world: World, towerSlot: number): void {
  if (forbids(world, PlayRestriction.NoUpgrading)) {
    return reject(world, CommandKind.UpgradeTower, RejectReason.ForbiddenByChallenge);
  }
  if (!world.towers.isAlive(towerSlot)) {
    return reject(world, CommandKind.UpgradeTower, RejectReason.NoSuchTower);
  }

  const cost = upgradeCost(world, towerSlot);
  if (cost < 0) {
    /* Tier two is the end of the base path: the next step is a branch. */
    const atBranchPoint =
      (world.towers.tier[towerSlot] as number) === 2 &&
      (world.towers.specialisation[towerSlot] as number) < 0;
    return reject(
      world,
      CommandKind.UpgradeTower,
      atBranchPoint ? RejectReason.MustSpecialise : RejectReason.AlreadyMaxTier,
    );
  }

  if (!spendGold(world, cost)) {
    return reject(world, CommandKind.UpgradeTower, RejectReason.Unaffordable);
  }
  raiseTowerTier(world, towerSlot, cost);
  /* The undo record is deliberately left in place. An upgraded tower is
     refused with TowerChangedSinceBuild, which tells the player why, rather
     than the blank NothingToUndo they would get if it were cleared here. */
}

/* Specialising is an upgrade wearing a different name: a challenge that
   refused tier three and let a player buy tier four would forbid nothing. */
function applySpecialise(world: World, towerSlot: number, branch: number): void {
  if (forbids(world, PlayRestriction.NoUpgrading)) {
    return reject(world, CommandKind.Specialise, RejectReason.ForbiddenByChallenge);
  }
  if (!world.towers.isAlive(towerSlot)) {
    return reject(world, CommandKind.Specialise, RejectReason.NoSuchTower);
  }

  const cost = specialiseCost(world, towerSlot, branch);
  if (cost < 0) {
    return reject(world, CommandKind.Specialise, RejectReason.NotReadyToSpecialise);
  }
  if (!spendGold(world, cost)) {
    return reject(world, CommandKind.Specialise, RejectReason.Unaffordable);
  }
  setTowerSpecialisation(world, towerSlot, branch, cost);
}

function applySell(world: World, towerSlot: number): void {
  if (forbids(world, PlayRestriction.NoSelling)) {
    return reject(world, CommandKind.SellTower, RejectReason.ForbiddenByChallenge);
  }
  if (!world.towers.isAlive(towerSlot)) {
    return reject(world, CommandKind.SellTower, RejectReason.NoSuchTower);
  }
  if (towerSlot === world.lastBuild.towerSlot) clearUndo(world);
  /* Not income: this is the player's own money coming back. */
  addGold(world, sellValue(world, towerSlot), false);
  removeTower(world, towerSlot);
}

function applyTargetMode(world: World, towerSlot: number, mode: number): void {
  if (!world.towers.isAlive(towerSlot)) {
    return reject(world, CommandKind.SetTargetMode, RejectReason.NoSuchTower);
  }
  world.towers.targetMode[towerSlot] = mode;
  /* Re-picked next tick under the new rule. */
  world.towers.target[towerSlot] = -1;
}

/**
 * Moves a barracks' rally flag.
 *
 * Adjustable mid-wave by design (docs/TECH_DESIGN.md §7.7) — it is how a
 * player redirects a block when a wave goes wrong, and refusing it while
 * enemies are on the board would remove the only reason it is draggable.
 */
function applySetRally(world: World, towerSlot: number, x: number, y: number): void {
  if (!world.towers.isAlive(towerSlot)) {
    return reject(world, CommandKind.SetRally, RejectReason.NoSuchTower);
  }
  if (!moveRally(world, towerSlot, x, y)) {
    return reject(world, CommandKind.SetRally, RejectReason.NoGarrison);
  }
}

/**
 * Pulls the map's one-shot lever.
 *
 * One per stage and one use per run, which is what makes it a decision rather
 * than a rotation (docs/GAME_DESIGN.md §5). Every named effect resolves to a
 * patch of ground with a payload, so a collapsed bridge, a dropped boulder and
 * an ignited vent need no code of their own — only different numbers.
 */
function applyInteractable(world: World): void {
  const lever = world.rules.interactable;
  if (lever === null) {
    return reject(world, CommandKind.UseInteractable, RejectReason.NoInteractable);
  }
  if (world.interactableUsed) {
    return reject(world, CommandKind.UseInteractable, RejectReason.InteractableSpent);
  }
  if (!canAfford(world, lever.cost)) {
    return reject(world, CommandKind.UseInteractable, RejectReason.Unaffordable);
  }

  spendGold(world, lever.cost);
  world.interactableUsed = true;

  createGroundEffect(world, {
    x: lever.x,
    y: lever.y,
    radiusTiles: lever.radiusTiles,
    seconds: lever.seconds,
    damagePerSecond: lever.damagePerSecond,
    damageType: lever.damageType,
    statusId: lever.statusId,
    statusStacks: lever.statusStacks,
    blocks: lever.blocks,
  });
}

/**
 * Casts a Warden Power at a point.
 *
 * Aether and the cooldown are both checked before anything happens, so a
 * refusal costs nothing and leaves no half-cast. The effects themselves are
 * data — this handler knows what a power costs and when it is ready, and
 * nothing at all about what any of them do.
 */
function applyCastPower(world: World, powerIdx: number, x: number, y: number): void {
  const powers = world.rules.powers;
  if (powerIdx < 0 || powerIdx >= powers.count) {
    return reject(world, CommandKind.CastPower, RejectReason.NoSuchPower);
  }
  if (world.tick < (world.powerReadyTick[powerIdx] as number)) {
    return reject(world, CommandKind.CastPower, RejectReason.PowerOnCooldown);
  }
  if (!spendAether(world, powers.cost[powerIdx] as number)) {
    return reject(world, CommandKind.CastPower, RejectReason.NotEnoughAether);
  }

  world.powerReadyTick[powerIdx] = world.tick + (powers.cooldownTicks[powerIdx] as number);
  runEffects(world, powers.effects[powerIdx] ?? [], x, y);
  emitPowerCast(world.events, powerIdx, x, y);
}

function applyMoveHero(world: World, x: number, y: number): void {
  if (!orderHero(world, x, y)) reject(world, CommandKind.MoveHero, RejectReason.NoHero);
}

function applyHeroAbility(world: World, abilityIdx: number, x: number, y: number): void {
  switch (castHeroAbilityAt(world, abilityIdx, x, y)) {
    case HeroCastResult.Cast:
      break;
    case HeroCastResult.OnCooldown:
      reject(world, CommandKind.CastHeroAbility, RejectReason.AbilityOnCooldown);
      break;
    case HeroCastResult.Dead:
      reject(world, CommandKind.CastHeroAbility, RejectReason.HeroDown);
      break;
    default:
      reject(world, CommandKind.CastHeroAbility, RejectReason.NoHero);
      break;
  }
}

function applySetSpeed(world: World, speed: number): void {
  if (!(GAME_SPEEDS as readonly number[]).includes(speed)) {
    emitCommandRejected(world.events, CommandKind.SetSpeed, RejectReason.InvalidSpeed);
    return;
  }
  world.speed = speed;
}
