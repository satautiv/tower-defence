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
