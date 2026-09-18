import { describe, expect, it } from 'vitest';
import { ContentValidationError, buildRegistry } from '@content/loader';
import { lintContent } from '@content/lint';
import { asRecord, contentWith, validContent } from './fixtures.js';

/**
 * One fixture per rule. Each starts from a valid content set and breaks exactly
 * one thing, so a failure names the rule that regressed rather than leaving
 * someone to work out which of forty assertions moved.
 */

const rulesFor = (content: ReturnType<typeof validContent>, localeKeys?: Set<string>): string[] =>
  lintContent(buildRegistry(content), localeKeys).map((d) => d.rule);

describe('the baseline fixture is clean', () => {
  it('produces no diagnostics, so every other test isolates one break', () => {
    expect(lintContent(buildRegistry(validContent()))).toEqual([]);
  });
});

describe('stage references', () => {
  it('catches a wave naming an enemy that does not exist', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      (stage.waves as Array<{ groups: Array<{ enemy: string }> }>)[0]!.groups[0]!.enemy =
        'husk_typo';
    });
    expect(rulesFor(content)).toContain('wave-enemy-ref');
  });

  it('catches a wave using a spawn point that does not exist', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      (stage.waves as Array<{ groups: Array<{ spawnPoint: number }> }>)[0]!.groups[0]!.spawnPoint =
        7;
    });
    expect(rulesFor(content)).toContain('wave-spawn-point-ref');
  });

  it('catches a spawn point attached to a path that does not exist', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      (stage.spawnPoints as Array<{ pathId: number }>)[0]!.pathId = 9;
    });
    expect(rulesFor(content)).toContain('spawn-point-path-ref');
  });

  it('catches a path branching to a path that does not exist', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      (stage.paths as Array<Record<string, unknown>>)[0]!.branches = [
        { atDistanceTiles: 5, targetPathId: 4, weight: 1 },
      ];
    });
    expect(rulesFor(content)).toContain('path-branch-ref');
  });
});

describe('stage geometry', () => {
  it('catches a build plot placed off the map', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      (stage.plots as Array<{ position: { x: number; y: number } }>)[0]!.position = {
        x: 999,
        y: 4,
      };
    });
    expect(rulesFor(content)).toContain('plot-bounds');
  });

  it('catches two build plots sitting on top of each other', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      const plots = stage.plots as Array<{ position: { x: number; y: number } }>;
      plots[1]!.position = { ...plots[0]!.position };
    });
    expect(rulesFor(content)).toContain('plot-overlap');
  });

  it('catches a path leaving the map', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      (stage.paths as Array<{ points: Array<{ x: number; y: number }> }>)[0]!.points[1] = {
        x: 500,
        y: 8,
      };
    });
    expect(rulesFor(content)).toContain('path-bounds');
  });
});

describe('stage economy', () => {
  it('catches starting gold that cannot afford the cheapest tower', () => {
    const content = contentWith((c) => {
      asRecord(c.stages[0]!.data).startingGold = 10;
    });
    expect(rulesFor(content)).toContain('stage-economy');
  });

  it('catches a stage whose total gold cannot fund a viable board', () => {
    const content = contentWith((c) => {
      const stage = asRecord(c.stages[0]!.data);
      stage.startingGold = 80;
      (stage.waves as Array<{ groups: Array<{ count: number }> }>)[0]!.groups[0]!.count = 1;
    });
    expect(rulesFor(content)).toContain('stage-economy');
  });
});

describe('tower coherence', () => {
  it('catches a tower applying a status its damage type cannot produce', () => {
    const content = contentWith((c) => {
      const tower = asRecord(c.towers[0]!.data);
      (tower.tiers as Array<Record<string, unknown>>)[0]!.statusApplied = {
        status: 'scorch',
        stacks: 1,
      };
    });
    /* Kinetic damage produces fracture, never scorch. */
    expect(rulesFor(content)).toContain('tower-status-damage-type');
  });

  it('accepts kinetic applying fracture, the one physical mark', () => {
    const content = contentWith((c) => {
      const tower = asRecord(c.towers[0]!.data);
      (tower.tiers as Array<Record<string, unknown>>)[0]!.statusApplied = {
        status: 'fracture',
        stacks: 1,
      };
    });
    expect(rulesFor(content)).not.toContain('tower-status-damage-type');
  });

  it('catches a specialisation tier with an incoherent status too', () => {
    const content = contentWith((c) => {
      const tower = asRecord(c.towers[0]!.data);
      const specs = tower.specialisations as Array<{ tiers: Array<Record<string, unknown>> }>;
      specs[0]!.tiers[0]!.damageType = 'pyro';
      specs[0]!.tiers[0]!.statusApplied = { status: 'chill', stacks: 1 };
    });
    expect(rulesFor(content)).toContain('tower-status-damage-type');
  });
});

describe('unlock chains', () => {
  it('catches a tower gated behind a stage that does not exist', () => {
    const content = contentWith((c) => {
      asRecord(c.towers[0]!.data).unlockedByStage = '9-9';
    });
    expect(rulesFor(content)).toContain('unlock-stage-ref');
  });

  it('catches a hero gated behind a stage that does not exist', () => {
    const content = contentWith((c) => {
      asRecord(c.heroes[0]!.data).unlockedByStage = '4-2';
    });
    expect(rulesFor(content)).toContain('unlock-stage-ref');
  });

  it('catches a talent requiring one that does not exist', () => {
    const content = contentWith((c) => {
      asRecord(c.talents[0]!.data).requires = ['nonexistent'];
    });
    expect(rulesFor(content)).toContain('talent-requires-ref');
  });

  it('catches a talent prerequisite cycle', () => {
    const content = contentWith((c) => {
      asRecord(c.talents[0]!.data).requires = ['second'];
      c.talents.push({
        path: 'talents/second.json',
        data: {
          id: 'second',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          branch: 'foundry',
          maxRanks: 3,
          starCostPerRank: 1,
          modifier: { stat: 'towerDamage', perRank: 0.02 },
          requires: ['bloom'],
        },
      });
    });
    expect(rulesFor(content)).toContain('talent-cycle');
  });

  it('accepts a deep but acyclic prerequisite chain', () => {
    const content = contentWith((c) => {
      asRecord(c.talents[0]!.data).requires = ['second'];
      c.talents.push({
        path: 'talents/second.json',
        data: {
          id: 'second',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          branch: 'foundry',
          maxRanks: 3,
          starCostPerRank: 1,
          modifier: { stat: 'towerDamage', perRank: 0.02 },
        },
      });
    });
    expect(rulesFor(content)).not.toContain('talent-cycle');
  });
});

describe('status and enemy references', () => {
  it('catches a reaction naming a status the data never defines', () => {
    /* The schema enum already rejects an invented status id. What it cannot
       see is a status that is a valid enum member but absent from
       statuses.json — the reaction would reference something with no
       definition behind it. That gap is what this rule exists to close. */
    const content = contentWith((c) => {
      const statuses = c.statuses.data as Array<{ id: string }>;
      c.statuses.data = statuses.filter((s) => s.id !== 'chill');
    });
    expect(rulesFor(content)).toContain('reaction-status-ref');
  });

  it('accepts the wildcard second operand used by amplify', () => {
    const content = contentWith((c) => {
      (c.reactions.data as Array<Record<string, unknown>>)[0]!.b = 'any';
    });
    expect(rulesFor(content)).not.toContain('reaction-status-ref');
  });

  it('catches a status escalating into one that does not exist', () => {
    const content = contentWith((c) => {
      (c.statuses.data as Array<Record<string, unknown>>)[1]!.escalatesTo = 'freeze';
    });
    expect(rulesFor(content)).toContain('status-ref');
  });

  it('catches a splitter producing an enemy that does not exist', () => {
    const content = contentWith((c) => {
      asRecord(c.enemies[0]!.data).traits = ['splitter'];
      asRecord(c.enemies[0]!.data).traitConfig = { splitsInto: 'broodling', splitCount: 2 };
    });
    expect(rulesFor(content)).toContain('enemy-split-ref');
  });

  it('catches a carrier spawning an enemy that does not exist', () => {
    const content = contentWith((c) => {
      asRecord(c.enemies[0]!.data).traits = ['carrier'];
      asRecord(c.enemies[0]!.data).traitConfig = { spawns: 'ghost', spawnIntervalSeconds: 6 };
    });
    expect(rulesFor(content)).toContain('enemy-spawn-ref');
  });
});

describe('localisation', () => {
  it('catches a key referenced by content but absent from the locale file', () => {
    expect(rulesFor(validContent(), new Set(['a.b']))).toContain('locale-key-missing');
  });

  it('passes when every referenced key is present', () => {
    expect(rulesFor(validContent(), new Set(['a.b', 'a.c']))).not.toContain('locale-key-missing');
  });

  it('is skipped entirely when no locale file is supplied', () => {
    expect(rulesFor(validContent())).not.toContain('locale-key-missing');
  });
});

describe('schema validation', () => {
  it('names the offending file and field', () => {
    const content = contentWith((c) => {
      asRecord(c.enemies[0]!.data).hp = -5;
    });
    try {
      buildRegistry(content);
      expect.unreachable('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      const issues = (error as ContentValidationError).issues;
      expect(issues[0]?.path).toBe('enemies/husk.json');
      expect(issues[0]?.field).toBe('hp');
    }
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const content = contentWith((c) => {
      asRecord(c.enemies[0]!.data).hp = -5;
      asRecord(c.towers[0]!.data).family = 'not_a_family';
    });
    try {
      buildRegistry(content);
      expect.unreachable('expected validation to fail');
    } catch (error) {
      const paths = new Set((error as ContentValidationError).issues.map((i) => i.path));
      expect(paths.size).toBeGreaterThan(1);
    }
  });

  it('rejects duplicate ids across files', () => {
    const content = contentWith((c) => {
      c.enemies.push({ path: 'enemies/copy.json', data: structuredClone(c.enemies[0]!.data) });
    });
    try {
      buildRegistry(content);
      expect.unreachable('expected validation to fail');
    } catch (error) {
      expect((error as ContentValidationError).issues[0]?.message).toMatch(/duplicate id/);
    }
  });

  it('rejects an id that is not lower snake_case, since ids become type names', () => {
    const content = contentWith((c) => {
      asRecord(c.enemies[0]!.data).id = 'Husk-2';
    });
    expect(() => buildRegistry(content)).toThrow(ContentValidationError);
  });
});
