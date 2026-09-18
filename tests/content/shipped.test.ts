import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { lintContent } from '@content/lint';
import { readContentFromDisk, readLocaleKeys } from '../../tools/content/io.js';
import { ENEMY_IDS, STAGE_IDS, TOWER_IDS } from '@content/generated/ids';
import { WAVE_ENEMY_REFS } from '@content/generated/references';

/**
 * The rule tests prove each rule fires on a broken fixture. This proves the
 * content actually in the repository is clean — so a bad edit fails here and
 * not only in the separate content:lint step someone might not run locally.
 */

const registry = buildRegistry(readContentFromDisk());

describe('shipped content', () => {
  it('passes schema validation', () => {
    expect(registry.towers.size).toBeGreaterThan(0);
    expect(registry.enemies.size).toBeGreaterThan(0);
    expect(registry.stages.size).toBeGreaterThan(0);
  });

  it('passes every cross-reference rule, including localisation', () => {
    expect(lintContent(registry, readLocaleKeys())).toEqual([]);
  });

  it('keeps the generated id unions in step with the data', () => {
    expect([...TOWER_IDS].sort()).toEqual([...registry.towers.keys()].sort());
    expect([...ENEMY_IDS].sort()).toEqual([...registry.enemies.keys()].sort());
    expect([...STAGE_IDS].sort()).toEqual([...registry.stages.keys()].sort());
  });

  it('keeps generated references in step with the stages', () => {
    const referenced = new Set(
      [...registry.stages.values()].flatMap((s) =>
        s.waves.flatMap((w) => w.groups.map((g) => g.enemy)),
      ),
    );
    expect([...WAVE_ENEMY_REFS].sort()).toEqual([...referenced].sort());
  });

  it('gives stage 1-1 a solvable shape', () => {
    const stage = registry.stages.get('1-1');
    expect(stage).toBeDefined();
    expect(stage!.plots.length).toBeGreaterThanOrEqual(12);
    expect(stage!.plots.filter((p) => p.leyNode !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(stage!.waves.length).toBeGreaterThanOrEqual(10);
  });
});
