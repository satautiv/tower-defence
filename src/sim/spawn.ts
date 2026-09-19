import { EnemyFlag } from './flags.js';
import { chooseBranch } from './path.js';
import { emitEnemySpawned } from './events.js';
import type { World } from './world.js';

/**
 * Brings an enemy into the world with its authored stats.
 *
 * The one place an enemy is created. Copying the stat block into the pool at
 * spawn means no system walks back to content during a tick, and it is also
 * where per-instance modifiers will be applied — difficulty scaling, an elite
 * variant, a Standard Bearer's aura — without the definition itself changing.
 *
 * Returns the slot, or -1 when the pool is full. A full pool drops the spawn
 * rather than growing, so callers treat -1 as "this enemy does not appear".
 */
export function spawnEnemy(world: World, typeIdx: number, spawnPointIndex: number): number {
  const table = world.rules.enemies;
  if (typeIdx < 0 || typeIdx >= table.ids.length) return -1;

  const spawn = world.rules.spawnPoints[spawnPointIndex];
  if (spawn === undefined) return -1;

  const slot = world.enemies.alloc();
  if (slot < 0) return -1;

  const enemies = world.enemies;
  const hp = table.hp[typeIdx] as number;

  enemies.typeIdx[slot] = typeIdx;
  enemies.spawnPoint[slot] = spawnPointIndex;
  enemies.hp[slot] = hp;
  enemies.maxHp[slot] = hp;
  enemies.speed[slot] = table.speed[typeIdx] as number;
  enemies.armour[slot] = table.armour[typeIdx] as number;
  enemies.ward[slot] = table.ward[typeIdx] as number;
  enemies.overshield[slot] = table.overshield[typeIdx] as number;
  enemies.flags[slot] = (enemies.flags[slot] as number) | (table.flags[typeIdx] as number);

  /* The whole route is fixed now rather than at the fork, so a wave preview can
     be accurate and a replay does not depend on which tick a junction was
     crossed. */
  const path = world.rules.pathById.get(spawn.pathId);
  enemies.pathId[slot] = path === undefined ? spawn.pathId : chooseBranch(path, world.rng);
  enemies.pathDist[slot] = 0;

  /* Placed immediately so a tower can see it on the tick it appears, rather
     than at the origin until movement next runs. */
  if (((enemies.flags[slot] as number) & EnemyFlag.Flying) !== 0) {
    enemies.x[slot] = spawn.x;
    enemies.y[slot] = spawn.y;
  } else {
    const chosen = world.rules.pathById.get(enemies.pathId[slot] as number);
    enemies.x[slot] = chosen === undefined ? spawn.x : (chosen.points[0] as number);
    enemies.y[slot] = chosen === undefined ? spawn.y : (chosen.points[1] as number);
  }

  emitEnemySpawned(
    world.events,
    enemies.ids[slot] as number,
    typeIdx,
    enemies.x[slot] as number,
    enemies.y[slot] as number,
  );
  return slot;
}

/** Looks up an enemy's numeric index by its content id. -1 if unknown. */
export function enemyIndex(world: World, id: string): number {
  return world.rules.enemies.indexOf.get(id) ?? -1;
}
