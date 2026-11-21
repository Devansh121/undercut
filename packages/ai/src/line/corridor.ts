import { LEFT, RIGHT, type Track } from '@undercut/track';

/**
 * Where the car's centre may run: per centreline sample, the lowest and highest lateral offset
 * d (positive left). The track edges come in by the car's half track (wheel centre to car
 * centre) and a safety margin; where a kerb is listed in `kerbUse`, the wheel centre may ride
 * that far onto it. Inside a bend the (s, d) frame folds short of the centre of curvature, so
 * the corridor never reaches past the track's frame limit either.
 */
export interface CorridorOptions {
  /** Wheel-centre half track of the car, m (the wider axle). */
  halfTrack: number;
  /** Distance kept between the wheel centre and the track edge or kerb allowance, m. */
  margin: number;
  /** Per kerb profile name, how far the wheel centre may go onto the kerb, m. Absent: not used. */
  kerbUse: Readonly<Record<string, number>>;
}

export interface Corridor {
  /** Lowest d (right-most position, negative on the right), per centreline sample. */
  readonly lo: Float64Array;
  /** Highest d (left-most position), per centreline sample. */
  readonly hi: Float64Array;
}

export function buildCorridor(track: Track, options: CorridorOptions): Corridor {
  const n = track.lap.count;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const names = track.kerbProfiles.map((p) => p.name);
  const allowance = (side: typeof LEFT | typeof RIGHT, i: number): number => {
    const k = track.kerb[side][i]!;
    if (k < 0) return 0;
    const use = options.kerbUse[names[k]!];
    return use === undefined ? 0 : Math.min(use, track.kerbProfiles[k]!.width);
  };
  for (let i = 0; i < n; i++) {
    const left =
      track.halfWidth[LEFT][i]! + allowance(LEFT, i) - options.halfTrack - options.margin;
    const right =
      track.halfWidth[RIGHT][i]! + allowance(RIGHT, i) - options.halfTrack - options.margin;
    hi[i] = Math.min(left, track.frameLimit[LEFT][i]!);
    lo[i] = -Math.min(right, track.frameLimit[RIGHT][i]!);
    if (!(lo[i]! < hi[i]!)) throw new Error(`corridor closes at sample ${i}`);
  }
  return { lo, hi };
}
