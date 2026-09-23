import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Layer boundaries are enforced here rather than by convention, because the
 * single most valuable property of this codebase — that `sim/` is pure and can
 * therefore run headless under Node — is also the easiest one to destroy by
 * accident with one convenient import. See docs/TECH_DESIGN.md §1 and §4.
 *
 *   core  <-  sim  <-  app
 *     ^        ^        ^
 *     +-- view/ui/audio +
 */

/** Libraries that only ever belong in the view, ui or audio layers. */
const RENDER_LIBS = ['pixi.js', 'pixi.js/*', 'react', 'react-dom', 'react/*', 'howler', 'zustand'];

const EDITOR_IS_DEV_ONLY =
  'The map editor is dev-only and must never be statically imported: that would put it in the production bundle, which the 500 kB gate sums whether or not anyone loads it. Reach it with a dynamic import inside an import.meta.env.DEV branch (#34).';

const DEVTOOLS_IS_DEV_ONLY =
  'The dev overlay is dev-only and must never be statically imported: that would put it in the production bundle, which the 500 kB gate sums whether or not anyone loads it. Reach it with a dynamic import inside an import.meta.env.DEV branch (#41).';

/**
 * Import patterns that reach a layer, whether by alias or by relative path.
 *
 * Relative forms are anchored with an explicit `../` rather than `**` because
 * `**` also matches an alias prefix: the pattern `**\/app` happily matched
 * `@view/app`, which is view's own module and nothing to do with the app layer.
 * Three levels of `../` covers the deepest directory in src/.
 */
const layer = (name) => [
  `@${name}`,
  `@${name}/*`,
  `@${name}/**`,
  `../${name}`,
  `../${name}/**`,
  `../../${name}`,
  `../../${name}/**`,
  `../../../${name}`,
  `../../../${name}/**`,
];

/** Browser globals that must not appear in a layer meant to run under Node. */
const BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];

/** Sources of nondeterminism. A replay must be reproducible from its seed alone. */
const NONDETERMINISM = [
  {
    object: 'Math',
    property: 'random',
    message: 'Nondeterministic. Use the seeded RNG stream on the World (docs/TECH_DESIGN.md §6.2).',
  },
  {
    object: 'Date',
    property: 'now',
    message: 'Nondeterministic. The simulation measures time in ticks, never wall clock.',
  },
  {
    object: 'performance',
    property: 'now',
    message: 'Nondeterministic. The simulation measures time in ticks, never wall clock.',
  },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'android/**', 'node_modules/**', 'public/assets/atlas/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },

  /* ---- core/ depends on nothing. It is the bottom of the stack. ---- */
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...RENDER_LIBS,
                ...layer('sim'),
                ...layer('content'),
                ...layer('view'),
                ...layer('ui'),
                ...layer('audio'),
                ...layer('platform'),
                ...layer('app'),
                ...layer('editor'),
                ...layer('devtools'),
              ],
              message:
                'core/ is the bottom of the dependency stack and must not import from any other layer.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...BROWSER_GLOBALS],
      'no-restricted-properties': ['error', ...NONDETERMINISM],
    },
  },

  /* ---- sim/ is the game. Pure, deterministic, headless-runnable. ---- */
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: RENDER_LIBS,
              message:
                'sim/ must not depend on a renderer, UI framework or audio library. It has to run headless under Node so the balance simulator can drive it (docs/TECH_DESIGN.md §1).',
            },
            {
              group: [
                ...layer('view'),
                ...layer('ui'),
                ...layer('audio'),
                ...layer('platform'),
                ...layer('app'),
                ...layer('editor'),
                ...layer('devtools'),
              ],
              message:
                'sim/ may only import from core/ and content/schema/. It emits SimEvents; it never calls out.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...BROWSER_GLOBALS],
      'no-restricted-properties': ['error', ...NONDETERMINISM],
    },
  },

  /* ---- view/ ui/ audio/ may read sim state, never mutate it. ---- */
  {
    files: ['src/view/**/*.ts', 'src/ui/**/*.ts', 'src/audio/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...layer('app')],
              message: 'Presentation layers must not import from app/; app/ wires them together.',
            },
            {
              group: [...layer('editor')],
              message: EDITOR_IS_DEV_ONLY,
            },
            {
              group: [...layer('devtools')],
              message: DEVTOOLS_IS_DEV_ONLY,
            },
          ],
        },
      ],
    },
  },

  /*
   * ---- Nothing that ships may depend on the editor or the dev overlay. ----
   *
   * It may read anything — it is a tool built on the game — but a production
   * layer importing it would drag it into the bundle, which is the one thing
   * that must not happen (#34). The route reaches it through a dynamic import
   * inside an `import.meta.env.DEV` branch, which Rollup drops along with the
   * whole screen; a static import anywhere would defeat that silently. The dev
   * overlay (#41) takes the identical bargain for the identical reason.
   *
   * A separate block, and deliberately only for the files the blocks above do
   * not already cover: two blocks setting `no-restricted-imports` for the same
   * file do not merge, the later one replaces the earlier. Adding `.tsx` to
   * the presentation block above instead would have widened a rule that has
   * never applied to `.tsx` — and `InStageScreen.tsx` imports `@app/session`
   * today, so that is a real gap but not this issue's to close.
   */
  {
    files: ['src/**/*.tsx', 'src/app/**/*.ts', 'src/content/**/*.ts'],
    ignores: ['src/editor/**', 'src/devtools/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: [...layer('editor')], message: EDITOR_IS_DEV_ONLY },
            { group: [...layer('devtools')], message: DEVTOOLS_IS_DEV_ONLY },
          ],
        },
      ],
    },
  },

  /* ---- Config, tooling and tests are exempt. ---- */
  {
    files: ['*.config.ts', '*.config.js', 'tools/**/*.{ts,js}', 'tests/**/*.ts'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-properties': 'off',
    },
  },
);
