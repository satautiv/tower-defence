/**
 * Fails the build when the JavaScript payload outgrows its budget.
 *
 * The budget exists to protect a product requirement, not a vanity metric:
 * "median time from launching the app to being in a wave is under 15 seconds"
 * (docs/GAME_DESIGN.md §22). Bundle size is the part of that we can measure on
 * every commit.
 *
 * Caveat: this sums every emitted .js chunk, which equals the initial payload
 * only while nothing is lazy-loaded. Once stage assets and the map editor are
 * code-split (#49), this must switch to following the entry graph from
 * index.html — otherwise lazily-loaded code would count against a budget it
 * does not actually cost.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const BUDGET_BYTES = 500 * 1024;
const DIST = 'dist';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`No ${DIST}/ directory. Run \`npm run build\` first.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`No .js emitted into ${DIST}/. Did the build succeed?`);
  process.exit(1);
}

const measured = files
  .map((file) => ({ file: relative(DIST, file), gzip: gzipSync(readFileSync(file)).length }))
  .sort((a, b) => b.gzip - a.gzip);

const total = measured.reduce((sum, m) => sum + m.gzip, 0);
const width = Math.max(...measured.map((m) => m.file.length));

console.log('\nJavaScript payload (gzipped)\n');
for (const { file, gzip } of measured) {
  console.log(`  ${file.padEnd(width)}  ${kb(gzip).padStart(10)}`);
}
console.log(`  ${'—'.repeat(width)}  ${'—'.repeat(10)}`);
console.log(`  ${'total'.padEnd(width)}  ${kb(total).padStart(10)}`);

const pct = ((total / BUDGET_BYTES) * 100).toFixed(1);
console.log(`\n  budget ${kb(BUDGET_BYTES)} — using ${pct}%\n`);

if (total > BUDGET_BYTES) {
  console.error(`Over budget by ${kb(total - BUDGET_BYTES)}.`);
  console.error('Either reduce the payload or argue for a new budget in an ADR.');
  process.exit(1);
}
