import type { CarPose } from '@undercut/sim';

/** Ghost samples per second of lap time. Poses in between are interpolated. */
export const GHOST_RATE = 20;
/**
 * Longest lap a ghost is recorded for, s. A lap still running after ten minutes (a parked car,
 * a long detour) stops recording: no such lap can be a record worth replaying, and the cap
 * bounds a recording at 12 000 samples (430 kB). Lap timing carries on regardless.
 */
export const MAX_GHOST_SECONDS = 600;
/** Most samples a stored ghost may hold (the cap plus the forced first and last samples). */
const MAX_SAMPLES = MAX_GHOST_SECONDS * GHOST_RATE + 2;
/** Slack for Float32 sample times against the Float64 lap time, s. */
const TIME_SLACK = 1e-3;
/** Rolling radius used to spin the ghost's wheels from the distance it covers, m. */
const GHOST_WHEEL_RADIUS = 0.355;
/** Per sample: lap time, distance into the lap, x, y, z, yaw, pitch, roll, steer. */
const STRIDE = 9;
const MAGIC = 0x55474831; // "UGH1"
const HEADER_BYTES = 20;

/**
 * A recorded lap: poses sampled at `GHOST_RATE` against lap time, plus the distance covered at
 * each sample so the HUD can compare the live lap with it at the same point of the track.
 */
export class Ghost {
  readonly lapTime: number;
  readonly data: Float32Array;

  constructor(lapTime: number, data: Float32Array) {
    this.lapTime = lapTime;
    this.data = data;
  }

  get count(): number {
    return this.data.length / STRIDE;
  }

  /** Fill `out` with the pose at lap time `t`. False outside the lap or with too few samples. */
  poseAt(t: number, out: CarPose): boolean {
    const n = Math.floor(this.count);
    const d = this.data;
    if (n < 2 || !Number.isFinite(t) || t < 0 || t > this.lapTime) return false;
    let i = Math.min(n - 2, Math.max(0, Math.floor(t * GHOST_RATE)));
    // Sample times are nominal; step to the bracketing pair in case of jitter.
    while (i > 0 && (d[i * STRIDE] as number) > t) i--;
    while (i < n - 2 && (d[(i + 1) * STRIDE] as number) <= t) i++;
    const a = i * STRIDE;
    const b = n > 1 ? a + STRIDE : a;
    const ta = d[a] as number;
    const tb = d[b] as number;
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    const lerp = (k: number): number =>
      (d[a + k] as number) + ((d[b + k] as number) - (d[a + k] as number)) * f;
    out.x = lerp(2);
    out.y = lerp(3);
    out.z = lerp(4);
    out.yaw = lerpAngle(d[a + 5] as number, d[b + 5] as number, f);
    out.pitch = lerp(6);
    out.roll = lerp(7);
    out.steerAngle = lerp(8);
    const spin = wrap(lerp(1) / GHOST_WHEEL_RADIUS);
    for (let w = 0; w < 4; w++) {
      out.wheelAngle[w] = spin;
      out.wheelY[w] = out.y + GHOST_WHEEL_RADIUS;
    }
    return true;
  }

  /** Lap time at which the ghost had covered `distance` metres, or null beyond its lap. */
  timeAtDistance(distance: number): number | null {
    const n = Math.floor(this.count);
    const d = this.data;
    if (n < 2 || !Number.isFinite(distance) || distance < 0) return null;
    if (distance > (d[(n - 1) * STRIDE + 1] as number)) return null;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((d[mid * STRIDE + 1] as number) <= distance) lo = mid;
      else hi = mid;
    }
    const da = d[lo * STRIDE + 1] as number;
    const db = d[hi * STRIDE + 1] as number;
    const ta = d[lo * STRIDE] as number;
    const tb = d[hi * STRIDE] as number;
    if (db <= da) return ta;
    return ta + ((distance - da) / (db - da)) * (tb - ta);
  }
}

/** Records the current lap's poses; `finish` turns them into a Ghost. */
export class GhostRecorder {
  private samples: number[] = [];
  private next = 0;
  private active = false;

  get recording(): boolean {
    return this.active;
  }

  /** Samples held so far. */
  get sampleCount(): number {
    return this.samples.length / STRIDE;
  }

  begin(): void {
    this.samples = [];
    this.next = 0;
    this.active = true;
  }

  cancel(): void {
    this.active = false;
    this.samples = [];
  }

  /**
   * Offer the pose at lap time `t` with `distance` covered; kept when a sample is due, or always
   * with `force` (the lap's last pose, so playback reaches the line).
   */
  sample(t: number, distance: number, pose: CarPose, force = false): void {
    if (!this.active || (t < this.next && !force)) return;
    if (t > MAX_GHOST_SECONDS) {
      this.cancel();
      return;
    }
    this.samples.push(
      t,
      distance,
      pose.x,
      pose.y,
      pose.z,
      pose.yaw,
      pose.pitch,
      pose.roll,
      pose.steerAngle,
    );
    this.next = (Math.floor(t * GHOST_RATE + 1e-6) + 1) / GHOST_RATE;
  }

  finish(lapTime: number): Ghost {
    if (!this.active) throw new Error('GhostRecorder.finish without begin');
    this.active = false;
    const ghost = new Ghost(lapTime, Float32Array.from(this.samples));
    this.samples = [];
    return ghost;
  }
}

/** Compact text form for storage: a binary header and Float32 samples, base64. */
export function encodeGhost(ghost: Ghost): string {
  const bytes = new Uint8Array(HEADER_BYTES + ghost.data.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, ghost.count, true);
  view.setUint32(8, STRIDE, true);
  view.setFloat64(12, ghost.lapTime, true);
  bytes.set(
    new Uint8Array(ghost.data.buffer, ghost.data.byteOffset, ghost.data.byteLength),
    HEADER_BYTES,
  );
  let text = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(text);
}

/** Inverse of `encodeGhost`; null for anything malformed. */
export function decodeGhost(text: string): Ghost | null {
  try {
    if (!text) return null;
    const raw = atob(text);
    if (raw.length < HEADER_BYTES) return null;
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    if (view.getUint32(0, true) !== MAGIC) return null;
    const count = view.getUint32(4, true);
    if (view.getUint32(8, true) !== STRIDE) return null;
    const lapTime = view.getFloat64(12, true);
    if (count < 2 || count > MAX_SAMPLES) return null;
    if (!Number.isFinite(lapTime) || lapTime <= 0 || lapTime > MAX_GHOST_SECONDS + 1) return null;
    if (bytes.length !== HEADER_BYTES + count * STRIDE * 4) return null;
    const data = new Float32Array(bytes.buffer.slice(HEADER_BYTES));
    if (!data.every(Number.isFinite)) return null;
    // Times start at or after zero, never run backwards and end by the lap time; distance
    // never runs backwards.
    for (let i = 0; i < count; i++) {
      const t = data[i * STRIDE] as number;
      const dist = data[i * STRIDE + 1] as number;
      if (t < 0 || t > lapTime + TIME_SLACK || dist < 0) return null;
      if (
        i > 0 &&
        (t < (data[(i - 1) * STRIDE] as number) || dist < (data[(i - 1) * STRIDE + 1] as number))
      )
        return null;
    }
    return new Ghost(lapTime, data);
  } catch {
    return null;
  }
}

function wrap(a: number): number {
  const r = a % (2 * Math.PI);
  if (r > Math.PI) return r - 2 * Math.PI;
  if (r <= -Math.PI) return r + 2 * Math.PI;
  return r;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return wrap(a + d * t);
}
