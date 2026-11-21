/**
 * The last step before a remote car is drawn. The snapshot buffer (`RemoteCarBuffer`) already
 * interpolates, extrapolates briefly and fades a silent car; what it cannot avoid is a sudden
 * change of where it puts a car: the end of an extrapolation that guessed wrong, or a teleport.
 * Here a car never slides visibly across such a change:
 *
 * - a small one (under `snapM`) is eased in: the car keeps its motion from where it was drawn,
 *   and the difference decays with time constant `tauS`;
 * - a big one fades the car out where it was and back in at the new place (`fadeS` each way).
 *
 * Counts both, so the network roughness check can report them. Pure.
 */
import type { RemoteCarView } from '@undercut/protocol';

export const SMOOTHING = {
  /** A change of position this much past the car's own motion is a snap, m. */
  snapM: 8,
  /** Smaller changes than this are drawn as they come, m. */
  minCorrectionM: 0.25,
  /** Time constant of an eased correction, s. */
  tauS: 0.08,
  /** A correction has settled (under 1 %) after this long, s. */
  settleS: 0.5,
  /** Fade out, then in, across a snap, s each. */
  fadeS: 0.15,
} as const;

interface Vec {
  x: number;
  y: number;
  z: number;
}

interface SeatState {
  target: Vec;
  drawn: Vec;
  offset: Vec;
  /** A snap in progress: time into it and the view being faded out. */
  fade: { t: number; old: RemoteCarView } | null;
  last: RemoteCarView;
}

export interface SmootherStats {
  snaps: number;
  corrections: number;
  /** Largest change eased in, m. */
  maxCorrectionM: number;
}

export class RemoteCarSmoother {
  private readonly seats = new Map<number, SeatState>();
  readonly stats: SmootherStats = { snaps: 0, corrections: 0, maxCorrectionM: 0 };

  /** Views to draw this frame, `dt` seconds after the last call. Cars at opacity 0 are left out. */
  update(views: readonly RemoteCarView[], dt: number): RemoteCarView[] {
    const out: RemoteCarView[] = [];
    const seen = new Set<number>();
    const decay = Math.exp(-Math.max(0, dt) / SMOOTHING.tauS);
    for (const v of views) {
      seen.add(v.seat);
      let st = this.seats.get(v.seat);
      if (!st) {
        st = {
          target: { x: v.x, y: v.y, z: v.z },
          drawn: { x: v.x, y: v.y, z: v.z },
          offset: { x: 0, y: 0, z: 0 },
          fade: null,
          last: v,
        };
        this.seats.set(v.seat, st);
      } else if (!st.fade) {
        const px = st.target.x + v.vx * dt;
        const py = st.target.y + v.vy * dt;
        const pz = st.target.z + v.vz * dt;
        const excess = Math.hypot(v.x - px, v.y - py, v.z - pz);
        if (excess > SMOOTHING.snapM) {
          this.stats.snaps++;
          st.fade = { t: 0, old: { ...st.last, x: st.drawn.x, y: st.drawn.y, z: st.drawn.z } };
          st.offset = { x: 0, y: 0, z: 0 };
        } else {
          st.offset.x *= decay;
          st.offset.y *= decay;
          st.offset.z *= decay;
          if (excess > SMOOTHING.minCorrectionM) {
            this.stats.corrections++;
            this.stats.maxCorrectionM = Math.max(this.stats.maxCorrectionM, excess);
            // Keep drawing the car on from where it was; let the difference die away.
            st.offset.x = st.drawn.x + v.vx * dt - v.x;
            st.offset.y = st.drawn.y + v.vy * dt - v.y;
            st.offset.z = st.drawn.z + v.vz * dt - v.z;
          }
        }
      }
      st.target = { x: v.x, y: v.y, z: v.z };
      st.last = v;

      let shown: RemoteCarView;
      if (st.fade) {
        const f = st.fade;
        f.t += dt;
        const fs = SMOOTHING.fadeS;
        if (f.t < fs) {
          shown = { ...f.old, opacity: v.opacity * (1 - f.t / fs) };
        } else {
          shown = { ...v, opacity: v.opacity * Math.min(1, (f.t - fs) / fs) };
          if (f.t >= 2 * fs) st.fade = null;
        }
        if (f.t >= fs) st.drawn = { x: v.x, y: v.y, z: v.z };
      } else {
        st.drawn = {
          x: v.x + st.offset.x,
          y: v.y + st.offset.y,
          z: v.z + st.offset.z,
        };
        shown = { ...v, x: st.drawn.x, y: st.drawn.y, z: st.drawn.z };
      }
      if (shown.opacity > 0) out.push(shown);
    }
    for (const seat of [...this.seats.keys()]) if (!seen.has(seat)) this.seats.delete(seat);
    return out;
  }

  clear(): void {
    this.seats.clear();
  }
}
