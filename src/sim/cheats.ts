import { MAX_ACTIVE_WAVES, MAX_GROUPS_PER_WAVE } from './capacity.js';
import type { World } from './world.js';

/**
 * The dev overlay's cheats (#41), and the one place they may live.
 *
 * Nothing that ships imports this file. It sits in `sim/` all the same, and
 * that placement is the whole decision. The project's rule is that only the
 * simulation mutates the world — the interface dispatches commands and the
 * balance simulator takes the same route — and a cheat is by definition a
 * mutation with no command behind it. Two ways out were available and both
 * were worse: writing to the world from `devtools/` would make "only sim/
 * mutates the world" false, and adding cheat commands to `CommandKind` would
 * put a give-gold path in the shipped command handler, where a player could
 * reach it and where it would cost real bytes.
 *
 * So the mutations stay inside `sim/`, in a module the barrel does not export
 * and ESLint forbids every shipping layer from importing. Rollup never emits
 * it, `tests/guardrails.test.ts` proves the ban fires, and the invariant holds
 * as written.
 *
 * Each cheat sets up state and lets the ordinary systems draw the conclusion,
 * rather than reimplementing them. `skipWave` is the clearest case: it marks
 * the wave's groups fully spawned and empties the board, and the spawner's own
 * `completeWave` pays the clear bonus and emits `WaveCleared` on the next tick,
 * exactly as it would have if the player had killed everything.
 *
 * A cheated run is not reproducible from its seed. That is not a defect to fix
 * — it is what a cheat is — but it does mean a replay recorded across one is
 * worthless, which the overlay says on screen next to the buttons.
 */

/** Gold, from nowhere. Negative amounts are allowed and clamp at zero. */
export function giveGold(world: World, amount: number): void {
  world.resources.gold = Math.max(0, world.resources.gold + amount);
}

/** Lives, set rather than added: the useful question is "survive at 1". */
export function setLives(world: World, lives: number): void {
  world.resources.lives = Math.max(0, Math.floor(lives));
}

/**
 * Every tower buildable, whatever the stage unlocked or the challenge banned.
 *
 * Writes the same mask `placeTower` already refuses on, so the build menu and
 * the command handler agree without either of them learning about cheats.
 */
export function unlockEverything(world: World): void {
  world.rules.towers.unlocked.fill(1);
}

/**
 * Ends every wave in flight.
 *
 * Marks each active wave's groups fully spawned and empties the board. The
 * wave spawner sees a wave that has finished spawning with nothing left alive
 * from it and completes it through its ordinary path — bonus, event and all.
 *
 * Enemies are freed rather than damaged. Killing them would pay bounty, split
 * the splitters and drop the carriers' cargo, which is the wave rather than a
 * way past it. A soldier holding one releases itself on the next tick, the
 * same as it does when its enemy dies.
 *
 * Returns false when no wave is running, so the overlay can say nothing
 * happened instead of flashing a button that did nothing.
 */
export function skipWave(world: World): boolean {
  const runner = world.waveRunner;
  const waves = world.rules.waves;

  let skipped = false;
  for (let slot = 0; slot < MAX_ACTIVE_WAVES; slot++) {
    const waveIndex = runner.waveIndex[slot] as number;
    if (waveIndex < 0) continue;
    skipped = true;

    const groupCount = waves.groupCount[waveIndex] as number;
    for (let g = 0; g < groupCount; g++) {
      runner.spawned[slot * MAX_GROUPS_PER_WAVE + g] = waves.groupCountPer[
        waveIndex * MAX_GROUPS_PER_WAVE + g
      ] as number;
    }
  }
  if (!skipped) return false;

  const enemies = world.enemies;
  for (let slot = 0; slot < enemies.watermark; slot++) {
    if (enemies.isAlive(slot)) enemies.free(slot);
  }
  return true;
}
