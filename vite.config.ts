import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
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
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      /* sim/ and core/ are where the game actually lives, and they are pure,
         so they are cheap to test. view/ and ui/ are covered by E2E instead. */
      include: ['src/core/**', 'src/sim/**'],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
