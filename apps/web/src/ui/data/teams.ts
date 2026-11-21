/** The invented grid (design/teams.json) and compounds (design/compounds.json), typed for the UI. */
import teamsFile from '../../../../../design/teams.json';
import compoundsFile from '../../../../../design/compounds.json';

export interface Driver {
  number: number;
  code: string;
  first: string;
  last: string;
  nationality: string;
}

export interface Team {
  id: string;
  name: string;
  code: string;
  colours: { primary: string; secondary: string; accent: string; tower: string };
  drivers: [Driver, Driver];
}

export interface CompoundInfo {
  id: string;
  name: string;
  code: string;
  colour: string;
  marks: number;
}

export const TEAMS: readonly Team[] = teamsFile.teams as unknown as Team[];
export const COMPOUNDS: readonly CompoundInfo[] = compoundsFile.compounds;

export function teamById(id: string): Team {
  return TEAMS.find((t) => t.id === id) ?? (TEAMS[0] as Team);
}

export const DRIVER_COUNT = TEAMS.reduce((n, t) => n + t.drivers.length, 0);

/** Where the pre-rendered studio image of a team's car lives (tools/ui/team-cars.mjs). */
export function teamCarImage(teamId: string, driver: 0 | 1 = 0): string {
  return `assets/ui/cars/${teamId}-${driver + 1}.webp`;
}
