import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  /* Keep in sync with compilerOptions.paths in tsconfig.json */
  resolve: {
    alias: {
      '@core': alias('core'),
      '@sim': alias('sim'),
      '@content': alias('content'),
      '@view': alias('view'),
      '@ui': alias('ui'),
      '@audio': alias('audio'),
      '@platform': alias('platform'),
      '@app': alias('app'),
      '@editor': alias('editor'),
      '@devtools': alias('devtools'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    /* Generous enough for ESLint config loading on a cold CI runner, tight
       enough to still catch a genuine hang. */
    testTimeout: 20_000,
    /* The allocation tests need --expose-gc to force a collection and compare
       heap usage meaningfully. It is set via NODE_OPTIONS in the npm test
       scripts, not here: poolOptions.forks.execArgv is silently ignored by
       Vitest 5, which looks like it works until the guard test in
       tests/core/allocation.test.ts says otherwise. */
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    coverage: {
      /* sim/ and core/ are where the game actually lives, and they are pure,
         so they are cheap to test. view/ and ui/ are covered by E2E instead. */
      include: [
        'src/core/**/*.ts',
        'src/sim/**/*.ts',
        'src/content/**/*.ts',
        'src/platform/**/*.ts',
      ],
      exclude: [
        /* Generated from the data by tools/content-gen; testing it would test
           the generator, which tests/content/shipped.test.ts already does. */
        'src/content/generated/**',
        /* Vite's import.meta.glob has no meaning under the Node test runner.
           Covered instead by the build succeeding and by the loader tests,
           which exercise the same buildRegistry it calls. */
        'src/content/load.ts',
        'src/content/index.ts',
      ],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
