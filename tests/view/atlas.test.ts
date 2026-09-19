import { readFileSync } from 'node:fs';
import type { SpritesheetData } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { indexAtlas } from '@view/assets';

/**
 * The interface cuts its enemy icons out of the atlas the board draws from, so
 * the index must cover every enemy and point at the image beside the JSON.
 */

const ATLAS = 'public/assets/atlas/game.json';
const data = JSON.parse(readFileSync(ATLAS, 'utf8')) as SpritesheetData;

describe('indexing the atlas for the interface', () => {
  it('has a frame for every enemy in the content', () => {
    const index = indexAtlas(data, 'assets/atlas/game.json');
    const registry = buildRegistry(readContentFromDisk());

    for (const id of registry.enemies.keys()) {
      expect(index.frames.get(`enemy_${id}`), id).toMatchObject({ w: expect.any(Number) });
    }
  });

  it('resolves the image beside the JSON, as the loader does', () => {
    const index = indexAtlas(data, 'assets/atlas/game.json');
    expect(index.image).toBe(`assets/atlas/${data.meta.image}`);
    expect(index.width).toBe(data.meta.size?.w);
  });

  /* A CSS sprite cannot unrotate a frame or re-centre a trimmed one. */
  it('leaves out frames a CSS sprite would draw wrongly', () => {
    const packed: SpritesheetData = {
      frames: {
        plain: { frame: { x: 0, y: 0, w: 8, h: 8 } },
        turned: { frame: { x: 8, y: 0, w: 8, h: 8 }, rotated: true },
        cropped: { frame: { x: 16, y: 0, w: 8, h: 8 }, trimmed: true },
      },
      meta: { image: 'a.png', size: { w: 24, h: 8 }, scale: 1 },
    };

    expect([...indexAtlas(packed, 'x/a.json').frames.keys()]).toEqual(['plain']);
  });
});
