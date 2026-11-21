import type { AudioCarState } from '@undercut/audio';
import {
  computeMass,
  createSurfaceHint,
  createSurfaceSample,
  SurfaceKind,
  type CarState,
  type CarTelemetry,
  type SurfaceSampler,
} from '@undercut/sim';

/**
 * Spacing of the ridges a tyre feels crossing a kerb, m, so the rumble rate is speed / spacing.
 * An estimate: painted kerbs have shallow ribs about a quarter of a metre apart.
 */
export const KERB_RIDGE_SPACING = 0.25;
/** Below this floor height at an axle (m) the plank starts to touch; full scrape 6 mm lower. */
const BOTTOMING_START = 0.002;
const BOTTOMING_RANGE = 0.006;
/** The turbo has little to give below this engine speed and is at full demand above the next. */
const BOOST_LOW_RPM = 6000;
const BOOST_HIGH_RPM = 10500;
const RAD_TO_RPM = 60 / (2 * Math.PI);

export interface AudioInputs {
  state: CarState;
  surface?: SurfaceSampler;
  /** Event seam until collision telemetry is available. */
  impactSpeed?: number;
  impactSerial?: number;
  telemetry: CarTelemetry;
  pitLimiter: boolean;
  /** Kerb roughness under the wheels, 0–1 (`DriveSession.kerbUnderWheels`). */
  kerbRoughness: number;
}

/**
 * The player's car as the audio engine wants it, in SI units: engine speed in rad/s, load from
 * the throttle the car actually applies (after traction control and fuel cut), shift flag and
 * direction, limiters, a boost demand from load and engine speed, MGU-K power, per-axle combined
 * slip, kerb rumble and plank contact. Fills and returns `out`.
 */
export function toAudioCarState(i: AudioInputs, out: AudioCarState): AudioCarState {
  const s = i.state;
  const t = i.telemetry;
  const rpm = s.engineSpeed * RAD_TO_RPM;
  out.engineOn = true;
  out.engineSpeed = s.engineSpeed;
  out.throttle = t.throttle;
  out.load = t.throttle;
  out.gear = s.gear;
  out.shifting = s.shiftTimer > 0;
  out.shiftDirection = out.shifting ? Math.sign(s.shiftTarget - s.gear) : 0;
  out.revLimiter = rpm >= s.model.params.engine.revLimit - 25 && t.throttle > 0.5;
  out.pitLimiter = i.pitLimiter;
  out.boost = t.throttle * clamp01((rpm - BOOST_LOW_RPM) / (BOOST_HIGH_RPM - BOOST_LOW_RPM));
  out.ersPower = t.mgukPower;
  out.speed = Math.abs(t.speed);
  out.slipFront = Math.max(slip(t, 0), slip(t, 1));
  out.slipRear = Math.max(slip(t, 2), slip(t, 3));
  out.slipRatioFront = signedMax(t.slipRatio[0]!, t.slipRatio[1]!);
  out.slipRatioRear = signedMax(t.slipRatio[2]!, t.slipRatio[3]!);
  out.drs = t.drs;
  out.impactSpeed = i.impactSpeed ?? 0;
  out.impactSerial = i.impactSerial ?? 0;
  out.grass = 0;
  out.gravel = 0;
  let kerb = i.kerbRoughness;
  if (i.surface) {
    computeMass(s.model, s.fuelMass, mass);
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    for (let w = 0; w < 4; w++) {
      const x = w < 2 ? mass.a : -mass.b;
      const z = s.model.wheelLeft[w]!;
      i.surface.sample(s.x + x * c - z * sn, s.z - x * sn - z * c, hints[w]!, patch);
      if (patch.kind === SurfaceKind.Kerb) kerb = Math.max(kerb, patch.roughness / 0.06);
      if (patch.kind === SurfaceKind.Grass) out.grass += 0.25;
      if (patch.kind === SurfaceKind.Gravel) out.gravel += 0.25;
    }
  }
  out.kerb = clamp01(kerb);
  out.kerbFrequency = out.kerb > 0 ? out.speed / KERB_RIDGE_SPACING : 0;
  const floor = Math.min(s.rideHeightFront, s.rideHeightRear);
  out.bottoming = clamp01((BOTTOMING_START - floor) / BOTTOMING_RANGE);
  return out;
}

function slip(t: CarTelemetry, i: number): number {
  return Math.hypot(t.slipRatio[i] as number, t.slipAngle[i] as number);
}

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

const mass = { total: 0, sprung: 0, a: 0, b: 0, sprungA: 0, sprungB: 0, yawInertia: 0 };
const hints = Array.from({ length: 4 }, () => createSurfaceHint());
const patch = createSurfaceSample();
function signedMax(a: number, b: number): number {
  return Math.abs(a) >= Math.abs(b) ? a : b;
}
