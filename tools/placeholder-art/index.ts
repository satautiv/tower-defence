import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas, drawBlock, drawDiamond, drawDisc, encodePng } from './png.js';
import type { Rgba } from './png.js';

/**
 * Generates placeholder sprites.
 *
 * Deliberately schematic rather than pretty. Shape carries the category —
 * discs are enemies, blocks are towers, diamonds are plots — and colour carries
 * the damage type, matching the palette the real art will use
 * (docs/GAME_DESIGN.md §16.1). That means the readability rules can be tested
 * against the placeholders, and #42 swaps the atlas without touching code.
 */

const OUT_DIR = 'assets/sprites';

const rgba = (hex: string, a = 255): Rgba => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
  a,
});

/* Damage-type colours are reserved: no environment art may use them saturated. */
const PALETTE = {
  kinetic: '#9aa4b2',
  pyro: '#ff7a33',
  cryo: '#7fd4ff',
  volt: '#c08cff',
  toxic: '#7fd45a',
  arcane: '#ff5ce0',
  enemy: '#d1495b',
  armoured: '#8d99ae',
  flying: '#b892ff',
  /** Menders, Shieldwrights, Nullifiers: the ones worth killing first. */
  support: '#3ddc84',
  plot: '#f2c14e',
  ley: '#5ce1e6',
} as const;

const darken = (c: Rgba, amount = 0.45): Rgba => ({
  r: Math.round(c.r * (1 - amount)),
  g: Math.round(c.g * (1 - amount)),
  b: Math.round(c.b * (1 - amount)),
  a: c.a,
});

type Shape = 'disc' | 'block' | 'diamond';

interface SpriteSpec {
  name: string;
  size: number;
  colour: string;
  shape: Shape;
  /** Relative radius, so a riftling reads as smaller than a revenant. */
  scale?: number;
}

const SPRITES: SpriteSpec[] = [
  { name: 'enemy_riftling', size: 48, colour: PALETTE.enemy, shape: 'disc', scale: 0.3 },
  { name: 'enemy_husk', size: 48, colour: PALETTE.enemy, shape: 'disc', scale: 0.38 },
  { name: 'enemy_rift_bat', size: 48, colour: PALETTE.flying, shape: 'disc', scale: 0.32 },
  {
    name: 'enemy_ironclad_revenant',
    size: 64,
    colour: PALETTE.armoured,
    shape: 'disc',
    scale: 0.46,
  },
  { name: 'enemy_chitin_mother', size: 64, colour: PALETTE.toxic, shape: 'disc', scale: 0.44 },
  { name: 'enemy_broodling', size: 48, colour: PALETTE.toxic, shape: 'disc', scale: 0.3 },
  { name: 'enemy_mite', size: 48, colour: PALETTE.toxic, shape: 'disc', scale: 0.2 },

  /* The behaviour roster (#29). Size tracks health so the Dread Wyrm reads as
     the elite it is, and the support trio takes `support` so the player can
     tell "this one changes the rules" from "this one hits you" before learning
     either silhouette — support enemies outrank damage enemies in threat
     (docs/GAME_DESIGN.md §9.3), and that has to be legible at 2x speed. */
  { name: 'enemy_mender', size: 48, colour: PALETTE.support, shape: 'disc', scale: 0.34 },
  { name: 'enemy_shieldwright', size: 56, colour: PALETTE.support, shape: 'disc', scale: 0.38 },
  { name: 'enemy_nullifier', size: 56, colour: PALETTE.support, shape: 'disc', scale: 0.42 },
  { name: 'enemy_standard_bearer', size: 56, colour: PALETTE.support, shape: 'disc', scale: 0.38 },
  { name: 'enemy_sapper', size: 48, colour: PALETTE.volt, shape: 'disc', scale: 0.32 },
  { name: 'enemy_bulwark_golem', size: 64, colour: PALETTE.armoured, shape: 'block', scale: 0.5 },
  { name: 'enemy_burrower', size: 48, colour: PALETTE.armoured, shape: 'disc', scale: 0.36 },
  { name: 'enemy_phase_stalker', size: 48, colour: PALETTE.arcane, shape: 'disc', scale: 0.36 },
  { name: 'enemy_carrier', size: 64, colour: PALETTE.flying, shape: 'disc', scale: 0.46 },
  { name: 'enemy_rift_sprout', size: 56, colour: PALETTE.toxic, shape: 'block', scale: 0.4 },
  { name: 'enemy_dread_wyrm', size: 80, colour: PALETTE.flying, shape: 'disc', scale: 0.56 },

  /* One per tower, coloured by the damage type it deals, so a board reads as a
     spread of elements before any real art exists. The barracks deals none, so
     it takes the plot colour — it is a building, not a gun. */
  { name: 'tower_arbalest_post', size: 64, colour: PALETTE.kinetic, shape: 'block' },
  { name: 'tower_mortar_emplacement', size: 64, colour: PALETTE.kinetic, shape: 'block' },
  { name: 'tower_flame_vent', size: 64, colour: PALETTE.pyro, shape: 'block' },
  { name: 'tower_arcane_spire', size: 64, colour: PALETTE.arcane, shape: 'block' },
  { name: 'tower_tesla_coil', size: 64, colour: PALETTE.volt, shape: 'block' },
  { name: 'tower_frost_cairn', size: 64, colour: PALETTE.cryo, shape: 'block' },
  { name: 'tower_alchemists_still', size: 64, colour: PALETTE.toxic, shape: 'block' },
  { name: 'tower_wardens_barracks', size: 64, colour: PALETTE.plot, shape: 'block' },

  /* Soldiers are discs like the things they fight, in the plot colour so they
     read as yours rather than theirs. */
  { name: 'soldier', size: 32, colour: PALETTE.plot, shape: 'disc', scale: 0.34 },
  { name: 'rally_flag', size: 32, colour: PALETTE.plot, shape: 'diamond' },

  { name: 'projectile_bolt', size: 16, colour: PALETTE.kinetic, shape: 'disc', scale: 0.4 },
  { name: 'projectile_ember', size: 16, colour: PALETTE.pyro, shape: 'disc', scale: 0.4 },
  { name: 'projectile_shard', size: 16, colour: PALETTE.cryo, shape: 'disc', scale: 0.4 },
  { name: 'projectile_rune', size: 16, colour: PALETTE.arcane, shape: 'disc', scale: 0.4 },
  { name: 'projectile_spark', size: 16, colour: PALETTE.volt, shape: 'disc', scale: 0.4 },
  { name: 'projectile_flask', size: 16, colour: PALETTE.toxic, shape: 'disc', scale: 0.4 },

  { name: 'plot_empty', size: 64, colour: PALETTE.plot, shape: 'diamond' },
  { name: 'plot_ley', size: 64, colour: PALETTE.ley, shape: 'diamond' },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const spec of SPRITES) {
  const pixels = createCanvas(spec.size, spec.size);
  const fill = rgba(spec.colour);
  const rim = darken(fill);

  if (spec.shape === 'disc') drawDisc(pixels, spec.size, fill, rim, spec.scale ?? 0.45);
  else if (spec.shape === 'block') drawBlock(pixels, spec.size, fill, rim);
  else drawDiamond(pixels, spec.size, fill);

  writeFileSync(`${OUT_DIR}/${spec.name}.png`, encodePng(spec.size, spec.size, pixels));
}

console.log(`art:placeholder — ${SPRITES.length} sprites written to ${OUT_DIR}`);
