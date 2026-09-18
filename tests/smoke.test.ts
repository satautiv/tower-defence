import { describe, expect, it } from 'vitest';
import {
  GAME_SPEEDS,
  MAX_CATCHUP_STEPS,
  SPATIAL_CELL_SIZE,
  TICK_HZ,
  TICK_MS,
  TICK_SECONDS,
  TILE_SIZE,
} from '@core/constants';

describe('core constants', () => {
  it('derives tick timings consistently from the tick rate', () => {
    expect(TICK_MS * TICK_HZ).toBeCloseTo(1000, 10);
    expect(TICK_SECONDS * TICK_HZ).toBeCloseTo(1, 10);
  });

  it('sizes spatial hash cells to a whole number of tiles', () => {
    expect(SPATIAL_CELL_SIZE % TILE_SIZE).toBe(0);
  });

  it('bounds catch-up so a stalled frame cannot spiral', () => {
    expect(MAX_CATCHUP_STEPS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_CATCHUP_STEPS)).toBe(true);
  });

  it('exposes game speeds as positive integers starting at real time', () => {
    expect(GAME_SPEEDS[0]).toBe(1);
    for (const speed of GAME_SPEEDS) {
      expect(Number.isInteger(speed)).toBe(true);
      expect(speed).toBeGreaterThan(0);
    }
  });
});
