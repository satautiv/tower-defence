import { GAME_SPEEDS } from '@core/constants';
import { CommandKind } from '../commands.js';
import { emitCommandRejected } from '../events.js';
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

export const enum RejectReason {
  NotImplemented = 0,
  NoSuchWave,
  TooManyWavesActive,
  InvalidSpeed,
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

function applySetSpeed(world: World, speed: number): void {
  if (!(GAME_SPEEDS as readonly number[]).includes(speed)) {
    emitCommandRejected(world.events, CommandKind.SetSpeed, RejectReason.InvalidSpeed);
    return;
  }
  world.speed = speed;
}
