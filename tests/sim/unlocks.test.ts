import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { buildOptions, createWorldForStage, placeTower, towerIndex } from '@sim/index';

/**
 * Tower unlocks (#36, GDD §12: "Arcane Spire @1-2, Tesla @1-4…").
 *
 * The field was authored and validated long before anything read it, so this
 * is about the reading. Two properties matter and they pull in opposite
 * directions: an early stage must not offer a tower the player has not earned,
 * and replaying an early stage later must not take back what they have.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = (id: string) => {
  const found = registry.stages.get(id);
  if (found === undefined) throw new Error(`stage ${id} missing`);
  return found;
};

const rosterAt = (progressStageId: string, playing = '1-1'): string[] =>
  buildOptions(createWorldForStage(registry, stage(playing), 1, { progressStageId })).map(
    (option) => option.id,
  );

describe('a stage offers the towers the player has earned', () => {
  it('opens the campaign with the three the slice was built on', () => {
    expect(rosterAt('1-1').sort()).toEqual(['arbalest_post', 'flame_vent', 'frost_cairn']);
  });

  it('adds each tower at the stage that teaches it', () => {
    expect(rosterAt('1-2')).toContain('arcane_spire');
    expect(rosterAt('1-4')).toContain('tesla_coil');
    expect(rosterAt('1-6')).toContain('wardens_barracks');
    expect(rosterAt('1-7')).toContain('alchemists_still');
    expect(rosterAt('1-8')).toContain('mortar_emplacement');
  });

  it('withholds each one the stage before', () => {
    expect(rosterAt('1-1')).not.toContain('arcane_spire');
    expect(rosterAt('1-3')).not.toContain('tesla_coil');
    expect(rosterAt('1-5')).not.toContain('wardens_barracks');
    expect(rosterAt('1-6')).not.toContain('alchemists_still');
    expect(rosterAt('1-7')).not.toContain('mortar_emplacement');
  });

  it('has the whole roster by the boss stage', () => {
    expect(rosterAt('1-10')).toHaveLength(registry.towers.size);
  });

  /* "1-10" sorts before "1-5" as a string, which would unlock everything from
     the second stage onward. The comparison is by region and index for
     exactly this reason. */
  it('is not fooled by string order', () => {
    expect(rosterAt('1-5')).not.toContain('mortar_emplacement');
    expect(rosterAt('1-10')).toContain('mortar_emplacement');
  });
});

/**
 * Unlocks belong to the player, not to the stage.
 *
 * Gating on the id of the stage being played would take the roster away again
 * the moment someone replayed 1-1 for a better score — which is the bug
 * `progressStageId` exists to make impossible.
 */
describe('replaying an early stage keeps what was earned', () => {
  it('offers the whole roster on 1-1 to a player who has cleared 1-10', () => {
    expect(rosterAt('1-10', '1-1')).toHaveLength(registry.towers.size);
  });

  it('defaults to the stage being played, which is what a first visit is', () => {
    const world = createWorldForStage(registry, stage('1-1'), 1);
    expect(
      buildOptions(world)
        .map((option) => option.id)
        .sort(),
    ).toEqual(['arbalest_post', 'flame_vent', 'frost_cairn']);
  });
});

/**
 * The build menu hiding a tower is not enough on its own: a command can be
 * dispatched by a replay, a test or the balance simulator's scripted player,
 * and a stage's roster has to mean the same thing to all of them.
 */
describe('the command refuses what the menu does not offer', () => {
  it('will not place a locked tower even when asked directly', () => {
    const world = createWorldForStage(registry, stage('1-1'), 1);
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    expect(
      placeTower(world, towerIndex(world, 'mortar_emplacement'), plot.x, plot.y, plot.id),
    ).toBe(-1);
    expect(world.towers.count).toBe(0);
  });

  it('places an unlocked one from the same call', () => {
    const world = createWorldForStage(registry, stage('1-1'), 1);
    const plot = world.rules.plots[0];
    if (plot === undefined) throw new Error('stage 1-1 has no plots');

    expect(
      placeTower(world, towerIndex(world, 'arbalest_post'), plot.x, plot.y, plot.id),
    ).toBeGreaterThanOrEqual(0);
    expect(world.towers.count).toBe(1);
  });
});
