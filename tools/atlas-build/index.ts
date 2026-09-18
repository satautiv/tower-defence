import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { packAsync } from 'free-tex-packer-core';
import type { PackerExporterType, PackerType } from 'free-tex-packer-core';

/**
 * Packs the sprite directory into a texture atlas.
 *
 * Every sprite in one texture means the renderer can batch them into a single
 * draw call. Loading a dozen separate images instead costs a texture bind per
 * sprite type, which is the difference between holding 60fps on a mid-range
 * phone and not (docs/TECH_DESIGN.md §14.2).
 *
 * Reads committed source art from assets/sprites and writes generated output to
 * public/assets/atlas, which is gitignored — the atlas is reproducible, so
 * committing it would only produce binary merge conflicts.
 */

const SRC_DIR = 'assets/sprites';
const OUT_DIR = 'public/assets/atlas';
const TEXTURE_NAME = 'game';

const files = readdirSync(SRC_DIR)
  .filter((name) => name.endsWith('.png'))
  .sort()
  .map((name) => ({ path: name, contents: readFileSync(join(SRC_DIR, name)) }));

if (files.length === 0) {
  console.error(`No sprites in ${SRC_DIR}. Run \`npm run art:placeholder\` first.`);
  process.exit(1);
}

const options = {
  textureName: TEXTURE_NAME,
  width: 2048,
  height: 2048,
  /* Padding and extrusion stop neighbouring sprites bleeding into each other
     when the atlas is sampled at a non-integer scale, which is every scale
     except one given the letterbox fit. */
  padding: 2,
  extrude: 1,
  allowRotation: false,
  allowTrim: false,
  detectIdentical: true,
  removeFileExtension: true,
  prependFolderName: false,
  /* The enums are declaration-only: the published module is CommonJS and
     exports just packAsync at runtime, so importing them as values fails.
     The literals are the enum's own string values. */
  exporter: 'Pixi' as PackerExporterType,
  packer: 'MaxRectsPacker' as PackerType,
};

const packed = await packAsync(files, options);

mkdirSync(OUT_DIR, { recursive: true });
for (const file of packed) writeFileSync(join(OUT_DIR, file.name), file.buffer);

console.log(`atlas:build — ${files.length} sprites into ${packed.map((f) => f.name).join(', ')}`);
