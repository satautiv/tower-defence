export { World, StagePhase, createWorldForStage } from './world.js';
export type { WorldConfig, Resources, WaveState } from './world.js';
export { tick, advance } from './tick.js';
export { SYSTEMS, SYSTEM_ORDER } from './systems/index.js';
export type { SimSystem } from './systems/index.js';
export { hashWorld } from './hash.js';

export { CommandQueue, CommandKind } from './commands.js';
export * from './commands.js';
export { SimEvents, SimEventKind } from './events.js';
export * from './events.js';

export { DamageQueue, DeathList, DamageFlag, DAMAGE_INDEX, DAMAGE_BY_INDEX } from './damage.js';
export {
  EnemyFlag,
  TowerFlag,
  ProjectileFlag,
  SoldierFlag,
  GroundEffectFlag,
  hasFlag,
} from './flags.js';
export { STATUS_COUNT, STATUS_INDEX, STATUS_BY_INDEX, statusSlot } from './status.js';

export { EnemyPool } from './entities/enemies.js';
export { TowerPool } from './entities/towers.js';
export { ProjectilePool } from './entities/projectiles.js';
export { SoldierPool } from './entities/soldiers.js';
export { GroundEffectPool } from './entities/groundEffects.js';
export { EntityPool } from './entities/pool.js';
export * from './capacity.js';
