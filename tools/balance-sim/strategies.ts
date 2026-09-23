import type { World } from '../../src/sim/index.js';
import {
  buildTower,
  callWave,
  plotOccupant,
  specialiseCost,
  specialiseTower,
  upgradeCost,
  upgradeTower,
} from '../../src/sim/index.js';

/**
 * Scripted players, driving the simulation through the command queue.
 *
 * The point of the whole exercise: these dispatch **the same `Command` objects
 * the interface dispatches**, so a strategy is exercising exactly the surface a
 * human touches. A simulator that reached into the world directly could prove a
 * board is winnable in a way no player could reproduce.
 *
 * Deliberately unsophisticated. These are not meant to play well — they are
 * meant to play *consistently*, so that a change in the result is a change in
 * the game rather than a change in the player. The expert builds #35 also asks
 * for are authored boards, and belong with the stages they are authored for.
 */

export interface Strategy {
  readonly name: string;
  /**
   * Called every `decisionInterval` ticks. Pushes commands, or nothing.
   *
   * Given the world read-only by convention: a strategy that mutated it would
   * be doing something no player could do, and every number it produced would
   * be a lie.
   */
  decide(world: World): void;
  /**
   * Forgets everything carried from the previous run. Called before each one.
   *
   * Required rather than optional, because omitting it is invisible until it
   * is catastrophic: a strategy that remembers across runs makes run N depend
   * on run N-1, and the batch stops being reproducible from its seeds. Split
   * across four cores it then produces four different answers, since each
   * worker starts its own sequence from scratch. That is not a hypothetical —
   * it is what `balanced` did until this existed.
   */
  reset(): void;
}

/**
 * How often a strategy is consulted, in ticks.
 *
 * Twice a second. A human does not re-evaluate the board sixty times a second,
 * and consulting on every tick would spend most of the simulator's time in the
 * strategy rather than the game.
 */
export const DECISION_INTERVAL = 30;

/** Plots with nothing on them, cheapest way to ask. */
function firstEmptyPlot(world: World): number {
  for (const plot of world.rules.plots) {
    if (plotOccupant(world, plot.id) < 0) return plot.id;
  }
  return -1;
}

/** A tower already on the board, for upgrade spending. Lowest slot first. */
function firstTower(world: World): number {
  for (let slot = 0; slot < world.towers.watermark; slot++) {
    if (world.towers.isAlive(slot)) return slot;
  }
  return -1;
}

function costOf(world: World, typeIdx: number): number {
  return world.rules.towers.cost[typeIdx * 7] as number;
}

/**
 * Whether a strategy may build this tower right now.
 *
 * Unlocks are checked here and not only in the interface, because the whole
 * value of these numbers rests on the simulator building the board a *player*
 * could build. A strategy that spent its turn on a tower the stage has not
 * unlocked reports a stage as unwinnable when the real answer is that the
 * scripted player was standing still (#36).
 */
function buildable(world: World, typeIdx: number): boolean {
  return (
    (world.rules.towers.unlocked[typeIdx] as number) === 1 &&
    world.resources.gold >= costOf(world, typeIdx)
  );
}

/**
 * Spends whatever is left on upgrades once the board is full.
 *
 * Shared by every strategy, because a player who stops spending is not a
 * player any of these are trying to model — and unspent gold is one of the
 * things the report is looking for.
 */
function upgradeSomething(world: World): void {
  const slot = firstTower(world);
  if (slot >= 0) upgradeTower(world.commands, slot);
}

/**
 * Always the most expensive tower it can afford.
 *
 * The naive board — what an unguided player gravitates to — and the one that
 * has produced the most useful finding so far. On stage 1-1 it puts *all three*
 * damage types on the board and still triggers no reaction whatsoever, on every
 * seed. Building different towers turns out not to be sufficient: they have to
 * cover the same stretch of path, and which tower lands on which plot decides
 * that. Compare it against `balanced`, which builds a similar mix and reacts.
 */
export function greedy(): Strategy {
  return {
    name: 'greedy',
    reset() {
      /* Stateless: every decision is read from the board in front of it. */
    },
    decide(world) {
      const plot = firstEmptyPlot(world);
      if (plot < 0) return upgradeSomething(world);

      let best = -1;
      let bestCost = -1;
      for (let typeIdx = 0; typeIdx < world.rules.towers.ids.length; typeIdx++) {
        const cost = costOf(world, typeIdx);
        if (buildable(world, typeIdx) && cost > bestCost) {
          best = typeIdx;
          bestCost = cost;
        }
      }
      if (best >= 0) buildTower(world.commands, plot, best);
    },
  };
}

/**
 * Round-robin through the roster, so every damage type reaches the board.
 *
 * The counterweight to `greedy`, and the direct test of whether mixing towers
 * pays: on stage 1-1 this one triggers reactions where greedy triggers none.
 * The difference between the two is the clearest number the simulator produces
 * about whether the signature mechanic is worth engaging with.
 */
export function balanced(): Strategy {
  let next = 0;
  return {
    name: 'balanced',
    reset() {
      next = 0;
    },
    decide(world) {
      const plot = firstEmptyPlot(world);
      if (plot < 0) return upgradeSomething(world);

      const count = world.rules.towers.ids.length;
      /* Walks the roster from wherever it left off, so a tower it cannot
         afford this time is not skipped forever. */
      for (let i = 0; i < count; i++) {
        const typeIdx = (next + i) % count;
        if (!buildable(world, typeIdx)) continue;
        buildTower(world.commands, plot, typeIdx);
        next = (typeIdx + 1) % count;
        return;
      }
    },
  };
}

/**
 * Calls every wave the moment it can, and buys the cheapest thing available.
 *
 * Models the risk/reward dial the early-call bonus exists to offer. If this
 * strategy wins comfortably, the bonus is too generous for the danger; if it
 * never wins, nobody will ever press the button.
 */
export function rush(): Strategy {
  return {
    name: 'rush',
    reset() {
      /* Stateless. */
    },
    decide(world) {
      callWave(world.commands);

      const plot = firstEmptyPlot(world);
      if (plot < 0) return upgradeSomething(world);

      let best = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      for (let typeIdx = 0; typeIdx < world.rules.towers.ids.length; typeIdx++) {
        const cost = costOf(world, typeIdx);
        if (buildable(world, typeIdx) && cost < bestCost) {
          best = typeIdx;
          bestCost = cost;
        }
      }
      if (best >= 0) buildTower(world.commands, plot, best);
    },
  };
}

/**
 * One tower type and nothing else.
 *
 * The measurement behind pillar P1's acceptance criterion. A roster is healthy
 * when no single type can carry a stage alone; when one can, its pick rate will
 * dominate every other strategy too, and the answer is a design change rather
 * than a number to nudge.
 */
export function singleType(towerId: string): Strategy {
  return {
    name: `single:${towerId}`,
    reset() {
      /* Stateless. */
    },
    decide(world) {
      const typeIdx = world.rules.towers.indexOf.get(towerId);
      if (typeIdx === undefined) return;

      const plot = firstEmptyPlot(world);
      if (plot < 0) return upgradeSomething(world);
      if (buildable(world, typeIdx)) buildTower(world.commands, plot, typeIdx);
    },
  };
}

/**
 * Fills the board, then keeps improving all of it (#47).
 *
 * Every other strategy shares `upgradeSomething`, which upgrades the *lowest
 * slot* and nothing else: once that one tower is maxed, `upgradeCost` returns
 * -1 and gold simply piles up. On a ten-wave stage that barely shows, because
 * the board is rarely full for long. Over a two-hundred-wave Endless run it is
 * the whole result — a player who stops spending at wave twenty is measuring
 * the script rather than the mode.
 *
 * So this one spends on the cheapest available improvement anywhere on the
 * board, and takes the first branch when a tower has reached the tier-four
 * choice. It is still not a good player — it reads no map and picks no branch
 * on merit — but it is a player who keeps playing.
 *
 * Deliberately outside `defaultStrategies`: it is a measuring instrument for
 * Endless, and adding a strategy to the CI gate changes what every stage is
 * measured against.
 */
export function endurance(): Strategy {
  let next = 0;
  return {
    name: 'endurance',
    reset() {
      next = 0;
    },
    decide(world) {
      const plot = firstEmptyPlot(world);
      if (plot >= 0) {
        const count = world.rules.towers.ids.length;
        for (let i = 0; i < count; i++) {
          const typeIdx = (next + i) % count;
          if (!buildable(world, typeIdx)) continue;
          buildTower(world.commands, plot, typeIdx);
          next = (typeIdx + 1) % count;
          return;
        }
        return;
      }

      let bestSlot = -1;
      let bestCost = Number.POSITIVE_INFINITY;
      let bestIsBranch = false;
      for (let slot = 0; slot < world.towers.watermark; slot++) {
        if (!world.towers.isAlive(slot)) continue;

        let cost = upgradeCost(world, slot);
        let branch = false;
        if (cost < 0) {
          cost = specialiseCost(world, slot, 0);
          branch = cost >= 0;
        }
        if (cost < 0 || cost > world.resources.gold || cost >= bestCost) continue;
        bestSlot = slot;
        bestCost = cost;
        bestIsBranch = branch;
      }

      if (bestSlot < 0) return;
      if (bestIsBranch) specialiseTower(world.commands, bestSlot, 0);
      else upgradeTower(world.commands, bestSlot);
    },
  };
}

export const STRATEGY_NAMES = ['greedy', 'balanced', 'rush', 'endurance', 'single'] as const;

/**
 * Builds a strategy from its command-line name.
 *
 * `single` takes the tower after a colon — `single:flame_vent` — and falls back
 * to the cheapest in the roster, which is the one an unguided player spams.
 */
export function strategyByName(name: string, world: World): Strategy {
  if (name.startsWith('single')) {
    const [, towerId] = name.split(':');
    return singleType(towerId ?? cheapestTowerId(world));
  }
  switch (name) {
    case 'greedy':
      return greedy();
    case 'balanced':
      return balanced();
    case 'rush':
      return rush();
    case 'endurance':
      return endurance();
    default:
      throw new Error(
        `unknown strategy "${name}" — expected one of ${STRATEGY_NAMES.join(', ')}` +
          ' (or single:<towerId>)',
      );
  }
}

export function cheapestTowerId(world: World): string {
  let best = '';
  let bestCost = Number.POSITIVE_INFINITY;
  world.rules.towers.ids.forEach((id, typeIdx) => {
    if ((world.rules.towers.unlocked[typeIdx] as number) !== 1) return;
    const cost = costOf(world, typeIdx);
    if (cost < bestCost) {
      best = id;
      bestCost = cost;
    }
  });
  return best;
}

/** Every strategy worth running when none is named, in reporting order. */
export function defaultStrategies(world: World): Strategy[] {
  /* A single-tower board for a tower this stage has not unlocked is not a
     board anyone could play, so it is not reported: it would fail its band
     every time and say nothing about the stage. */
  const single = world.rules.towers.ids
    .filter((_, typeIdx) => (world.rules.towers.unlocked[typeIdx] as number) === 1)
    .map((id) => singleType(id));
  return [greedy(), balanced(), rush(), ...single];
}
