/**
 * What the HUD shows.
 *
 * A flat bag of numbers, read from the simulation by polling rather than pushed
 * into the UI store. The simulation owns this state; the HUD is a view of it
 * (docs/TECH_DESIGN.md §10).
 */
export interface HudModel {
  lives: number;
  gold: number;
  aether: number;
  wave: number;
  totalWaves: number;
  speed: number;
  paused: boolean;
}

export type HudSource = () => HudModel;

/**
 * Stand-in until the simulation exists (#10).
 *
 * Returns a stable object so the throttled poll sees no change and the HUD does
 * not re-render — which is also what makes the idle-render test meaningful
 * before there is anything to idle on.
 */
const PLACEHOLDER: HudModel = {
  lives: 20,
  gold: 600,
  aether: 0,
  wave: 0,
  totalWaves: 10,
  speed: 1,
  paused: false,
};

export const placeholderHudSource: HudSource = () => PLACEHOLDER;
