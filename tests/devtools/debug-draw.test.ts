import { describe, expect, it } from 'vitest';
import { buildRegistry } from '@content/loader';
import { readContentFromDisk } from '../../tools/content/io.js';
import { createWorldForStage, enemyIndex, spawnEnemy } from '@sim/index';
import { createLayerStack, LAYER_ORDER } from '@view/layers';
import { DebugView, NO_TOGGLES, anyToggle } from '@devtools/debugDraw';

/**
 * The visualisation toggles (#41).
 *
 * What is worth asserting here is where the layer sits and what it refuses to
 * do, not what the lines look like. A debug ring drawn under a particle burst
 * is a ring that was not drawn, and a debug layer that swallowed a tap would
 * make the board unplayable with the overlay open — which is exactly the trap
 * the editor fell into, where sixteen passing unit tests sat behind a tool
 * that looked perfect and did nothing.
 */

const registry = buildRegistry(readContentFromDisk());
const stage = registry.stages.get('1-1');
if (stage === undefined) throw new Error('stage 1-1 missing');

describe('where the debug layer sits', () => {
  it('draws into the topmost layer, above everything it has to be read over', () => {
    const stack = createLayerStack();
    const before = stack.layers.labels.children.length;
    new DebugView(stack.layers);
    expect(stack.layers.labels.children.length).toBe(before + 1);
    expect(LAYER_ORDER[LAYER_ORDER.length - 1]).toBe('labels');
  });

  it('never intercepts a tap, so the board stays playable', () => {
    const stack = createLayerStack();
    new DebugView(stack.layers);
    const drawn = stack.layers.labels.children[0];
    expect(drawn?.eventMode).toBe('none');
  });

  it('takes itself away again', () => {
    const stack = createLayerStack();
    const view = new DebugView(stack.layers);
    view.destroy();
    expect(stack.layers.labels.children.length).toBe(0);
  });
});

describe('what it draws', () => {
  it('knows when there is nothing to draw', () => {
    expect(anyToggle(NO_TOGGLES)).toBe(false);
    expect(anyToggle({ ...NO_TOGGLES, grid: true })).toBe(true);
  });

  /* Every toggle reads the world's own numbers at the world's own positions —
     a debug layer that computed its own answer could agree with neither the
     board nor the simulation, which is the disagreement it exists to find. */
  it('draws every toggle over a live board without complaint', () => {
    const world = createWorldForStage(registry, stage, 6);
    for (let i = 0; i < 6; i++) {
      const slot = spawnEnemy(world, enemyIndex(world, 'riftling'), 0);
      world.enemies.x[slot] = 120 + i * 30;
      world.enemies.y[slot] = 260;
    }

    const stack = createLayerStack();
    const view = new DebugView(stack.layers);
    expect(() =>
      view.render(world, {
        hitboxes: true,
        ranges: true,
        paths: true,
        grid: true,
        targeting: true,
      }),
    ).not.toThrow();
    expect(() => view.render(world, NO_TOGGLES)).not.toThrow();
  });
});
