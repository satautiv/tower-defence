import { describe, expect, it } from 'vitest';
import { TICK_HZ } from '@core/constants';
import { buildRegistry } from '@content/loader';
import type { StageDefinition } from '@content/schema/stage';
import { readContentFromDisk } from '../../tools/content/io.js';
import type { World } from '@sim/index';
import {
  EnemyFlag,
  SimEventKind,
  StagePhase,
  callWave,
  createWorldForStage,
  describeWave,
  earlyCallBonus,
  enemyIndex,
  nextWave,
  startWave,
  threatsOf,
  tick,
} from '@sim/index';

/**
 * The wave preview (#28). A loss the player could not have seen coming is an
 * unfair one, so what this reports must be exactly what arrives — that is the
 * test that matters most here, and it is run against every wave of 1-1.
 */

const registry = buildRegistry(readContentFromDisk());
const base = registry.stages.get('1-1');
if (base === undefined) throw new Error('stage 1-1 missing');
const stage: StageDefinition = base;

const worldFor = (definition: StageDefinition = stage): World =>
  createWorldForStage(registry, definition, 1);

type Wave = StageDefinition['waves'][number];
const template = stage.waves[0] as Wave;
const group = (enemy: string, count: number, spawnPoint = 0): Wave['groups'][number] => ({
  ...(template.groups[0] as Wave['groups'][number]),
  enemy,
  count,
  spawnPoint,
});

/** Spawns counted by type while one wave runs, from the event stream. */
function spawnedDuring(world: World, waveIndex: number): Map<string, number> {
  const counts = new Map<string, number>();
  const duration = describeWave(world.rules, waveIndex)?.spawnDurationSeconds ?? 0;
  startWave(world, waveIndex);

  for (let t = 0; t < Math.ceil(duration * TICK_HZ) + 2; t++) {
    tick(world);
    for (let i = 0; i < world.events.count; i++) {
      const event = world.events.at(i);
      if (event.kind !== SimEventKind.EnemySpawned) continue;
      const id = world.rules.enemies.ids[event.b] ?? 'unknown';
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    world.events.clear();
  }
  return counts;
}

describe('what the next wave holds', () => {
  it('starts at wave one, before anything has been called', () => {
    const next = nextWave(worldFor());
    expect(next).toMatchObject({ index: 0, total: stage.waves.length });
    expect(next?.enemies).toEqual([{ enemyId: 'riftling', count: 5, threats: [] }]);
  });

  it('matches what actually spawns, for every wave of the stage', () => {
    for (let index = 0; index < stage.waves.length; index++) {
      const world = worldFor();
      world.wave.index = index - 1;
      const promised = new Map(nextWave(world)?.enemies.map((e) => [e.enemyId, e.count]));

      expect(spawnedDuring(world, index), `wave ${index + 1}`).toEqual(promised);
    }
  });

  it('adds up an enemy that arrives in several groups, from several spawns', () => {
    const doubled: StageDefinition = {
      ...stage,
      spawnPoints: [...stage.spawnPoints, { id: 1, position: { x: 0, y: 8 }, pathId: 0 }],
      waves: [
        {
          ...template,
          groups: [group('husk', 3), group('rift_bat', 2), group('husk', 4, 1)],
        },
      ],
    };

    expect(nextWave(worldFor(doubled))?.enemies).toEqual([
      { enemyId: 'husk', count: 7, threats: [] },
      { enemyId: 'rift_bat', count: 2, threats: ['air'] },
    ]);
  });

  it('is nothing once the stage is over, whatever waves remain', () => {
    const world = worldFor();
    world.phase = StagePhase.Lost;
    expect(nextWave(world)).toBeNull();
  });

  it('is nothing once the last wave has started', () => {
    const world = worldFor();
    world.wave.index = stage.waves.length - 1;
    expect(nextWave(world)).toBeNull();
  });
});

describe('threat tags name the answer the wave needs', () => {
  const threats = (id: string): string[] => {
    const world = worldFor();
    return threatsOf(world, enemyIndex(world, id));
  };

  it('flags flyers as air', () => {
    expect(threats('rift_bat')).toEqual(['air']);
  });

  it('flags armour at the authored threshold, and not below it', () => {
    const world = worldFor();
    const husk = enemyIndex(world, 'husk');
    const revenant = enemyIndex(world, 'ironclad_revenant');

    expect(threats('ironclad_revenant')).toEqual(['armoured']);
    expect(world.rules.enemies.armour[husk]).toBeLessThan(
      world.rules.tuning.previewArmourThreshold,
    );
    expect(threats('husk')).toEqual([]);
    expect(world.rules.enemies.armour[revenant]).toBeGreaterThanOrEqual(
      world.rules.tuning.previewArmourThreshold,
    );
  });

  /* The thresholds are content, not code: moving one moves the tag. */
  it('reads the thresholds from tuning', () => {
    const world = worldFor();
    const husk = enemyIndex(world, 'husk');
    /* A copy: the tuning object is shared by every world built from the registry. */
    const tuned = {
      rules: { ...world.rules, tuning: { ...world.rules.tuning, previewArmourThreshold: 1 } },
    } as World;
    expect(threatsOf(tuned, husk)).toEqual(['armoured']);
    expect(threatsOf(world, husk)).toEqual([]);
  });

  /* No 1-1 enemy is a boss, warded or evasive yet, so a copy of the table
     stands in for the enemies later regions bring. */
  it('flags bosses, high ward and evasion, most pressing first', () => {
    const world = worldFor();
    const husk = enemyIndex(world, 'husk');
    const table = world.rules.enemies;
    const flags = table.flags.slice();
    const ward = table.ward.slice();
    const evasion = table.evasion.slice();
    flags[husk] = (flags[husk] as number) | EnemyFlag.Boss | EnemyFlag.Flying;
    ward[husk] = world.rules.tuning.previewWardThreshold;
    evasion[husk] = 0.2;

    const altered = {
      rules: { ...world.rules, enemies: { ...table, flags, ward, evasion } },
    } as World;
    expect(threatsOf(altered, husk)).toEqual(['boss', 'air', 'warded', 'evasive']);
  });

  it('marks wave five of 1-1 as an air wave and wave seven as an armour wall', () => {
    const world = worldFor();
    world.wave.index = 3;
    expect(nextWave(world)?.enemies.flatMap((e) => e.threats)).toEqual(['air']);
    world.wave.index = 5;
    expect(nextWave(world)?.enemies.flatMap((e) => e.threats)).toEqual(['armoured']);
  });
});

describe('when it comes, and what calling it pays', () => {
  it('counts down in whole seconds to the automatic start', () => {
    const world = worldFor();
    const delay = template.autoStartDelaySeconds;
    expect(nextWave(world)?.startsInSeconds).toBe(delay);

    tick(world);
    /* A fraction of a second gone still reads as the same whole second. */
    expect(nextWave(world)?.startsInSeconds).toBe(delay);
  });

  it('offers exactly the bonus a call would pay', () => {
    const world = worldFor();
    /* Late enough that the bonus is under its cap, so a timing slip of even
       one tick between the offer and the payment would show. */
    for (let t = 0; t < 8 * TICK_HZ; t++) tick(world);

    const offered = nextWave(world)?.callBonus;
    expect(offered).toBeLessThan(world.rules.waves.totalBounty[0] as number);
    expect(offered).toBe(earlyCallBonus(world.rules, 0, world.wave.autoStartIn));

    const before = world.resources.gold;
    callWave(world.commands);
    tick(world);
    expect(world.resources.gold - before).toBe(offered);
  });

  it('cannot be called while the board already holds the most waves it can', () => {
    const world = worldFor();
    for (let index = 0; index < 4; index++) startWave(world, index);
    expect(nextWave(world)?.canCall).toBe(false);
  });

  it('can be called while there is room', () => {
    const world = worldFor();
    startWave(world, 0);
    expect(nextWave(world)?.canCall).toBe(true);
  });
});
