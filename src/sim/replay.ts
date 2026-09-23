import { tick } from './tick.js';
import type { World } from './world.js';

/**
 * A run, as a seed and an ordered command list (#41).
 *
 * `commands.ts` already names this in its own header: nothing outside the
 * simulation mutates the world, every intent arrives as a command, and commands
 * are applied at a tick boundary rather than mid-pipeline. Those three
 * properties are exactly what makes a replay possible, and they were paid for
 * long before this file existed — so a replay is a *reading* of the design
 * rather than machinery bolted on to support one.
 *
 * It lives in `sim/` rather than with the dev overlay that drives it, because
 * a replay is not a debugging toy: it is how a bug report becomes a test, and
 * how the balance simulator could be handed a human's run to re-examine. The
 * overlay's buttons are stripped from a production build; this is forty lines
 * of arithmetic and stays.
 *
 * What a replay does *not* carry is the world. A snapshot (#39) is the state at
 * one instant and is large; this is the whole run and is tiny, and it can only
 * be replayed from the beginning. They answer different questions.
 */

/** One command, and the tick it was applied on. */
export interface ReplayCommand {
  readonly tick: number;
  readonly kind: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
}

export interface Replay {
  readonly stageId: string;
  readonly seed: number;
  /**
   * How the world has to be *built* before the commands mean anything.
   *
   * The same fields a snapshot carries, and for the same reason: a run played
   * on Veteran against a nine-tower roster is not the same run replayed on
   * Normal, and nothing in the command list says so.
   */
  readonly modeId: string | undefined;
  readonly progressStageId: string | undefined;
  /** Ticks the run lasted, so playback knows when to stop. */
  readonly ticks: number;
  readonly commands: readonly ReplayCommand[];
}

export interface ReplayHeader {
  readonly stageId: string;
  readonly modeId?: string;
  readonly progressStageId?: string;
}

/**
 * Collects the commands a run issues.
 *
 * `observe` reads the queue **before** the tick that will drain it, which is
 * the only moment the commands for that tick exist: `drainCommandQueue` clears
 * them at the end of step 0. The stage screen already has the hook — the
 * `beforeTick` callback it uses to snapshot positions for interpolation.
 */
export class ReplayRecorder {
  private readonly commands: ReplayCommand[] = [];
  private lastTick = 0;

  observe(world: World): void {
    this.lastTick = world.tick;
    for (let i = 0; i < world.commands.count; i++) {
      const command = world.commands.at(i);
      this.commands.push({
        tick: world.tick,
        kind: command.kind,
        a: command.a,
        b: command.b,
        c: command.c,
        d: command.d,
        e: command.e,
      });
    }
  }

  get count(): number {
    return this.commands.length;
  }

  finish(header: ReplayHeader, seed: number): Replay {
    return {
      stageId: header.stageId,
      seed,
      modeId: header.modeId,
      progressStageId: header.progressStageId,
      /* Inclusive of the last tick observed: a run that issued its final
         command on tick 900 has to be replayed through tick 900. */
      ticks: this.lastTick + 1,
      commands: [...this.commands],
    };
  }

  reset(): void {
    this.commands.length = 0;
    this.lastTick = 0;
  }
}

/**
 * Replays a run into a world built the same way.
 *
 * The caller builds the world, because building one needs the content registry
 * and `sim/` does not load content — the same split `restoreWorld` takes.
 *
 * Refuses a replay of another stage or another seed rather than producing a
 * run that merely looks plausible. A command list is positional: `BuildTower`
 * carries a plot id and a tower index, and both mean something different on a
 * different stage.
 */
export function playReplay(world: World, replay: Replay, stageId: string): void {
  if (replay.stageId !== stageId) {
    throw new Error(`replay is of stage ${replay.stageId}, not ${stageId}`);
  }
  if (replay.seed !== world.config.seed) {
    throw new Error(`replay is of seed ${replay.seed}, not ${world.config.seed}`);
  }

  /* Walked with a cursor rather than filtered per tick: the list is already in
     tick order, so a thousand-tick run costs one pass instead of a thousand. */
  let next = 0;
  for (let t = 0; t < replay.ticks; t++) {
    while (next < replay.commands.length) {
      const command = replay.commands[next];
      if (command === undefined || command.tick > t) break;
      world.commands.push(command.kind, command.a, command.b, command.c, command.d, command.e);
      next++;
    }
    tick(world);
    if (world.finished) break;
  }
}
