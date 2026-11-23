import { BROKEN_OBJECT_WORDS } from './contracts';
import type { CarState } from './state';

const RAD_TO_RPM = 60 / (2 * Math.PI);

/**
 * What the HUD, audio and renderer read from a car. Filled in place by `readCarTelemetry`;
 * consumers never touch the state. SI units; frames as in `CarState`.
 */
export interface CarTelemetry {
  /** Forward speed, m/s (negative when reversing). */
  speed: number;
  engineRpm: number;
  /** −1 reverse, 0 neutral, 1–8. While shifting, the gear being left. */
  gear: number;
  shifting: boolean;
  /** Pedals as applied by the car (after pit limiter and fuel cut). */
  throttle: number;
  brake: number;
  /** Accelerometer readings in g: forward, left, and vertical (1 at rest on flat ground). */
  longG: number;
  latG: number;
  vertG: number;
  /** Per wheel, FL, FR, RL, RR. */
  wheelLoad: Float64Array;
  slipRatio: Float64Array;
  /** Slip angle, rad, positive when the tyre pushes to the left. */
  slipAngle: Float64Array;
  /** Spin angle, rad, wrapped to (−π, π]; and spin rate, rad/s. */
  wheelAngle: Float64Array;
  wheelSpeed: Float64Array;
  /** Suspension compression relative to the static dry car, m (positive = bump). */
  suspensionTravel: Float64Array;
  /** Road-wheel steer angle, rad, positive left. */
  steerAngle: number;
  /** Body: heave (world height of the floor reference), pitch (nose up), roll (right down). */
  heave: number;
  pitch: number;
  roll: number;
  rideHeightFront: number;
  rideHeightRear: number;
  /** Energy store, J; per-lap deployment from it and harvest into it, J. */
  ersStore: number;
  ersDeployLap: number;
  ersHarvestLap: number;
  /** MGU-K power, W: positive deploying, negative harvesting. */
  mgukPower: number;
  ersMode: number;
  /** DRS flap position, 0 closed to 1 open. */
  drs: number;
  fuelMass: number;
  downforce: number;
  drag: number;
  /** World position and heading. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  distance: number;
  /**
   * Contact with other cars on the last step: how many it touched, the total impulse they gave
   * it, N·s, and the largest closing speed at a contact, m/s. For damage and audio.
   */
  carContacts: number;
  carContactImpulse: number;
  carContactSpeed: number;
  /** Largest speed into a barrier at a contact on the last step, m/s; 0 when nothing hit. */
  wallImpact: number;
  /** Equivalent impact speed for a lightweight panel, m/s. */
  breakableImpact: number;
  /** A body corner is touching a barrier. */
  wallContact: boolean;
}

export function createCarTelemetry(): CarTelemetry {
  return {
    speed: 0,
    engineRpm: 0,
    gear: 0,
    shifting: false,
    throttle: 0,
    brake: 0,
    longG: 0,
    latG: 0,
    vertG: 0,
    wheelLoad: new Float64Array(4),
    slipRatio: new Float64Array(4),
    slipAngle: new Float64Array(4),
    wheelAngle: new Float64Array(4),
    wheelSpeed: new Float64Array(4),
    suspensionTravel: new Float64Array(4),
    steerAngle: 0,
    heave: 0,
    pitch: 0,
    roll: 0,
    rideHeightFront: 0,
    rideHeightRear: 0,
    ersStore: 0,
    ersDeployLap: 0,
    ersHarvestLap: 0,
    mgukPower: 0,
    ersMode: 0,
    drs: 0,
    fuelMass: 0,
    downforce: 0,
    drag: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    distance: 0,
    carContacts: 0,
    carContactImpulse: 0,
    carContactSpeed: 0,
    wallImpact: 0,
    breakableImpact: 0,
    wallContact: false,
  };
}

/** Copy the readable view of `state` into `out`. Allocation-free. */
export function readCarTelemetry(
  state: CarState,
  out: CarTelemetry,
  gravity = 9.80665,
): CarTelemetry {
  out.speed = state.vx;
  out.engineRpm = state.engineSpeed * RAD_TO_RPM;
  out.gear = state.gear;
  out.shifting = state.shiftTimer > 0;
  out.throttle = state.throttleApplied;
  out.brake = state.brakeApplied;
  out.longG = state.accelX / gravity;
  out.latG = state.accelY / gravity;
  out.vertG = state.accelVertical / gravity;
  for (let i = 0; i < 4; i++) {
    out.wheelLoad[i] = state.load[i]!;
    out.slipRatio[i] = state.slipRatio[i]!;
    out.slipAngle[i] = Math.atan(state.slipTan[i]!);
    out.wheelAngle[i] = state.wheelAngle[i]!;
    out.wheelSpeed[i] = state.wheelSpeed[i]!;
    out.suspensionTravel[i] = state.travel[i]!;
  }
  out.steerAngle = state.steerAngle;
  out.heave = state.y;
  out.pitch = state.pitch;
  out.roll = state.roll;
  out.rideHeightFront = state.rideHeightFront;
  out.rideHeightRear = state.rideHeightRear;
  out.ersStore = state.ersStore;
  out.ersDeployLap = state.ersDeployLap;
  out.ersHarvestLap = state.ersHarvestLap;
  out.mgukPower = state.mgukPower;
  out.ersMode = state.ersMode;
  out.drs = state.drsPosition;
  out.fuelMass = state.fuelMass;
  out.downforce = state.downforceFront + state.downforceRear;
  out.drag = state.dragForce;
  out.x = state.x;
  out.y = state.y;
  out.z = state.z;
  out.yaw = state.yaw;
  out.distance = state.distance;
  out.carContacts = state.carContacts;
  out.carContactImpulse = state.carContactImpulse;
  out.carContactSpeed = state.carContactSpeed;
  out.wallImpact = state.wallImpactSpeed;
  out.breakableImpact = state.breakableImpactSpeed;
  out.wallContact = state.wallContact !== 0;
  return out;
}

/** What a renderer needs to draw a car between two sim steps. */
export interface CarPose {
  /** Four recent board hits: id, age (s), world vx/vz (m/s), repeated. */
  breakableHits?: Float64Array;
  brokenObjects?: Uint32Array;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  steerAngle: number;
  /** Wheel-centre heights (world Y) and spin angles, FL, FR, RL, RR. */
  wheelY: Float64Array;
  wheelAngle: Float64Array;
}

export function createCarPose(): CarPose {
  return {
    brokenObjects: new Uint32Array(BROKEN_OBJECT_WORDS),
    breakableHits: new Float64Array([-1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0]),
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    steerAngle: 0,
    wheelY: new Float64Array(4),
    wheelAngle: new Float64Array(4),
  };
}

/** Copy the drawable pose of a state. */
export function readCarPose(state: CarState, out: CarPose): CarPose {
  (out.brokenObjects ??= new Uint32Array(BROKEN_OBJECT_WORDS)).set(state.brokenObjects);
  const hits = (out.breakableHits ??= new Float64Array(16));
  for (let i = 0; i < 4; i++) {
    hits[i * 4] = state.hitObject[i]!;
    hits[i * 4 + 1] = Math.max(
      0,
      Math.round((state.contactTime - state.hitTime[i]!) * 1000) / 1000,
    );
    hits[i * 4 + 2] = state.hitVx[i]!;
    hits[i * 4 + 3] = state.hitVz[i]!;
  }
  out.x = state.x;
  out.y = state.y;
  out.z = state.z;
  out.yaw = state.yaw;
  out.pitch = state.pitch;
  out.roll = state.roll;
  out.steerAngle = state.steerAngle;
  for (let i = 0; i < 4; i++) {
    out.wheelY[i] = state.wheelY[i]!;
    out.wheelAngle[i] = state.wheelAngle[i]!;
  }
  return out;
}

/**
 * Pose between two consecutive sim steps, `alpha` in [0, 1] (the fixed-step accumulator's
 * alpha). Angles take the short way round.
 */
export function interpolateCarPose(a: CarPose, b: CarPose, alpha: number, out: CarPose): CarPose {
  if (b.brokenObjects)
    (out.brokenObjects ??= new Uint32Array(BROKEN_OBJECT_WORDS)).set(b.brokenObjects);
  if (b.breakableHits) (out.breakableHits ??= new Float64Array(16)).set(b.breakableHits);
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = lerpAngle(a.yaw, b.yaw, t);
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.roll = a.roll + (b.roll - a.roll) * t;
  out.steerAngle = a.steerAngle + (b.steerAngle - a.steerAngle) * t;
  for (let i = 0; i < 4; i++) {
    out.wheelY[i] = a.wheelY[i]! + (b.wheelY[i]! - a.wheelY[i]!) * t;
    out.wheelAngle[i] = lerpAngle(a.wheelAngle[i]!, b.wheelAngle[i]!, t);
  }
  return out;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  let r = a + d * t;
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}
