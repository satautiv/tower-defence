import type { RawContent } from '@content/loader';

/**
 * A minimal, valid content set that every lint rule test starts from.
 *
 * Built in memory rather than as JSON files on disk: a rule test should state
 * the one thing it is breaking, and a reader should be able to see that one
 * thing without opening a fixture directory.
 */
export function validContent(): RawContent {
  const tier = (cost: number) => ({
    cost,
    damage: 10,
    damageType: 'kinetic',
    fireRate: 1,
    rangeTiles: 5,
  });
  const ability = (id: string) => ({
    id,
    nameKey: 'a.b',
    cost: 10,
    cooldownSeconds: 5,
    effects: [{ kind: 'damage_in_radius', params: { radiusTiles: 2, damage: 50 } }],
  });
  const spec = (id: string) => ({
    id,
    nameKey: 'a.b',
    descriptionKey: 'a.c',
    tiers: [tier(360), tier(640)],
    ability: ability(`${id}_ability`),
  });

  return {
    tuning: {
      path: 'tuning.json',
      data: {
        defenceHalfPoint: 50,
        defenceCap: 200,
        aetherPerKill: 1,
        aetherPerReaction: 4,
        aetherPerSecond: 0.5,
        aetherMax: 100,
        earlyCallGoldPerSecond: 1.5,
        shatterMultiplier: 2.5,
        shatterThreshold: 40,
        twoStarLivesFraction: 0.6,
        undoWindowSeconds: 3,
        previewArmourThreshold: 30,
        previewWardThreshold: 30,
        leyNodes: {
          flux: { attackSpeed: 1.25 },
          depth: { range: 1.2 },
          resonance: { statusStacks: 1 },
          surge: { reactionDamage: 1.5 },
        },
      },
    },
    statuses: {
      path: 'statuses.json',
      data: [
        { id: 'scorch', nameKey: 'a.b', descriptionKey: 'a.c', maxStacks: 5, durationSeconds: 4 },
        { id: 'chill', nameKey: 'a.b', descriptionKey: 'a.c', maxStacks: 5, durationSeconds: 3 },
        {
          id: 'fracture',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          maxStacks: 10,
          durationSeconds: 6,
        },
      ],
    },
    reactions: {
      path: 'reactions.json',
      data: [
        {
          id: 'thermal_shock',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          a: 'scorch',
          b: 'chill',
          cooldownSeconds: 1.2,
        },
      ],
    },
    towers: [
      {
        path: 'towers/post.json',
        data: {
          id: 'post',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          family: 'marksman',
          tiers: [tier(80), tier(128), tier(208)],
          specialisations: [spec('nest'), spec('battery')],
        },
      },
    ],
    enemies: [
      {
        path: 'enemies/husk.json',
        data: { id: 'husk', nameKey: 'a.b', hp: 90, speed: 1, bounty: 10 },
      },
    ],
    stages: [
      {
        path: 'stages/1-1.json',
        data: {
          id: '1-1',
          nameKey: 'a.b',
          region: 1,
          widthTiles: 30,
          heightTiles: 17,
          startingGold: 600,
          lives: 20,
          core: { x: 29, y: 8 },
          paths: [
            {
              id: 0,
              points: [
                { x: 0, y: 8 },
                { x: 29, y: 8 },
              ],
            },
          ],
          spawnPoints: [{ id: 0, position: { x: 0, y: 8 }, pathId: 0 }],
          plots: [
            { id: 0, position: { x: 4, y: 4 }, leyNode: 'flux' },
            { id: 1, position: { x: 10, y: 4 }, leyNode: 'surge' },
          ],
          waves: [
            { autoStartDelaySeconds: 20, groups: [{ enemy: 'husk', count: 40, spawnPoint: 0 }] },
          ],
        },
      },
    ],
    powers: [
      {
        path: 'powers/riftfall.json',
        data: {
          id: 'riftfall',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          cost: 40,
          cooldownSeconds: 12,
          targeting: 'point',
          effects: [{ kind: 'damage_in_radius', params: { radiusTiles: 2, damage: 50 } }],
        },
      },
    ],
    heroes: [
      {
        path: 'heroes/kaelen.json',
        data: {
          id: 'kaelen',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          damageType: 'arcane',
          hp: 600,
          damage: 35,
          attacksPerSecond: 1,
          attackRangeTiles: 3,
          respawnSeconds: 25,
          abilities: [
            {
              id: 'one',
              nameKey: 'a.b',
              descriptionKey: 'a.c',
              cooldownSeconds: 8,
              effects: [{ kind: 'damage_in_radius', params: { radiusTiles: 2, damage: 50 } }],
            },
            {
              id: 'two',
              nameKey: 'a.b',
              descriptionKey: 'a.c',
              cooldownSeconds: 8,
              effects: [{ kind: 'damage_in_radius', params: { radiusTiles: 2, damage: 50 } }],
            },
            {
              id: 'three',
              nameKey: 'a.b',
              descriptionKey: 'a.c',
              cooldownSeconds: 8,
              effects: [{ kind: 'damage_in_radius', params: { radiusTiles: 2, damage: 50 } }],
            },
          ],
        },
      },
    ],
    talents: [
      {
        path: 'talents/bloom.json',
        data: {
          id: 'bloom',
          nameKey: 'a.b',
          descriptionKey: 'a.c',
          branch: 'conduction',
          maxRanks: 5,
          starCostPerRank: 1,
          modifier: { stat: 'reactionPower', perRank: 0.1 },
        },
      },
    ],
  };
}

/** Deep-clones the baseline and applies one deliberate break. */
export function contentWith(patch: (content: RawContent) => void): RawContent {
  const content = structuredClone(validContent());
  patch(content);
  return content;
}

/** Narrowing helper: fixture payloads are `unknown` by design. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
