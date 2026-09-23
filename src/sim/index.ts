export { World, StagePhase, createWorldForStage } from './world.js';
export type { WorldConfig, Resources, WaveState } from './world.js';
export { tick, advance } from './tick.js';
export { SYSTEMS, SYSTEM_ORDER } from './systems/index.js';
export type { SimSystem } from './systems/index.js';
export { hashWorld } from './hash.js';
export { captureWorld, restoreWorld, snapshotKeys, SNAPSHOT_VERSION } from './snapshot.js';
export type { WorldSnapshot } from './snapshot.js';
export { buildRuleset, EMPTY_RULESET } from './ruleset.js';
export { DEFAULT_DIFFICULTY, resolveDifficulty } from './ruleset.js';
export type { ResolvedDifficulty, ResolvedChallenge, StartingTower } from './ruleset.js';
export type {
  Ruleset,
  RulesetOptions,
  EnemyTable,
  StatusTable,
  ReactionTable,
  HeroRules,
  SpawnPoint,
} from './ruleset.js';
export { MAX_HERO_LEVEL, buildHeroRules } from './ruleset.js';
export { BakedPath, chooseBranch, laneOffsetFor } from './path.js';
export type { PathSample, PathBranch } from './path.js';
export { spawnEnemy, enemyIndex } from './spawn.js';
export { movementSystem, speedMultiplier } from './systems/movement.js';
export { ActiveWaves, describeWave, earlyCallBonus } from './waves.js';
export type { WavePreview, WaveGroupPreview } from './waves.js';
export { waveSpawnerSystem, startWave } from './systems/waves.js';
export { drainCommandQueue, RejectReason } from './systems/commands.js';
export { targetingSystem, pickTarget, canTarget, canTargetAny } from './systems/targeting.js';
export { behaviourSystem } from './systems/behaviours.js';
export { firingSystem } from './systems/firing.js';
export { projectileSystem } from './systems/projectiles.js';
export { damageResolutionSystem, effectiveDefence } from './systems/damage.js';
export { statusSystem, applyStatus } from './systems/status.js';
export { soldierSystem, moveRally, setRallyPoint, release } from './systems/soldiers.js';
export { groundEffectSystem, createGroundEffect } from './systems/groundEffects.js';
export { heroSystem, orderHero, castHeroAbilityAt, HeroCastResult } from './systems/hero.js';
export type { GroundEffectSpec } from './systems/groundEffects.js';
export { reactionSystem, forceReaction } from './systems/reactions.js';
export { runEffects, resolveEffect, EffectKind, ModifiedStat } from './effects.js';
export type { ResolvedEffect } from './effects.js';
export {
  addGold,
  spendGold,
  canAfford,
  addAether,
  spendAether,
  buildCost,
  upgradeCost,
  specialiseCost,
  sellValue,
  economySystem,
  awardKill,
  awardReactionAether,
  bonusGoldFor,
} from './economy.js';
export {
  raiseTowerTier,
  setTowerSpecialisation,
  removeTower,
  plotOccupant,
  placeStartingTowers,
} from './towers.js';
export { lifecycleSystem, starsFor, stageResult } from './systems/lifecycle.js';
export type { StageResult } from './systems/lifecycle.js';
export type { StageStats, UndoableBuild } from './world.js';
export {
  towerInfo,
  buildOptions,
  powerOptions,
  heroInfo,
  plotInfo,
  rangeOf,
  prospectiveRange,
  canUndo,
  undoSecondsRemaining,
  nextWave,
  threatsOf,
  THREAT_TAGS,
  enemyInfo,
  bossInfo,
  enemyNear,
} from './inspect.js';
export type {
  EnemyInfo,
  BossInfo,
  EnemyStatus,
  NextWave,
  WaveEnemy,
  ThreatTag,
  TowerInfo,
  BuildOption,
  PowerOption,
  HeroInfo,
  HeroAbilityInfo,
  PlotInfo,
  TierStats,
  UpgradeOption,
  SpecialisationOption,
} from './inspect.js';
export type { BuildPlot } from './ruleset.js';
export {
  placeTower,
  towerIndex,
  tierSlot,
  applyTowerStats,
  statIndexOf,
  TargetMode,
} from './towers.js';
export { TIER_SLOTS, FiringMode, TargetClass, REACTION_ANY } from './ruleset.js';
export type { TowerTable } from './ruleset.js';

export { CommandQueue, CommandKind } from './commands.js';
export * from './commands.js';
export { undoBuild } from './commands.js';
export { SimEvents, SimEventKind } from './events.js';
export * from './events.js';

export { DamageQueue, DeathList, DamageFlag, DAMAGE_INDEX, DAMAGE_BY_INDEX } from './damage.js';
export {
  EnemyFlag,
  BehaviourFlag,
  TowerFlag,
  ProjectileFlag,
  SoldierFlag,
  GroundEffectFlag,
  PlayRestriction,
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
