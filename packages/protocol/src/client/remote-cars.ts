/**
 * Remote cars at render time. Each car is shown at the same server time, a little in
 * the past (the interpolation delay), so there are usually snapshots on both sides of
 * it to interpolate between (cubic in position, from the snapshot velocities). The
 * delay is sized from measured transit time and jitter
 * of every sender. When snapshots stop, the car is extrapolated from its velocity for
 * a bounded time, then held in place, then faded out: the game treats a held or
 * fading car as a ghost (no collisions). A teleport (the sender's reset counter changes,
 * or a jump its velocities cannot explain) is never interpolated across: the car stays
 * where it was until the reset's timestamp, then appears at the new place.
 */
import type { CarSnapshot } from '../snapshot';

export interface RemoteCarOptions {
  /** Longest extrapolation past the newest snapshot, ms. */
  maxExtrapolationMs: number;
  /** After extrapolation stops, hold the car this long before fading, ms. */
  holdMs: number;
  /** Fade from opaque to invisible over this long, ms. */
  fadeMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** Snapshots kept per car. */
  capacity: number;
  /** Expected interval between a sender's snapshots, ms. */
  sendIntervalMs: number;
  /** Jitter margin in the delay: this many mean deviations. */
  jitterMultiplier: number;
  /** Largest change of the delay per sample() call, ms (keeps motion smooth). */
  delaySlewMs: number;
}

export const DEFAULT_REMOTE_CAR_OPTIONS: RemoteCarOptions = {
  maxExtrapolationMs: 250,
  holdMs: 1000,
  fadeMs: 500,
  minDelayMs: 50,
  maxDelayMs: 1000,
  capacity: 32,
  sendIntervalMs: 1000 / 30,
  jitterMultiplier: 3,
  delaySlewMs: 2,
};

export type RemoteCarMode = 'interpolated' | 'extrapolated' | 'held';

export interface RemoteCarView extends CarSnapshot {
  mode: RemoteCarMode;
  /** 1 normally; falls to 0 while a silent car fades. */
  opacity: number;
  /** How far past the newest snapshot this view is, ms (0 when interpolating). */
  aheadMs: number;
}

interface SeatBuffer {
  history: CarSnapshot[];
  /** Smoothed transit (arrival minus snapshot time) and its mean deviation, ms. */
  transit: number;
  jitter: number;
  samples: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
  return a + d * t;
}

/**
 * Cubic Hermite between two samples using their velocities as end tangents: follows
 * a curve through a gap left by lost snapshots far better than a straight line (on a
 * 75 m radius at 80 m/s across 100 ms: under a millimetre instead of about 15 cm).
 */
function hermite(p0: number, v0: number, p1: number, v1: number, s: number, dt: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * p0 +
    (s3 - 2 * s2 + s) * dt * v0 +
    (-2 * s3 + 3 * s2) * p1 +
    (s3 - s2) * dt * v1
  );
}

function interpolate(a: CarSnapshot, b: CarSnapshot, t: number): CarSnapshot {
  const near = t < 0.5 ? a : b;
  const dt = (b.t - a.t) / 1000;
  return {
    ...near,
    t: lerp(a.t, b.t, t),
    x: hermite(a.x, a.vx, b.x, b.vx, t, dt),
    y: hermite(a.y, a.vy, b.y, b.vy, t, dt),
    z: hermite(a.z, a.vz, b.z, b.vz, t, dt),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerpAngle(a.pitch, b.pitch, t),
    roll: lerpAngle(a.roll, b.roll, t),
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    vz: lerp(a.vz, b.vz, t),
    yawRate: lerp(a.yawRate, b.yawRate, t),
    steer: lerp(a.steer, b.steer, t),
    throttle: lerp(a.throttle, b.throttle, t),
    brake: lerp(a.brake, b.brake, t),
    rpm: lerp(a.rpm, b.rpm, t),
    wheelSpin: [
      lerp(a.wheelSpin[0], b.wheelSpin[0], t),
      lerp(a.wheelSpin[1], b.wheelSpin[1], t),
      lerp(a.wheelSpin[2], b.wheelSpin[2], t),
      lerp(a.wheelSpin[3], b.wheelSpin[3], t),
    ],
  };
}

/** Slack on top of the distance the velocities can explain, metres. */
const JUMP_SLACK_M = 5;

/**
 * Two snapshots that must not be joined by a curve: the sender bumped its reset
 * counter, or (if that snapshot was lost along with the bump being seen) the car moved
 * much further than either velocity allows in the time between them.
 */
export function discontinuous(a: CarSnapshot, b: CarSnapshot): boolean {
  if (a.resets !== b.resets) return true;
  const dt = Math.abs(b.t - a.t) / 1000;
  const speed = Math.max(Math.hypot(a.vx, a.vy, a.vz), Math.hypot(b.vx, b.vy, b.vz));
  const moved = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return moved > 1.5 * speed * dt + JUMP_SLACK_M;
}

function extrapolate(c: CarSnapshot, ms: number): CarSnapshot {
  const dt = ms / 1000;
  return {
    ...c,
    t: c.t + ms,
    x: c.x + c.vx * dt,
    y: c.y + c.vy * dt,
    z: c.z + c.vz * dt,
    yaw: c.yaw + c.yawRate * dt,
  };
}

export class RemoteCarBuffer {
  private readonly seats = new Map<number, SeatBuffer>();
  private readonly options: RemoteCarOptions;
  private delay: number | null = null;
  /** Snapshots accepted, and dropped as duplicates or too old. */
  accepted = 0;
  dropped = 0;

  constructor(options: Partial<RemoteCarOptions> = {}) {
    this.options = { ...DEFAULT_REMOTE_CAR_OPTIONS, ...options };
  }

  /** Add a snapshot that arrived at server time `arrivedAt` (the local clock estimate). */
  push(car: CarSnapshot, arrivedAt: number): void {
    let buf = this.seats.get(car.seat);
    if (!buf) {
      buf = { history: [], transit: arrivedAt - car.t, jitter: 0, samples: 0 };
      this.seats.set(car.seat, buf);
    }
    const h = buf.history;
    // Insert in time order; drop duplicates and anything older than the buffer.
    let i = h.length;
    while (i > 0 && (h[i - 1] as CarSnapshot).t > car.t) i--;
    const prev = h[i - 1];
    if ((prev && prev.tick === car.tick) || (prev && prev.t === car.t)) {
      this.dropped++;
      return;
    }
    if (i === 0 && h.length >= this.options.capacity) {
      this.dropped++;
      return;
    }
    h.splice(i, 0, car);
    if (h.length > this.options.capacity) h.shift();
    this.accepted++;

    // RFC 3550-style smoothing of transit time and its deviation.
    const transit = arrivedAt - car.t;
    buf.samples++;
    const g = buf.samples < 16 ? 1 / buf.samples : 1 / 16;
    const dev = Math.abs(transit - buf.transit);
    buf.transit += (transit - buf.transit) * g;
    buf.jitter += (dev - buf.jitter) * g;
  }

  remove(seat: number): void {
    this.seats.delete(seat);
  }

  clear(): void {
    this.seats.clear();
    this.delay = null;
  }

  /** Seats with at least one snapshot. */
  get seatList(): number[] {
    return [...this.seats.keys()].sort((a, b) => a - b);
  }

  /** Snapshots held in total (bounded by capacity per seat). */
  get size(): number {
    let n = 0;
    for (const b of this.seats.values()) n += b.history.length;
    return n;
  }

  /** The delay the buffer is aiming for, from current transit and jitter. */
  targetDelayMs(): number {
    const o = this.options;
    let worst = o.minDelayMs;
    for (const b of this.seats.values()) {
      if (b.history.length === 0) continue;
      worst = Math.max(worst, b.transit + o.sendIntervalMs + o.jitterMultiplier * b.jitter);
    }
    return Math.min(o.maxDelayMs, Math.max(o.minDelayMs, worst));
  }

  /** Current interpolation delay, ms. */
  get delayMs(): number {
    return this.delay ?? this.targetDelayMs();
  }

  /** Every remote car as it should be drawn at server time `serverNow`. */
  sample(serverNow: number): RemoteCarView[] {
    const target = this.targetDelayMs();
    if (this.delay === null) this.delay = target;
    else {
      const slew = this.options.delaySlewMs;
      this.delay += Math.max(-slew, Math.min(slew, target - this.delay));
    }
    const renderTime = serverNow - this.delay;
    const out: RemoteCarView[] = [];
    for (const seat of this.seatList) {
      const view = this.sampleSeat(seat, renderTime);
      if (view) out.push(view);
    }
    return out;
  }

  /** One car at an explicit server time (no delay applied). */
  sampleSeat(seat: number, renderTime: number): RemoteCarView | null {
    const h = this.seats.get(seat)?.history;
    if (!h || h.length === 0) return null;
    const first = h[0] as CarSnapshot;
    const last = h[h.length - 1] as CarSnapshot;
    if (renderTime <= first.t) return { ...first, mode: 'interpolated', opacity: 1, aheadMs: 0 };
    if (renderTime <= last.t) {
      let i = h.length - 1;
      while (i > 0 && (h[i - 1] as CarSnapshot).t > renderTime) i--;
      const a = h[i - 1] as CarSnapshot;
      const b = h[i] as CarSnapshot;
      if (discontinuous(a, b)) {
        // A teleport: keep the old place until the moment of the reset, then snap.
        const at = renderTime < b.t ? a : b;
        return { ...at, mode: 'interpolated', opacity: 1, aheadMs: 0 };
      }
      const t = b.t === a.t ? 1 : (renderTime - a.t) / (b.t - a.t);
      return { ...interpolate(a, b, t), mode: 'interpolated', opacity: 1, aheadMs: 0 };
    }
    const o = this.options;
    const ahead = renderTime - last.t;
    if (ahead <= o.maxExtrapolationMs) {
      return { ...extrapolate(last, ahead), mode: 'extrapolated', opacity: 1, aheadMs: ahead };
    }
    const past = ahead - o.maxExtrapolationMs - o.holdMs;
    const opacity = past <= 0 ? 1 : Math.max(0, 1 - past / o.fadeMs);
    return {
      ...extrapolate(last, o.maxExtrapolationMs),
      mode: 'held',
      opacity,
      aheadMs: ahead,
    };
  }
}
