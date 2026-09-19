import { STATUS_IDS } from '@content/schema/common';
import type { StatusId } from '@content/schema/common';

/**
 * Numeric status indices.
 *
 * Statuses are stored in flat typed arrays indexed `entity * STATUS_COUNT +
 * status`, so the simulation needs a stable integer per status while content
 * files name them as strings. The order is derived from the content enum rather
 * than restated, so the two cannot drift: adding a status to
 * `content/schema/common.ts` widens these arrays automatically.
 */
export const STATUS_COUNT = STATUS_IDS.length;

export const STATUS_INDEX: Readonly<Record<StatusId, number>> = Object.freeze(
  Object.fromEntries(STATUS_IDS.map((id, index) => [id, index])) as Record<StatusId, number>,
);

export const STATUS_BY_INDEX: readonly StatusId[] = STATUS_IDS;

/** Offset of a status counter for an entity slot. */
export function statusSlot(entity: number, status: number): number {
  return entity * STATUS_COUNT + status;
}
