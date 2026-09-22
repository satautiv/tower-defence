/**
 * Comparing stage ids.
 *
 * A stage id is `region-index`, and the only interesting thing about it is
 * that **string comparison gets it exactly wrong**: "1-10" sorts before "1-5"
 * because "1" precedes "5". Everything gated on progress — a tower that
 * unlocks at 1-6, the hero at 1-5 — depends on this being right, and the
 * failure it prevents is silent: content that simply never unlocks.
 *
 * Here rather than in `app/` because `sim/` needs it too: the ruleset resolves
 * which towers a stage may build, and the balance simulator has to see the
 * same board a player would.
 */
export function stageAtLeast(stageId: string, minimum: string): boolean {
  const [atRegion, atIndex] = parseStageId(stageId);
  const [needRegion, needIndex] = parseStageId(minimum);

  if (atRegion !== needRegion) return atRegion > needRegion;
  return atIndex >= needIndex;
}

/** `[region, index]`, with anything unparseable reading as zero. */
export function parseStageId(stageId: string): [number, number] {
  const parts = stageId.split('-');
  const region = Number(parts[0]);
  const index = Number(parts[1]);
  return [Number.isFinite(region) ? region : 0, Number.isFinite(index) ? index : 0];
}

/** Campaign order, so a region map lists 1-9 before 1-10. */
export function compareStageIds(a: string, b: string): number {
  const [aRegion, aIndex] = parseStageId(a);
  const [bRegion, bIndex] = parseStageId(b);
  return aRegion === bRegion ? aIndex - bIndex : aRegion - bRegion;
}
