/**
 * Table-driven sine and cosine.
 *
 * `Math.sin` is deterministic within one JavaScript engine but not guaranteed
 * identical across them — the last bits may differ between V8, JavaScriptCore
 * and a WebView on some Android build. Anything feeding a position feeds
 * targeting, and targeting decides what dies, so a replay recorded on a phone
 * has to reproduce on a desktop exactly.
 *
 * A lookup table with linear interpolation is bit-identical everywhere, and for
 * a flyer's drift or a projectile's arc it is far more precision than the
 * result needs.
 */

const TABLE_BITS = 12;
const TABLE_SIZE = 1 << TABLE_BITS;
const TAU = Math.PI * 2;
const INDEX_SCALE = TABLE_SIZE / TAU;

/* Built once at module load with Math.sin. That is fine: every platform then
   interpolates the same table, so only the table's own construction depends on
   the engine — and it is regenerated identically from the same constants. */
const SINE = (() => {
  const table = new Float64Array(TABLE_SIZE + 1);
  for (let i = 0; i <= TABLE_SIZE; i++) table[i] = Math.sin((i / TABLE_SIZE) * TAU);
  return table;
})();

export function sinT(radians: number): number {
  /* Fold into [0, TAU) so a large tick count cannot walk off the table. */
  let angle = radians % TAU;
  if (angle < 0) angle += TAU;

  const position = angle * INDEX_SCALE;
  const index = Math.floor(position);
  const fraction = position - index;
  const a = SINE[index] as number;
  const b = SINE[index + 1] as number;
  return a + (b - a) * fraction;
}

export function cosT(radians: number): number {
  return sinT(radians + Math.PI / 2);
}

/** Table resolution, for tests that need to reason about the error bound. */
export const TRIG_TABLE_SIZE = TABLE_SIZE;
