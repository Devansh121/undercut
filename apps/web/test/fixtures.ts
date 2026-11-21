import { Track } from '@undercut/track';
import raw from '@undercut/track/data/monza.json';

let monza: Track | null = null;

/** The real Monza track, built once per test file. */
export function loadMonza(): Track {
  monza ??= Track.fromJSON(raw);
  return monza;
}
