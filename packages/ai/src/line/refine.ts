import type { Corridor } from './corridor';

/**
 * Lap-time refinement of a racing line with the speed profile in the loop. The minimum-
 * curvature line is the fastest only where the car is always at its cornering limit; through
 * chicanes and onto long exits a straighter exit or a later apex is worth more than a wider
 * radius. Starting from the minimum-curvature line, smooth local bumps of the offset are tried
 * one at a time and kept when the lap time (as `evaluate` computes it) falls.
 *
 * The bump is ((1 + cos πu) / 2)² over |u| < 1, which is C² at its ends, so the line keeps
 * continuous curvature. A bump is scaled down rather than clipped where it would leave the
 * corridor. Deterministic: candidates are tried in a fixed order.
 */
export interface RefineOptions {
  /** Lap time of a candidate line (offsets per centreline sample), s. */
  evaluate: (d: Float64Array) => number;
  /** Samples where a bump may be centred (1 = allowed). */
  focus: Uint8Array;
  /** Bump half-widths, in samples. */
  widths: readonly number[];
  /** Bump amplitudes, m, largest first; each is a full sweep. */
  amplitudes: readonly number[];
  /** Distance between candidate centres, in samples. */
  spacing: number;
  /** Smallest improvement kept, s. */
  minGain?: number;
}

export interface RefineResult {
  d: Float64Array;
  lapTime: number;
  startLapTime: number;
  evaluations: number;
  accepted: number;
}

function bumpAt(n: number, centre: number, half: number, k: number): number {
  let off = k - centre;
  if (off > n / 2) off -= n;
  else if (off < -n / 2) off += n;
  const u = off / half;
  if (u <= -1 || u >= 1) return 0;
  const c = 0.5 * (1 + Math.cos(Math.PI * u));
  return c * c;
}

export function refineLine(
  corridor: Corridor,
  start: ArrayLike<number>,
  options: RefineOptions,
): RefineResult {
  const n = corridor.lo.length;
  const d = Float64Array.from(start);
  const trial = new Float64Array(n);
  const minGain = options.minGain ?? 1e-4;
  let best = options.evaluate(d);
  const startLapTime = best;
  let evaluations = 1;
  let accepted = 0;
  for (const amplitude of options.amplitudes) {
    for (const half of options.widths) {
      for (let c = 0; c < n; c += options.spacing) {
        if (!options.focus[c]) continue;
        for (const sign of [1, -1]) {
          // Largest amplitude up to `amplitude` that keeps the bump inside the corridor.
          let a = amplitude;
          const h = Math.ceil(half);
          for (let o = -h; o <= h; o++) {
            const k = (((c + o) % n) + n) % n;
            const b = bumpAt(n, c, half, k);
            if (b <= 0) continue;
            const room = sign > 0 ? corridor.hi[k]! - d[k]! : d[k]! - corridor.lo[k]!;
            if (room < a * b) a = Math.max(0, room / b);
          }
          if (a < 0.02) continue;
          trial.set(d);
          for (let o = -h; o <= h; o++) {
            const k = (((c + o) % n) + n) % n;
            trial[k] = trial[k]! + sign * a * bumpAt(n, c, half, k);
          }
          const t = options.evaluate(trial);
          evaluations++;
          if (t < best - minGain) {
            best = t;
            d.set(trial);
            accepted++;
            break; // keep this direction; move on to the next centre
          }
        }
      }
    }
  }
  return { d, lapTime: best, startLapTime, evaluations, accepted };
}
