/**
 * Online, each seat races in its own livery: seat k takes team k mod 10 and that team's first
 * driver's number (the second driver's for seats 10 to 19), so eight players are eight teams and
 * every client agrees without a message. Choosing a team needs a field the protocol does not have
 * yet (docs/STATUS.md).
 */
import teams from '../../../../design/teams.json';

export interface SeatLivery {
  team: string;
  teamName: string;
  primary: string;
  secondary: string;
  accent: string;
  number: number;
  code: string;
}

export function seatLivery(seat: number): SeatLivery {
  const list = teams.teams;
  const n = list.length;
  const k = ((Math.floor(seat) % (2 * n)) + 2 * n) % (2 * n);
  const team = list[k % n] ?? list[0];
  if (!team) throw new Error('design/teams.json has no teams');
  const driver = team.drivers[Math.floor(k / n)] ?? team.drivers[0];
  return {
    team: team.id,
    teamName: team.name,
    primary: team.colours.primary,
    secondary: team.colours.secondary,
    accent: team.colours.accent,
    number: driver?.number ?? 0,
    code: driver?.code ?? team.code,
  };
}
