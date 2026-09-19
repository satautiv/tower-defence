import type { World } from '../world.js';
import { drainCommandQueue } from './commands.js';
import { movementSystem } from './movement.js';
import { economySystem } from '../economy.js';
import { damageResolutionSystem } from './damage.js';
import { firingSystem } from './firing.js';
import { projectileSystem } from './projectiles.js';
import { targetingSystem } from './targeting.js';
import { waveSpawnerSystem } from './waves.js';

/**
 * The tick pipeline, in order (docs/TECH_DESIGN.md §6.4).
 *
 * Most of these are stubs. #10 establishes the shape and the ordering — which
 * is the part that is expensive to change later — and the issues named on each
 * one fill in the behaviour.
 *
 * Exported as data rather than written as fifteen calls in `tick()` so the
 * order is assertable: a test compares this list against the specification, and
 * a reordering that looked harmless fails there instead of producing a subtly
 * different game.
 */
export interface SimSystem {
  readonly name: string;
  run(world: World): void;
}

const noop = (): void => undefined;

export const SYSTEMS: readonly SimSystem[] = [
  /**
   * 0. Player intent, applied atomically before anything moves.
   *
   * Never mid-pipeline: a build landing halfway through targeting would let a
   * tower fire on the tick it was placed in one run and not in another,
   * depending on when the click arrived. Handlers arrive with #17.
   */
  { name: 'drainCommandQueue', run: drainCommandQueue },

  /** 1. Spawn due enemies and advance wave timers. */
  { name: 'waveSpawner', run: waveSpawnerSystem },

  /**
   * 2. Tick damage over time, decay stacks, expire statuses. #21.
   *
   * Before reactions, so a burn can apply the stack that triggers a reaction on
   * the same tick it lands.
   */
  { name: 'statusSystem', run: noop },

  /**
   * 3. Detect status pairs and resolve reactions. #22.
   *
   * Before movement and before damage, so a Superconduct strips armour in time
   * for this tick's damage to benefit from it.
   */
  { name: 'reactionSystem', run: noop },

  /** 4. Advance path distance, fly straight, apply slows. */
  { name: 'movementSystem', run: movementSystem },

  /** 5. Engage, block, fight, respawn, walk to rally. #24. */
  { name: 'soldierSystem', run: noop },

  /** 6. Hero movement, auto-attack and ability cooldowns. #25. */
  { name: 'heroSystem', run: noop },

  /**
   * 7. Towers pick targets. #13.
   *
   * Also rebuilds the spatial indexes, which has to happen after everything has
   * moved and before anything queries. Towers re-target only when their
   * cooldown elapses or their target dies or leaves range, not every tick.
   */
  { name: 'targetingSystem', run: targetingSystem },

  /** 8. Spawn projectiles, resolve instant beams, pulse auras. */
  { name: 'firingSystem', run: firingSystem },

  /** 9. Advance projectiles, collide, queue on-hit damage. */
  { name: 'projectileSystem', run: projectileSystem },

  /** 10. Lingering pools, fields, lava, burning ground. #31. */
  { name: 'groundEffectSystem', run: noop },

  /**
   * 11. Resolve the whole damage queue, then the deaths it caused. #14.
   *
   * The single place damage is applied. Deaths are deferred until the queue has
   * drained, so nothing dies mid-pipeline and the result does not depend on
   * which system fired first.
   */
  { name: 'damageResolution', run: damageResolutionSystem },

  /** 12. Bounty, Aether charge, wave-clear and early-call bonuses. #15. */
  { name: 'economySystem', run: economySystem },

  /** 13. Leak detection, lives, win and loss conditions. #16. */
  { name: 'lifecycleSystem', run: noop },

  /**
   * 14. The tick's output is complete.
   *
   * Deliberately does not clear the event buffer. At 2x and 3x speed several
   * ticks run per frame, and the view and audio layers drain once afterwards —
   * clearing here would throw away every tick's events but the last. The
   * consumer clears after draining.
   */
  { name: 'flushEvents', run: noop },
];

/** The order the pipeline must run in. Compared against SYSTEMS by a test. */
export const SYSTEM_ORDER: readonly string[] = [
  'drainCommandQueue',
  'waveSpawner',
  'statusSystem',
  'reactionSystem',
  'movementSystem',
  'soldierSystem',
  'heroSystem',
  'targetingSystem',
  'firingSystem',
  'projectileSystem',
  'groundEffectSystem',
  'damageResolution',
  'economySystem',
  'lifecycleSystem',
  'flushEvents',
];
