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

/**
 * The map editor is dev-only (#34).
 *
 * The bundle gate sums every emitted chunk, so a static import from anything
 * that ships would put the whole editor in the payload whether or not a player
 * ever opens it. The route reaches it through a dynamic import inside an
 * `import.meta.env.DEV` branch, which Rollup drops entirely — and this is what
 * stops someone undoing that with an innocent-looking import.
 */
describe('nothing that ships depends on the editor', () => {
  it.each([
    ['src/ui/probe.tsx', '@editor/EditorScreen'],
    ['src/ui/probe.ts', '@editor/draft'],
    ['src/app/probe.ts', '@editor/coverage'],
    ['src/sim/probe.ts', '@editor/draft'],
    ['src/core/probe.ts', '@editor/draft'],
    ['src/view/probe.ts', '@editor/coverage'],
  ])('rejects %s importing %s', async (filePath, specifier) => {
    const rules = await rulesTriggeredBy(
      `import { thing } from '${specifier}';\nexport const t = thing;\n`,
      filePath,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  /* The editor is allowed to import itself, or it could not be written. */
  it('lets the editor import its own modules', async () => {
    const rules = await rulesTriggeredBy(
      `import { emptyDraft } from '@editor/draft';\nexport const d = emptyDraft;\n`,
      'src/editor/probe.tsx',
    );
    expect(rules).not.toContain('no-restricted-imports');
  });

  /* It is a tool built on the game, so it reads the game freely. */
  it('lets the editor read the simulation and the content', async () => {
    const rules = await rulesTriggeredBy(
      `import { buildRuleset } from '@sim/index';\nexport const r = buildRuleset;\n`,
      'src/editor/probe.ts',
    );
    expect(rules).not.toContain('no-restricted-imports');
  });
});

/**
 * The dev overlay is dev-only (#41), on exactly the editor's terms.
 *
 * Same reason, restated because the guard is what makes it true: the 500 kB
 * gate sums every emitted chunk whether or not a player loads it, so a static
 * import from anything that ships would put the whole overlay — its cheats,
 * its graphs, its replay controls — into the payload. It is reached through a
 * dynamic import inside an `import.meta.env.DEV` branch, which Rollup drops.
 */
describe('nothing that ships depends on the dev overlay', () => {
  it.each([
    ['src/ui/probe.tsx', '@devtools/DevOverlay'],
    ['src/ui/probe.ts', '@devtools/damageLog'],
    ['src/app/probe.ts', '@devtools/damageLog'],
    ['src/sim/probe.ts', '@devtools/damageLog'],
    ['src/core/probe.ts', '@devtools/damageLog'],
    ['src/view/probe.ts', '@devtools/damageLog'],
    ['src/audio/probe.ts', '@devtools/damageLog'],
  ])('rejects %s importing %s', async (filePath, specifier) => {
    const rules = await rulesTriggeredBy(
      `import { thing } from '${specifier}';\nexport const t = thing;\n`,
      filePath,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  /* It is a tool built on the game, so it reads the game freely — and imports
     its own modules, or it could not be written. */
  it('lets the overlay read the simulation and its own modules', async () => {
    const rules = await rulesTriggeredBy(
      `import { hashWorld } from '@sim/index';\nimport { DamageWatcher } from '@devtools/damageLog';\nexport const t = [hashWorld, DamageWatcher];\n`,
      'src/devtools/probe.tsx',
    );
    expect(rules).not.toContain('no-restricted-imports');
  });
});

/**
 * The cheats are dev-only too, and for a second reason on top of the bundle.
 *
 * `src/sim/cheats.ts` mutates the world with no command behind it, which is
 * precisely what the command queue exists to prevent. It lives inside `sim/`
 * so that "only sim/ mutates the world" stays literally true, and the ban is
 * what keeps that the only place it can happen — a give-gold path reachable
 * from the shipped command handler would be both bytes in the bundle and a
 * route a player could find.
 */
describe('nothing that ships reaches the cheats', () => {
  it.each([
    ['src/ui/probe.tsx', '@sim/cheats'],
    ['src/ui/probe.ts', '@sim/cheats'],
    ['src/app/probe.ts', '@sim/cheats'],
    ['src/view/probe.ts', '@sim/cheats'],
    ['src/audio/probe.ts', '@sim/cheats'],
    ['src/content/probe.ts', '@sim/cheats'],
    ['src/sim/systems/probe.ts', '../cheats.js'],
  ])('rejects %s importing %s', async (filePath, specifier) => {
    const rules = await rulesTriggeredBy(
      `import { giveGold } from '${specifier}';\nexport const g = giveGold;\n`,
      filePath,
    );
    expect(rules).toContain('no-restricted-imports');
  });

  it('lets the overlay reach them, which is what they are for', async () => {
    const rules = await rulesTriggeredBy(
      `import { giveGold } from '@sim/cheats';\nexport const g = giveGold;\n`,
      'src/devtools/probe.ts',
    );
    expect(rules).not.toContain('no-restricted-imports');
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
