/**
 * Per-entity bit flags.
 *
 * Packed into a Uint16Array rather than kept as booleans on an object: the
 * systems test several of these per entity per tick, and a bitmask keeps that
 * to one array read instead of chasing an object's properties.
 */
export const enum EnemyFlag {
  None = 0,
  /** Occupies its slot. A slot without this is free and must be skipped. */
  Alive = 1 << 0,
  /** Ignores the ground path; flies straight to the core. */
  Flying = 1 << 1,
  /** Underground for an authored path segment — untargetable, still moving. */
  Burrowed = 1 << 2,
  /** Bosses and elites: no hard crowd control, slows capped instead. */
  FreezeImmune = 1 << 3,
  StunImmune = 1 << 4,
  /** Held by a soldier or the hero; pathDist stops advancing. */
  Blocked = 1 << 5,
  /** Armour applies from the front only; struck from behind it is far weaker. */
  DirectionalArmour = 1 << 6,
  /** Queued to die in step 11. Set once, so nothing dies twice. */
  Dying = 1 << 7,
  /** Reached the core. Costs lives rather than awarding bounty. */
  Leaked = 1 << 8,
  Boss = 1 << 9,
  /**
   * Goes underground on an authored path segment.
   *
   * A property of the enemy, not of the road: the segment exists for everyone
   * who walks it, and without this every Husk on the map would vanish through
   * the Burrower's tunnel (#29).
   */
  CanBurrow = 1 << 10,
}

/**
 * What an enemy *does*, as opposed to what state it is in (#29).
 *
 * Kept off `EnemyFlag` and held on the enemy table rather than per entity: a
 * behaviour is a property of the type and never varies between two Menders, so
 * storing it per instance would be sixteen bits of duplicated constant on every
 * slot and sixteen more to fingerprint. `EnemyFlag` is also nearly full, and
 * the things living there — Blocked, Dying, Leaked — are exactly the ones that
 * *do* change per enemy per tick.
 *
 * The mask exists so the behaviour system can reject the overwhelming majority
 * of enemies, which have no behaviour at all, in one test.
 */
export const enum BehaviourFlag {
  None = 0,
  /** Mender: heals the most-damaged allies in radius. */
  Healer = 1 << 0,
  /** Shieldwright: grants an overshield to allies on an interval. */
  Shielder = 1 << 1,
  /** Nullifier: towers in radius fire more slowly. */
  TowerSlowAura = 1 << 2,
  /** Standard Bearer: allies in radius move faster and gain armour. */
  AllyHasteAura = 1 << 3,
  /** Sapper: disables the tower whose plot it reaches. */
  Sapper = 1 << 4,
  /** Carrier: drops an enemy onto the ground path beneath it. */
  Carrier = 1 << 5,
  /** Rift Sprout: never moves, spawns until killed. */
  StationarySpawner = 1 << 6,
  /** Phase Stalker: jumps forward when a single hit lands hard enough. */
  Phase = 1 << 7,
}

/** Behaviours that fire on their own clock rather than continuously. */
export const PERIODIC_BEHAVIOURS =
  BehaviourFlag.Shielder | BehaviourFlag.Carrier | BehaviourFlag.StationarySpawner;

/** Behaviours that sweep a radius every tick and must be recomputed from nothing. */
export const AURA_BEHAVIOURS =
  BehaviourFlag.Healer | BehaviourFlag.TowerSlowAura | BehaviourFlag.AllyHasteAura;

/**
 * What a tower's *branch* does, beyond what its numbers do (#32).
 *
 * Keyed by stat index on the tower table rather than held per tower, for the
 * same reason enemy behaviours are keyed by type: a perk belongs to the tier,
 * never to the instance, and two Prism Towers refract identically. Resolving
 * it per tier also means an upgrade picks up its new perks through
 * `applyTowerStats` with nothing else to remember.
 *
 * The mask exists so the damage formula, the firing loop and the death pass
 * can each reject an ordinary tower in one test.
 */
export const enum TowerPerk {
  None = 0,
  /** Ignores a fraction of armour, where `armourPierce` is a flat subtraction. */
  PierceFraction = 1 << 0,
  /** Hits harder into a status — Pyroclast Vent against Corroded. */
  BonusVsStatus = 1 << 1,
  /** Rime Spire: its Chill eats armour instead of only slowing. */
  ChillSunders = 1 << 2,
  /** Storm Pylon: an enemy at the Charge cap is frozen and discharged. */
  DischargeAtCap = 1 << 3,
  /** A corpse hands its status to its neighbours. */
  SpreadOnDeath = 1 << 4,
  /** Leaves a patch of ground where the shot landed. */
  LeavesGround = 1 << 5,
  /** Glacier Heart: a periodic Freeze on everything in reach. */
  FreezePulse = 1 << 6,
  /** Plasma Lance: the beam carries on through what it hits. */
  Piercing = 1 << 7,
  /** Void Obelisk: drags what it hits back down the path. */
  Pulls = 1 << 8,
  /** Prism Tower: borrows its neighbours' damage types. */
  Refracts = 1 << 9,
  /** Gilded Alembic: every bounty on the board pays more. */
  GlobalGold = 1 << 10,
  /** Bulwark Order. */
  Taunts = 1 << 11,
  Reflects = 1 << 12,
  /** Ranger Lodge: what it shoots takes more from everything. */
  MarksTarget = 1 << 13,
}

export const enum TowerFlag {
  None = 0,
  Alive = 1 << 0,
  /** Disabled by a sapper; holds fire until the timer expires. */
  Disabled = 1 << 1,
}

export const enum ProjectileFlag {
  None = 0,
  Alive = 1 << 0,
  /** Damages everything in its blast radius rather than one target. */
  Splash = 1 << 1,
  /** Passes through targets instead of expiring on the first hit. */
  Piercing = 1 << 2,
  /** Arcs to a point on the ground; does not track a moving target. */
  Ballistic = 1 << 3,
}

export const enum SoldierFlag {
  None = 0,
  Alive = 1 << 0,
  /** Engaged with an enemy; holds position. */
  Engaged = 1 << 1,
  /** Dead and counting down to respawn. */
  Respawning = 1 << 2,
  /** The hero, which reuses the soldier blocking code with different stats. */
  Hero = 1 << 3,
}

export const enum GroundEffectFlag {
  None = 0,
  Alive = 1 << 0,
  /** Blocks ground movement rather than damaging, e.g. Rift Seal. */
  Blocking = 1 << 1,
}

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}
