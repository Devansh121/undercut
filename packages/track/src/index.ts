/** Track data model and loaders. Placeholder until M1 brings the first circuit. */

/**
 * A position in track coordinates: `s` metres along the centreline from the
 * start/finish line, `d` metres of lateral offset, positive to the left.
 */
export interface TrackCoord {
  s: number;
  d: number;
}
