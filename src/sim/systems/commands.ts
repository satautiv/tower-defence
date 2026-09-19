import { GAME_SPEEDS } from '@core/constants';
import { CommandKind } from '../commands.js';
import {
  addGold,
  buildCost,
  sellValue,
  specialiseCost,
  spendGold,
  upgradeCost,
} from '../economy.js';
import { emitCommandRejected } from '../events.js';
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
  MustSpecialise,
  NotReadyToSpecialise,
  PoolFull,
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
        applyBuild(world, command.a, command.b);
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

      case CommandKind.SetTargetMode:
        applyTargetMode(world, command.a, command.b);
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

function applyBuild(world: World, plotId: number, typeIdx: number): void {
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

  if (placeTower(world, typeIdx, plot.x, plot.y, plotId) < 0) {
    addGold(world, cost, false);
    reject(world, CommandKind.BuildTower, RejectReason.PoolFull);
  }
}

function applyUpgrade(world: World, towerSlot: number): void {
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
}

function applySpecialise(world: World, towerSlot: number, branch: number): void {
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
  if (!world.towers.isAlive(towerSlot)) {
    return reject(world, CommandKind.SellTower, RejectReason.NoSuchTower);
  }
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

function applySetSpeed(world: World, speed: number): void {
  if (!(GAME_SPEEDS as readonly number[]).includes(speed)) {
    emitCommandRejected(world.events, CommandKind.SetSpeed, RejectReason.InvalidSpeed);
    return;
  }
  world.speed = speed;
}
