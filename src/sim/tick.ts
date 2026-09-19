import type { World } from './world.js';
import { SYSTEMS } from './systems/index.js';
import type { SimSystem } from './systems/index.js';

/**
 * Advances the world by exactly one tick.
 *
 * Allocates nothing: the loop indexes a module-level array and every system
 * writes into preallocated storage. That is the property the whole
 * structure-of-arrays design exists to protect, and it is asserted directly in
 * tests/sim/allocation.test.ts.
 *
 * `world.tick` increments last, so a system runs *as* tick N and any deadline
 * it writes (`world.tick + 72`) is measured from the tick it was set on.
 */
export function tick(world: World): void {
  /* A finished stage has nothing left to simulate. The caller should have
     stopped; returning here means a stray tick cannot award a bounty or leak a
     life after the results screen has already been shown. */
  if (world.finished) return;

  for (let i = 0; i < SYSTEMS.length; i++) {
    (SYSTEMS[i] as SimSystem).run(world);
  }

  world.tick++;
}

/**
 * Runs several ticks.
 *
 * This is how speed works: 3x runs three ticks per frame, it does not make each
 * tick three times longer. Every tick is the same length, so a stage played at
 * 3x reaches an identical state to one played at 1x — just sooner.
 */
export function advance(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) tick(world);
}
