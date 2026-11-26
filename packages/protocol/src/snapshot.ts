/**
 * Binary car snapshots. Control messages are JSON; car state goes ~30 times a second
 * per car, so it has a fixed-size little-endian record of 94 bytes.
 *
 * Quantisation (worst-case round-trip error in brackets):
 *
 *   field            wire    unit                 range                  error
 *   seat             u8      index                0..19                  exact
 *   flags, resets    u8      bits 0-5: CAR_FLAG; bits 6-7: reset counter  exact
 *   tick             u32     sender sim tick      0..2^32-1              exact
 *   t                u32     ms after room epoch  0..49.7 days           0.5 ms
 *   x, y, z          i32     mm                   +-2147 km              0.5 mm
 *   yaw, pitch, roll i16     pi/32768 rad         -pi..pi (wrapped)      4.8e-5 rad
 *   vx, vy, vz       i16     cm/s                 +-327.67 m/s           5 mm/s
 *   yawRate          i16     mrad/s               +-32.767 rad/s         0.5 mrad/s
 *   steer            i8      1/127                -1..1                  0.004
 *   throttle, brake  u8      1/255                0..1                   0.002
 *   gear             i8      gear                 -1 (R), 0 (N), 1..8    exact
 *   rpm              u16     rpm                  0..65535               0.5 rpm
 *   wheelSpin[4]     i16     0.05 rad/s           +-1638 rad/s           0.025 rad/s
 *   lap              u16     laps completed       0..65535               exact
 *   s                u32     mm along centreline  0..4294 km             0.5 mm
 *   hits[4]          i16/u16/i16/i16  id, age ms, vx/vz cm/s (8 B each)
 *   broken set       u16 + u32  word index 0..63, its 32 bits    exact
 *
 * Angles are rounded to the nearest step and wrapped in 16-bit space, so values next to
 * +pi and -pi stay within half a step of the truth measured round the circle. Values
 * outside a range are clamped, and non-finite values encode as 0, so the encoder never
 * throws on bad sim output.
 *
 * `resets` counts teleports (reset to track, pit-box placement) modulo 4. A receiver
 * that sees it change between two snapshots must not interpolate across them.
 *
 * Frames:
 *
 *   up   (client to server): u8 kind=1, u8 count, count x record
 *   down (server to client): u8 kind=2, u8 count, u32 server receive time (ms after
 *                            epoch), count x record
 *
 * At 30 Hz with 20 cars a client receives 19 cars a tick: about 1.8 kB, or 54 kB/s.
 */
import { MAX_CARS } from './settings';

export const CAR_RECORD_BYTES = 94;
/** Words in the broken-object set (2048 lightweight objects); one rides in each record. */
export const BROKEN_SET_WORDS = 64;
export const UP_HEADER_BYTES = 2;
export const DOWN_HEADER_BYTES = 6;
export const FRAME_UP = 1;
export const FRAME_DOWN = 2;
export const MAX_UP_FRAME_BYTES = UP_HEADER_BYTES + MAX_CARS * CAR_RECORD_BYTES;
export const MAX_DOWN_FRAME_BYTES = DOWN_HEADER_BYTES + MAX_CARS * CAR_RECORD_BYTES;

/** Bits of `CarSnapshot.flags`. */
export const CAR_FLAG = {
  drs: 1,
  pitLane: 2,
  offTrack: 4,
  limiter: 8,
  ersDeploy: 16,
  retired: 32,
  /** No contact while a stopped AI recovers; retirement has the same physical treatment. */
  ghost: 32,
} as const;

/** Bits of the flags byte that carry CAR_FLAG; the top two carry `resets`. */
const FLAG_MASK = 0x3f;

export interface CarSnapshot {
  /** Four recent cosmetic impacts: id, age (s), world vx/vz (m/s), repeated. */
  breakableHits?: number[];
  /**
   * One word of the sender's set of broken lightweight objects, `brokenIndex` (0 to 63) and its
   * 32 bits as an unsigned number. Senders step the index every record, so a receiver that
   * joins late or misses hit events has the whole set within 64 records.
   */
  brokenIndex?: number;
  brokenWord?: number;
  seat: number;
  /** CAR_FLAG bits (0 to 63). */
  flags: number;
  /** Teleport counter, modulo 4: bump it whenever the car is placed rather than driven. */
  resets: number;
  /** Sender's fixed-step tick. Later snapshots have higher ticks. */
  tick: number;
  /** Sender's estimate of server time (ms since the Unix epoch) for this state. */
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  yawRate: number;
  steer: number;
  throttle: number;
  brake: number;
  gear: number;
  rpm: number;
  wheelSpin: [number, number, number, number];
  lap: number;
  s: number;
}

export interface UpFrame {
  cars: CarSnapshot[];
}

export interface DownFrame {
  /** Server receive time, ms since the Unix epoch. */
  receivedAt: number;
  cars: CarSnapshot[];
}

const ANGLE_SCALE = 32768 / Math.PI;

const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
const clampInt = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(fin(v))));

/** Wrap an angle into [-pi, pi). */
function wrap(a: number): number {
  const v = fin(a);
  const twoPi = 2 * Math.PI;
  return v - twoPi * Math.floor((v + Math.PI) / twoPi);
}

/**
 * An angle as a signed 16-bit step count. Rounding just below +pi gives 32768, which
 * is the same direction as -32768: wrap it rather than clamp it to 32767.
 */
function angle16(a: number): number {
  const q = Math.round(wrap(a) * ANGLE_SCALE);
  return ((q + 32768) & 0xffff) - 32768;
}

function writeCar(view: DataView, o: number, c: CarSnapshot, epoch: number): void {
  view.setUint8(o, clampInt(c.seat, 0, 255));
  view.setUint8(
    o + 1,
    (clampInt(c.flags, 0, 255) & FLAG_MASK) | ((clampInt(c.resets, 0, 0xffff) & 3) << 6),
  );
  view.setUint32(o + 2, clampInt(c.tick, 0, 0xffffffff), true);
  view.setUint32(o + 6, clampInt(c.t - epoch, 0, 0xffffffff), true);
  view.setInt32(o + 10, clampInt(c.x * 1000, -0x80000000, 0x7fffffff), true);
  view.setInt32(o + 14, clampInt(c.y * 1000, -0x80000000, 0x7fffffff), true);
  view.setInt32(o + 18, clampInt(c.z * 1000, -0x80000000, 0x7fffffff), true);
  view.setInt16(o + 22, angle16(c.yaw), true);
  view.setInt16(o + 24, angle16(c.pitch), true);
  view.setInt16(o + 26, angle16(c.roll), true);
  view.setInt16(o + 28, clampInt(c.vx * 100, -32768, 32767), true);
  view.setInt16(o + 30, clampInt(c.vy * 100, -32768, 32767), true);
  view.setInt16(o + 32, clampInt(c.vz * 100, -32768, 32767), true);
  view.setInt16(o + 34, clampInt(c.yawRate * 1000, -32768, 32767), true);
  view.setInt8(o + 36, clampInt(c.steer * 127, -127, 127));
  view.setUint8(o + 37, clampInt(c.throttle * 255, 0, 255));
  view.setUint8(o + 38, clampInt(c.brake * 255, 0, 255));
  view.setInt8(o + 39, clampInt(c.gear, -1, 8));
  view.setUint16(o + 40, clampInt(c.rpm, 0, 65535), true);
  for (let i = 0; i < 4; i++) {
    view.setInt16(o + 42 + i * 2, clampInt((c.wheelSpin[i] ?? 0) * 20, -32768, 32767), true);
  }
  view.setUint16(o + 50, clampInt(c.lap, 0, 65535), true);
  view.setUint32(o + 52, clampInt(c.s * 1000, 0, 0xffffffff), true);
  for (let i = 0; i < 4; i++) {
    const h = c.breakableHits;
    const k = i * 4,
      offset = o + 56 + i * 8;
    const id = h?.[k] ?? -1;
    view.setInt16(offset, clampInt(id, -1, 2047), true);
    view.setUint16(offset + 2, clampInt((h?.[k + 1] ?? 0) * 1000, 0, 65535), true);
    view.setInt16(offset + 4, clampInt((h?.[k + 2] ?? 0) * 100, -32768, 32767), true);
    view.setInt16(offset + 6, clampInt((h?.[k + 3] ?? 0) * 100, -32768, 32767), true);
  }
  view.setUint16(o + 88, clampInt(c.brokenIndex ?? 0, 0, BROKEN_SET_WORDS - 1), true);
  view.setUint32(o + 90, (c.brokenWord ?? 0) >>> 0, true);
}

function readCar(view: DataView, o: number, epoch: number): CarSnapshot {
  const hits: number[] = [];
  for (let i = 0; i < 4; i++) {
    const offset = o + 56 + i * 8;
    hits.push(
      view.getInt16(offset, true),
      view.getUint16(offset + 2, true) / 1000,
      view.getInt16(offset + 4, true) / 100,
      view.getInt16(offset + 6, true) / 100,
    );
  }
  return {
    ...(hits.some((id, i) => i % 4 === 0 && id >= 0) ? { breakableHits: hits } : {}),
    brokenIndex: view.getUint16(o + 88, true),
    brokenWord: view.getUint32(o + 90, true),
    seat: view.getUint8(o),
    flags: view.getUint8(o + 1) & FLAG_MASK,
    resets: view.getUint8(o + 1) >> 6,
    tick: view.getUint32(o + 2, true),
    t: epoch + view.getUint32(o + 6, true),
    x: view.getInt32(o + 10, true) / 1000,
    y: view.getInt32(o + 14, true) / 1000,
    z: view.getInt32(o + 18, true) / 1000,
    yaw: view.getInt16(o + 22, true) / ANGLE_SCALE,
    pitch: view.getInt16(o + 24, true) / ANGLE_SCALE,
    roll: view.getInt16(o + 26, true) / ANGLE_SCALE,
    vx: view.getInt16(o + 28, true) / 100,
    vy: view.getInt16(o + 30, true) / 100,
    vz: view.getInt16(o + 32, true) / 100,
    yawRate: view.getInt16(o + 34, true) / 1000,
    steer: view.getInt8(o + 36) / 127,
    throttle: view.getUint8(o + 37) / 255,
    brake: view.getUint8(o + 38) / 255,
    gear: view.getInt8(o + 39),
    rpm: view.getUint16(o + 40, true),
    wheelSpin: [
      view.getInt16(o + 42, true) / 20,
      view.getInt16(o + 44, true) / 20,
      view.getInt16(o + 46, true) / 20,
      view.getInt16(o + 48, true) / 20,
    ],
    lap: view.getUint16(o + 50, true),
    s: view.getUint32(o + 52, true) / 1000,
  };
}

/** Encode the cars one client owns (its own, plus AI if it is the host). */
export function encodeUpFrame(cars: readonly CarSnapshot[], epoch: number): Uint8Array {
  const count = Math.min(cars.length, MAX_CARS);
  const bytes = new Uint8Array(UP_HEADER_BYTES + count * CAR_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, FRAME_UP);
  view.setUint8(1, count);
  for (let i = 0; i < count; i++) {
    writeCar(view, UP_HEADER_BYTES + i * CAR_RECORD_BYTES, cars[i] as CarSnapshot, epoch);
  }
  return bytes;
}

export type FrameResult<T> = { ok: true; frame: T } | { ok: false; detail: string };

function viewOf(data: Uint8Array | ArrayBuffer): DataView {
  return data instanceof Uint8Array
    ? new DataView(data.buffer, data.byteOffset, data.byteLength)
    : new DataView(data);
}

/** Check one record's enumerated fields; the rest are any bit pattern. */
function recordProblem(car: CarSnapshot): string | null {
  if (car.seat >= MAX_CARS) return 'seat out of range';
  if (car.breakableHits?.some((v, i) => i % 4 === 0 && (v < -1 || v > 2047)))
    return 'object id out of range';
  if ((car.brokenIndex ?? 0) >= BROKEN_SET_WORDS) return 'broken-set word out of range';
  if (car.gear < -1 || car.gear > 8) return 'gear out of range';
  return null;
}

/** Decode a client's frame. Never throws; checks the exact length first. */
export function decodeUpFrame(data: Uint8Array | ArrayBuffer, epoch: number): FrameResult<UpFrame> {
  const view = viewOf(data);
  if (view.byteLength < UP_HEADER_BYTES) return { ok: false, detail: 'frame too short' };
  if (view.getUint8(0) !== FRAME_UP) return { ok: false, detail: 'not a snapshot frame' };
  const count = view.getUint8(1);
  if (count < 1 || count > MAX_CARS) return { ok: false, detail: 'car count out of range' };
  if (view.byteLength !== UP_HEADER_BYTES + count * CAR_RECORD_BYTES) {
    return { ok: false, detail: 'frame length does not match its car count' };
  }
  const cars: CarSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    const car = readCar(view, UP_HEADER_BYTES + i * CAR_RECORD_BYTES, epoch);
    const problem = recordProblem(car);
    if (problem) return { ok: false, detail: problem };
    cars.push(car);
  }
  return { ok: true, frame: { cars } };
}

/** Encode cars for relay, stamped with the server receive time. */
export function encodeDownFrame(
  cars: readonly CarSnapshot[],
  receivedAt: number,
  epoch: number,
): Uint8Array {
  const count = Math.min(cars.length, MAX_CARS);
  const bytes = new Uint8Array(DOWN_HEADER_BYTES + count * CAR_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, FRAME_DOWN);
  view.setUint8(1, count);
  view.setUint32(2, clampInt(receivedAt - epoch, 0, 0xffffffff), true);
  for (let i = 0; i < count; i++) {
    writeCar(view, DOWN_HEADER_BYTES + i * CAR_RECORD_BYTES, cars[i] as CarSnapshot, epoch);
  }
  return bytes;
}

/** Decode a relayed frame from the server. Never throws. */
export function decodeDownFrame(
  data: Uint8Array | ArrayBuffer,
  epoch: number,
): FrameResult<DownFrame> {
  const view = viewOf(data);
  if (view.byteLength < DOWN_HEADER_BYTES) return { ok: false, detail: 'frame too short' };
  if (view.getUint8(0) !== FRAME_DOWN) return { ok: false, detail: 'not a relay frame' };
  const count = view.getUint8(1);
  if (count > MAX_CARS) return { ok: false, detail: 'car count out of range' };
  if (view.byteLength !== DOWN_HEADER_BYTES + count * CAR_RECORD_BYTES) {
    return { ok: false, detail: 'frame length does not match its car count' };
  }
  const receivedAt = epoch + view.getUint32(2, true);
  const cars: CarSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    const car = readCar(view, DOWN_HEADER_BYTES + i * CAR_RECORD_BYTES, epoch);
    const problem = recordProblem(car);
    if (problem) return { ok: false, detail: problem };
    cars.push(car);
  }
  return { ok: true, frame: { receivedAt, cars } };
}

/** Ground speed of a snapshot, m/s. */
export const snapshotSpeed = (c: CarSnapshot): number => Math.hypot(c.vx, c.vy, c.vz);
