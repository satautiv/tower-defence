import type { ThreatTag } from '@sim/index';

/** Words, not colours: the tag has to read without colour (docs/GAME_DESIGN.md §18). */
export const THREAT_LABEL: Readonly<Record<ThreatTag, string>> = {
  boss: 'Boss',
  air: 'Air',
  armoured: 'Armoured',
  warded: 'Warded',
  evasive: 'Evasive',
};

/** For a phone held landscape, where the full words would push a panel over plots. */
export const THREAT_SHORT: Readonly<Record<ThreatTag, string>> = {
  boss: 'Boss',
  air: 'Air',
  armoured: 'Arm',
  warded: 'Ward',
  evasive: 'Eva',
};
