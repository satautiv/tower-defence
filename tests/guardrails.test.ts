import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The layer boundaries in eslint.config.js are the one thing protecting the
 * property the whole architecture rests on: that sim/ stays pure and can run
 * headless (docs/TECH_DESIGN.md §1).
 *
 * A guardrail nobody checks is worse than none, because it is trusted. These
 * tests lint synthetic files that never touch disk, so the rules are re-proven
 * on every CI run rather than the one time a human tried them.
 */

const eslint = new ESLint();

async function rulesTriggeredBy(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'unknown');
}

/**
 * The first lintText() pays for loading and resolving the flat config, which
 * takes seconds under coverage instrumentation on a slow runner. Pay it once
 * here rather than charging it to whichever test happens to run first.
 */
beforeAll(async () => {
  await eslint.lintText('export const warm = 1;\n', { filePath: 'src/sim/warmup.ts' });
}, 120_000);

describe('sim/ purity is enforced', () => {
  it('rejects importing a renderer', async () => {
    const rules = await rulesTriggeredBy(
      `import { Sprite } from 'pixi.js';\nexport const s = Sprite;\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects importing a UI framework', async () => {
    const rules = await rulesTriggeredBy(
      `import { useState } from 'react';\nexport const u = useState;\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects reaching into the view layer', async () => {
    const rules = await rulesTriggeredBy(
      `import { Camera } from '@view/camera';\nexport const c = Camera;\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('rejects browser globals', async () => {
    const rules = await rulesTriggeredBy(
      `export const w = window.innerWidth;\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toContain('no-restricted-globals');
  });

  it('rejects nondeterministic sources', async () => {
    const rules = await rulesTriggeredBy(
      `export const r = Math.random();\nexport const t = Date.now();\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toContain('no-restricted-properties');
  });

  it('allows importing from core/', async () => {
    const rules = await rulesTriggeredBy(
      `import { TICK_SECONDS } from '@core/constants';\nexport const dt = TICK_SECONDS;\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toEqual([]);
  });
});

describe('core/ sits at the bottom of the stack', () => {
  it('rejects importing from any other layer', async () => {
    const rules = await rulesTriggeredBy(
      `import { World } from '@sim/world';\nexport const w = World;\n`,
      'src/core/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });
});

describe('presentation layers stay downstream', () => {
  it('blocks ui/ from importing the app layer', async () => {
    const rules = await rulesTriggeredBy(
      `import { boot } from '@app/mount';\nexport const b = boot;\n`,
      'src/ui/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  /**
   * Regression: the layer patterns once used `**` for relative imports, which
   * also matched an alias prefix — so `@view/app`, which is view's own module,
   * was rejected as if it were the app layer. Relative forms are now anchored
   * with an explicit `../`.
   */
  it('allows ui/ to import view/app, which is not the app layer', async () => {
    const rules = await rulesTriggeredBy(
      `import { createGameView } from '@view/app';\nexport const c = createGameView;\n`,
      'src/ui/probe.ts',
    );
    expect(rules).toEqual([]);
  });

  it('lets view/ read from sim/', async () => {
    const rules = await rulesTriggeredBy(
      `import { TICK_SECONDS } from '@core/constants';\nexport const dt = TICK_SECONDS;\n`,
      'src/view/probe.ts',
    );
    expect(rules).toEqual([]);
  });

  /* audio/ arrived with the reaction stingers and sits alongside view/ and
     ui/: downstream of sim/, upstream of nothing. */
  it('blocks audio/ from importing the app layer', async () => {
    const rules = await rulesTriggeredBy(
      `import { boot } from '@app/mount';\nexport const b = boot;\n`,
      'src/audio/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('lets audio/ read sim events', async () => {
    const rules = await rulesTriggeredBy(
      `import { SimEventKind } from '@sim/index';\nexport const k = SimEventKind;\n`,
      'src/audio/probe.ts',
    );
    expect(rules).toEqual([]);
  });

  /* The reverse of the rule that matters most: an audio library must never
     reach sim/, or the simulation stops running headless under Node. */
  it('keeps an audio library out of sim/', async () => {
    const rules = await rulesTriggeredBy(
      `import { Howl } from 'howler';\nexport const h = Howl;\n`,
      'src/sim/probe.ts',
    );
    expect(rules).toContain('no-restricted-imports');
  });
});
