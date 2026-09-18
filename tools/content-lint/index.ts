import { ContentValidationError, buildRegistry } from '../../src/content/loader.js';
import { lintContent } from '../../src/content/lint.js';
import { readContentFromDisk, readLocaleKeys } from '../content/io.js';

/** CLI wrapper. All the actual rules live in src/content/lint.ts so tests can drive them directly. */
function main(): void {
  let registry;
  try {
    registry = buildRegistry(readContentFromDisk());
  } catch (error) {
    if (error instanceof ContentValidationError) {
      console.error('Content failed schema validation:\n');
      for (const issue of error.issues)
        console.error(`  ${issue.path}\n    ${issue.field}: ${issue.message}`);
      console.error(`\n${error.issues.length} schema error(s).`);
      process.exit(1);
    }
    throw error;
  }

  const diagnostics = lintContent(registry, readLocaleKeys());
  if (diagnostics.length === 0) {
    const total =
      registry.towers.size + registry.enemies.size + registry.stages.size + registry.powers.size;
    console.log(`content:lint — ${total} definitions, no problems.`);
    return;
  }

  console.error('Content cross-reference problems:\n');
  const byRule = new Map<string, typeof diagnostics>();
  for (const d of diagnostics) {
    if (!byRule.has(d.rule)) byRule.set(d.rule, []);
    byRule.get(d.rule)!.push(d);
  }
  for (const [rule, items] of [...byRule].sort()) {
    console.error(`  ${rule}`);
    for (const item of items) console.error(`    ${item.source}: ${item.message}`);
  }
  console.error(`\n${diagnostics.length} problem(s).`);
  process.exit(1);
}

main();
