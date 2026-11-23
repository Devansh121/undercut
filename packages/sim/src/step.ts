import { breakableContact } from './breakables';
import type { ControlInput, SurfaceHint, SurfaceSampler } from './contracts';
import { createWallSample } from './contracts';
import { PATCH_HINTS, createPatchSample, samplePatch, tyreVerticalForce } from './contact';
import type { Environment } from './environment';
import {
  BODY_HALF_WIDTH,
  BODY_NOSE,
  BODY_TAIL,
  BUMP_STOP_GAP,
  CONTACT_LIFT_MARGIN,
  DROOP_STOP_GAP,
  GROUND_STEP_RISE,
  STOP_RATE,
  WALL_FRICTION,
  WALL_RELEASE_INTO,
  WALL_RELEASE_SPEED,
  WALL_RESTITUTION,
  tyreBottomDeflection,
} from './model';
import type { AeroParams, EngineParams } from './params';
import { ErsMode, computeMass, gearRatio, type CarState, type MassState } from './state';
import { updateTyres } from './tyre-condition';
import { createTyreForce, tyreForce } from './tyre';

/**
 * Longest internal integration step, s. A 240 Hz world step runs as four substeps. The choice
 * and its measured cost are in docs/adr/0007-sim-integrator.md.
 */
export const MAX_SUBSTEP = 1 / 960;

/** Gauss–Seidel passes over the drivetrain constraints (clutch, differential, brakes). */
const DRIVETRAIN_ITERATIONS = 12;
/** Largest contact-patch deflection, as slip: the patch slides beyond this. */
const MAX_DEFLECT_SLIP = 1.5;
const MAX_DEFLECT_TAN = 3;
/** Pedal travel below which the brake counts as released (DRS latch, harvest). */
const BRAKE_ON = 0.02;
/** Idle governor gain, N·m per rad/s. */
const IDLE_GAIN = 10;
/** Pit limiter: 80 km/h ([2] Art. 34.7, doc 4.5), throttle gain per m/s below it. */
const PIT_LIMIT = 80 / 3.6;
const PIT_GAIN = 0.5;

/** ERS deployment per mode: power, the throttle it needs, and the speed it stops at. */
const ERS_MODES = [
  { power: 0, minThrottle: 2, maxSpeed: 0 },
  { power: 120e3, minThrottle: 0.95, maxSpeed: 300 / 3.6 },
  { power: 120e3, minThrottle: 0.5, maxSpeed: Infinity },
] as const;

// Per-step scratch. Module-level so the hot loop never allocates; the sim is single-threaded.
const mass: MassState = { total: 0, sprung: 0, a: 0, b: 0, sprungA: 0, sprungB: 0, yawInertia: 0 };
const wallSample = createWallSample();
const patch = createPatchSample();
// Per-step patch samples (`samplePatchesAhead`) and the ground of the current substep.
const patchStart = new Float64Array(4);
const patchEnd = new Float64Array(4);
const patchHeight = new Float64Array(4);
const patchGrip = new Float64Array(4);
const patchDrag = new Float64Array(4);
const patchNx = new Float64Array(4);
const patchNy = new Float64Array(4);
const patchNz = new Float64Array(4);
const damp = { damping: 0 };
const tf = createTyreForce();
const gh = new Float64Array(4);
const ghRate = new Float64Array(4);
const grip = new Float64Array(4);
const rollDrag = new Float64Array(4);
const tyreZ = new Float64Array(4);
const bodyZ = new Float64Array(4);
const bodyX = new Float64Array(4);
const unsprungZ = new Float64Array(4);
const wheelX = new Float64Array(4);
const aero = { front: 0, rear: 0, drag: 0 };
const stepRise = new Float64Array(4);
const stepLift = new Float64Array(4);
const cornerRise = new Float64Array(4);

/**
 * Advance one car by `dt` seconds. `input` is what reaches the car this step (after assists).
 * Deterministic: the same state, inputs and surface give bit-identical results on one machine.
 */
export function stepCar(
  state: CarState,
  input: ControlInput,
  surface: SurfaceSampler,
  dt: number,
  env: Environment,
): void {
  if (!(dt > 0)) return;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP - 1e-9));
  const h = dt / n;
  applyDriverRequests(state, input);
  state.breakableImpactSpeed = 0;
  state.wallImpactSpeed = 0;
  state.wallContact = 0;
  samplePatchesAhead(state, surface, dt);
  for (let k = 0; k < n; k++) {
    // The ground under each patch moves from where it was (groundY) to the patch sample at the
    // end of the step, evenly across the substeps.
    const f = (k + 1) / n;
    for (let i = 0; i < 4; i++) {
      patchHeight[i] = patchStart[i]! + (patchEnd[i]! - patchStart[i]!) * f;
    }
    state.contactTime += h;
    substep(state, input, surface, h, n, env);
    if (surface.breakables) breakableContact(state, surface.breakables);
  }
  // Tyre temperature and wear from this step, the grip for the next (no compound: nothing).
  if (state.tyreCompound >= 0) updateTyres(state, dt);
}

/**
 * Contact patches sampled once per step, not per substep: each wheel's patch grid is read where
 * the wheel will be at the end of the step (its position and the car's yaw carried forward by
 * the current velocities), and the substeps run the ground from the last height (`groundY`, part
 * of the snapshot) to it. The patch's normal, grip and drag are the end sample's. The prediction
 * misses the step's accelerations by about ½·a·dt² (under a millimetre); the next step starts
 * from wherever this one ended, so the ground stays continuous.
 */
function samplePatchesAhead(s: CarState, surface: SurfaceSampler, dt: number): void {
  const model = s.model;
  const tyre = model.params.tyre;
  computeMass(model, s.fuelMass, mass);
  const c0 = Math.cos(s.yaw);
  const s0 = Math.sin(s.yaw);
  const x = s.x + dt * (s.vx * c0 - s.vy * s0);
  const z = s.z + dt * (-s.vx * s0 - s.vy * c0);
  const yaw = s.yaw + dt * s.yawRate;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (let i = 0; i < 4; i++) {
    const bx = i < 2 ? mass.a : -mass.b;
    const by = model.wheelLeft[i]!;
    // The front patch turns with the steer.
    const yawW = i < 2 ? yaw + s.steerAngle : yaw;
    samplePatch(
      surface,
      x + bx * c - by * sn,
      z - bx * sn - by * c,
      i < 2 ? Math.cos(yawW) : c,
      i < 2 ? -Math.sin(yawW) : -sn,
      i < 2 ? tyre.patchWidthFront : tyre.patchWidthRear,
      tyre.patchLength,
      s.patchHints,
      i * PATCH_HINTS,
      patch,
    );
    patchStart[i] = s.groundY[i]!;
    patchEnd[i] = patch.height;
    patchGrip[i] = patch.grip;
    patchDrag[i] = patch.drag;
    patchNx[i] = patch.normalX;
    patchNy[i] = patch.normalY;
    patchNz[i] = patch.normalZ;
  }
}

const cornerMass: MassState = {
  total: 0,
  sprung: 0,
  a: 0,
  b: 0,
  sprungA: 0,
  sprungB: 0,
  yawInertia: 0,
};

/**
 * World (x, z) of the body's four footprint corners (front left, front right, rear left, rear
 * right) into `out` as x0, z0, x1, z1, ... Allocation-free.
 */
export function bodyCorners(state: CarState, out: Float64Array): Float64Array {
  const m = computeMass(state.model, state.fuelMass, cornerMass);
  const c = Math.cos(state.yaw);
  const sn = Math.sin(state.yaw);
  for (let k = 0; k < 4; k++) {
    const bx = k < 2 ? m.a + BODY_NOSE : -m.b - BODY_TAIL;
    const by = k % 2 === 0 ? BODY_HALF_WIDTH : -BODY_HALF_WIDTH;
    out[2 * k] = state.x + bx * c - by * sn;
    out[2 * k + 1] = state.z - bx * sn - by * c;
  }
  return out;
}

/** Begin a new ERS lap: the timing line (or pit entry) resets the per-lap counters. */
export function beginErsLap(state: CarState): void {
  state.ersDeployLap = 0;
  state.ersHarvestLap = 0;
}

/** Once-per-step requests: gear change, DRS latch, steer. */
function applyDriverRequests(s: CarState, input: ControlInput): void {
  const p = s.model.params;
  const steer = clamp(finite(input.steer), -1, 1);
  s.steerAngle = steer * p.geometry.maxSteerAngle;

  // DRS closes on the first brake application and stays shut until the request is released.
  if (!input.drs) s.drsLatched = 0;
  else if (finite(input.brake) > BRAKE_ON) s.drsLatched = 1;

  if (s.shiftTimer > 0 || input.gearShift === 0) return;
  const target = s.gear + (input.gearShift > 0 ? 1 : -1);
  const top = p.gearbox.ratios.length;
  if (target > top || target < -1) return;
  if (target === -1 && Math.abs(s.vx) > 1) return;
  // Gearbox output speed as the ECU judges it: locked rear wheels must not hide road speed.
  const R = p.tyre.rollingRadius;
  const carrier = Math.max(
    Math.abs(s.wheelSpeed[2]! + s.wheelSpeed[3]!) / 2,
    Math.abs(s.wheelSpeed[0]! + s.wheelSpeed[1]!) / 2,
    Math.abs(s.vx) / R,
  );
  if (target >= 1) {
    // Over-rev protection: refuse any shift that would put the engine past the limiter.
    const after = Math.abs(gearRatio(p, target) * carrier);
    if (after > rpm(p.engine.revLimit)) return;
  }
  s.shiftTarget = target;
  const time = target > s.gear ? p.gearbox.upshiftTime : p.gearbox.downshiftTime;
  if (time > 0) {
    s.shiftTimer = time;
    return;
  }
  // A seamless shift: the next gear takes the drive before the last one lets go, so there is no
  // torque cut. The ECU brings the engine to the new gear's speed (no inertia shock, as in a
  // timed shift) and the drive carries on in the same step.
  s.gear = target;
  if (target >= 1) {
    const axle = Math.abs(s.wheelSpeed[2]! + s.wheelSpeed[3]!) / 2;
    s.engineSpeed = Math.max(rpm(p.engine.idleRpm), Math.abs(gearRatio(p, target)) * axle);
  }
}

function substep(
  s: CarState,
  input: ControlInput,
  surface: SurfaceSampler,
  h: number,
  substeps: number,
  env: Environment,
): void {
  const model = s.model;
  const p = model.params;
  const tyre = p.tyre;
  const susp = p.suspension;
  const g = env.gravity;
  const R = tyre.rollingRadius;

  computeMass(model, s.fuelMass, mass);
  const m = mass.total;
  const ms = mass.sprung;

  // ---- Pedals as the car applies them (fuel cut, pit limiter). ----
  let throttle = clamp(finite(input.throttle), 0, 1);
  const brake = clamp(finite(input.brake), 0, 1);
  if (input.pitLimiter) throttle = Math.min(throttle, clamp((PIT_LIMIT - s.vx) * PIT_GAIN, 0, 1));
  if (s.fuelMass <= 0) throttle = 0;
  s.throttleApplied = throttle;
  s.brakeApplied = brake;

  // ---- Surface under each wheel. ----
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < 4; i++) {
    wheelX[i] = i < 2 ? mass.a : -mass.b;
    bodyX[i] = i < 2 ? mass.sprungA : -mass.sprungB;
    // The contact patch's ground for this substep (`samplePatchesAhead`).
    const height = patchHeight[i]!;
    ghRate[i] = (height - s.groundY[i]!) / h;
    gh[i] = height;
    s.groundY[i] = height;
    grip[i] = patchGrip[i]! * s.gripScale[i]!;
    rollDrag[i] = patchDrag[i]!;
    nx += patchNx[i]!;
    ny += patchNy[i]!;
    nz += patchNz[i]!;
  }
  const nInv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx *= nInv;
  ny *= nInv;
  nz *= nInv;
  const gNormal = g * ny;
  // Gravity along the surface, in the car's horizontal frame (forward, left).
  const gravX = gNormal * (nx * c - nz * sn);
  const gravY = gNormal * (-nx * sn - nz * c);

  // ---- Ground steps: lift the car out of ground it cannot have rolled onto. ----
  liftOutOfGround(s, h, substeps, mass.sprungA, mass.sprungB);

  // ---- Vertical: tyres, springs, anti-roll bars, dampers. ----
  const kt = tyre.verticalStiffness;
  const ct = tyre.verticalDamping;
  const tyreMax = model.tyreForceMax;
  for (let i = 0; i < 4; i++) {
    const comp = gh[i]! + tyre.freeRadius - s.wheelY[i]!;
    // A tyre only pushes, and never past its bottoming load: a step in the ground (a wheel
    // suddenly deep below it, or a huge ground rate) then gives a bounded force.
    let f = tyreVerticalForce(comp, ghRate[i]! - s.wheelVy[i]!, kt, ct, tyre.dampingOnset, damp);
    if (f > tyreMax) {
      damp.damping -= f - tyreMax;
      f = tyreMax;
    }
    tyreZ[i] = f;
    s.load[i] = f;
    s.tyreDamping[i] = damp.damping;
  }
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const yl = model.wheelLeft[i]!;
    const xb = bodyX[i]!;
    const len = s.y + xb * s.pitch + yl * s.roll - s.wheelY[i]!;
    const lenRate = s.heaveRate + xb * s.pitchRate + yl * s.rollRate - s.wheelVy[i]!;
    const comp = model.springFree[i]! - len;
    s.travel[i] = comp - model.staticCompression[i]!;
    let f =
      (front ? susp.springFront : susp.springRear) * comp -
      (front ? susp.damperFront : susp.damperRear) * lenRate;
    // Bump and droop stops bound the wheel's travel relative to the body.
    if (comp > BUMP_STOP_GAP) f += STOP_RATE * (comp - BUMP_STOP_GAP);
    else if (comp < -DROOP_STOP_GAP) f += STOP_RATE * (comp + DROOP_STOP_GAP);
    bodyZ[i] = f;
  }
  for (let axle = 0; axle < 2; axle++) {
    const l = axle * 2;
    const r = l + 1;
    const front = axle === 0;
    // Travel difference left minus right; positive pushes the left body corner up.
    const diff = s.travel[l]! - s.travel[r]!;
    const yl = model.wheelLeft[l]!;
    const xb = bodyX[l]!;
    const rateL = s.heaveRate + xb * s.pitchRate + yl * s.rollRate - s.wheelVy[l]!;
    const rateR = s.heaveRate + xb * s.pitchRate - yl * s.rollRate - s.wheelVy[r]!;
    const f =
      (front ? susp.antiRollFront : susp.antiRollRear) * diff -
      (front ? susp.rollDamperFront : susp.rollDamperRear) * (rateL - rateR);
    bodyZ[l] = bodyZ[l]! + f;
    bodyZ[r] = bodyZ[r]! - f;
  }

  // ---- Ride heights, aero, floor contact. ----
  const groundF = (gh[0]! + gh[1]!) / 2;
  const groundR = (gh[2]! + gh[3]!) / 2;
  const rideF = s.y + mass.sprungA * s.pitch - groundF;
  const rideR = s.y - mass.sprungB * s.pitch - groundR;
  s.rideHeightFront = rideF;
  s.rideHeightRear = rideR;

  const drsTarget = input.drs && s.drsLatched === 0 ? 1 : 0;
  if (drsTarget > s.drsPosition) {
    s.drsPosition = Math.min(1, s.drsPosition + h / p.aero.drsOpenTime);
  } else if (drsTarget < s.drsPosition) {
    s.drsPosition = Math.max(0, s.drsPosition - h / p.aero.drsCloseTime);
  }
  aeroCoefficients(p.aero, rideF, rideR, s.drsPosition, aero);
  const q = 0.5 * env.airDensity * s.vx * s.vx;
  const dfFront = q * aero.front * s.downforceScale;
  const dfRear = q * aero.rear * s.downforceScale;
  const drag = q * aero.drag * s.dragScale;
  s.downforceFront = dfFront;
  s.downforceRear = dfRear;
  s.dragForce = drag;
  // Floor contact: skid points at the floor edges by each axle. They take the plank's
  // bottoming in heave and stop the body rolling past the point where the floor edge scrapes.
  let skidHeave = 0;
  let skidPitch = 0;
  let skidRoll = 0;
  let skidX = 0;
  let skidY = 0;
  let skidYaw = 0;
  const halfWidth = susp.floorHalfWidth;
  for (let k = 0; k < 4; k++) {
    const front = k < 2;
    const yl = k % 2 === 0 ? halfWidth : -halfWidth;
    const xb = front ? mass.sprungA : -mass.sprungB;
    const l = front ? 0 : 2;
    const half = front ? model.wheelLeft[0]! : model.wheelLeft[2]!;
    const across = yl / (2 * half);
    const ground = (gh[l]! + gh[l + 1]!) / 2 + across * (gh[l]! - gh[l + 1]!);
    const height = s.y + xb * s.pitch + yl * s.roll - ground;
    if (height >= 0) continue;
    const groundRate = (ghRate[l]! + ghRate[l + 1]!) / 2 + across * (ghRate[l]! - ghRate[l + 1]!);
    const rate = s.heaveRate + xb * s.pitchRate + yl * s.rollRate - groundRate;
    let n = -0.5 * susp.plankStiffness * height - 0.5 * susp.plankDamping * rate;
    if (n <= 0) continue;
    // A skid passes at most a tyre's bottoming load. A raised kerb that puts the floor's edge
    // in deeper than the plank can lift is a floor strike, resolved inelastically below
    // (`liftOutOfGround`): a stronger floor spring would throw the car off the kerb instead.
    if (n > model.tyreForceMax) n = model.tyreForceMax;
    skidHeave += n;
    skidPitch += n * xb;
    skidRoll += n * yl;
    const px = front ? mass.a : -mass.b;
    const vpx = s.vx - s.yawRate * yl;
    const vpy = s.vy + s.yawRate * px;
    const scale = (susp.plankFriction * n) / (Math.sqrt(vpx * vpx + vpy * vpy) + 0.1);
    skidX -= scale * vpx;
    skidY -= scale * vpy;
    skidYaw += px * -scale * vpy + yl * scale * vpx;
  }

  s.plankForce = skidHeave;

  // ---- Tyre slip and force (transient contact-patch deflection). ----
  const curve = model.curve;
  const steer = s.steerAngle;
  const cd = Math.cos(steer);
  const sd = Math.sin(steer);
  let sumX = 0;
  let sumY = 0;
  let yawMoment = 0;
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const yl = model.wheelLeft[i]!;
    const vcx = s.vx - s.yawRate * yl;
    const vcy = s.vy + s.yawRate * wheelX[i]!;
    const ci = front ? cd : 1;
    const si = front ? sd : 0;
    const vLong = vcx * ci + vcy * si;
    const vLat = -vcx * si + vcy * ci;
    const speed = Math.abs(vLong);
    // Implicit decay keeps this stable at any speed; at standstill it is a spring.
    const oldX = s.deflectX[i]!;
    const oldY = s.deflectY[i]!;
    const limX = tyre.relaxationX * MAX_DEFLECT_SLIP;
    const limY = tyre.relaxationY * MAX_DEFLECT_TAN;
    const ux = clamp(
      (oldX + h * (s.wheelSpeed[i]! * R - vLong)) / (1 + (h * speed) / tyre.relaxationX),
      -limX,
      limX,
    );
    const uy = clamp((oldY - h * vLat) / (1 + (h * speed) / tyre.relaxationY), -limY, limY);
    s.deflectX[i] = ux;
    s.deflectY[i] = uy;
    const kappa = ux / tyre.relaxationX;
    const tanA = uy / tyre.relaxationY;
    s.slipRatio[i] = kappa;
    s.slipTan[i] = tanA;
    tyreForce(curve, tyreZ[i]!, kappa, tanA, grip[i]!, tf);
    let fx = tf.fx;
    let fy = tf.fy;
    const w = 1 - speed / tyre.lowSpeed;
    if (w > 0 && tyreZ[i]! > 0) {
      if (tf.dx > 0 && tf.dy > 0) {
        fx += (w * tyre.carcassDampingX * (ux - oldX)) / h;
        fy += (w * tyre.carcassDampingY * (uy - oldY)) / h;
        // The damped force obeys the same combined friction limit as the steady force.
        const ex = fx / tf.dx;
        const ey = fy / tf.dy;
        const e = ex * ex + ey * ey;
        if (e > 1) {
          const k = 1 / Math.sqrt(e);
          fx *= k;
          fy *= k;
        }
      } else {
        // No friction available (zero grip): nothing bounds the damping, so no force.
        fx = 0;
        fy = 0;
      }
    }
    s.forceX[i] = fx;
    s.forceY[i] = fy;
    const fbx = fx * ci - fy * si;
    const fby = fx * si + fy * ci;
    sumX += fbx;
    sumY += fby;
    yawMoment += wheelX[i]! * fby - yl * fbx;
  }

  // ---- Power unit, ERS, brakes, wheel spin. ----
  stepPowertrain(s, throttle, brake, input.overtake, h, input.wheelBrake);

  // ---- Planar chassis (semi-implicit Euler). ----
  const extX = s.externalForceX * c - s.externalForceZ * sn;
  const extY = -s.externalForceX * sn - s.externalForceZ * c;
  const dragX = s.vx >= 0 ? -drag : drag;
  const groundX = sumX + skidX;
  const groundY = sumY + skidY;
  const specificX = (groundX + dragX + extX) / m;
  const specificY = (groundY + extY) / m;
  const ax = specificX + gravX + s.yawRate * s.vy;
  const ay = specificY + gravY - s.yawRate * s.vx;
  s.vx += h * ax;
  s.vy += h * ay;
  s.yawRate += (h * (yawMoment + skidYaw + s.externalTorque)) / mass.yawInertia;
  s.x += h * (s.vx * c - s.vy * sn);
  s.z += h * (-s.vx * sn - s.vy * c);
  s.yaw += h * s.yawRate;
  if (s.yaw > Math.PI) s.yaw -= 2 * Math.PI;
  else if (s.yaw < -Math.PI) s.yaw += 2 * Math.PI;
  s.distance += h * Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  s.accelX = specificX;
  s.accelY = specificY;

  // ---- Barriers. ----
  if (surface.wall) wallContact(s, surface, m, mass.yawInertia, mass.a, mass.b);

  // ---- Sprung and unsprung vertical motion. ----
  // The ground forces' overturning moment, h·ΣF about the whole car's CoG height, splits in
  // two. The sprung mass, whose CoG sits at hs, takes its share through the links at the ground
  // and so through the springs. The unsprung masses' inertia acts at the wheel centres and goes
  // straight to the tyres. With hs = (m·h − mu·r) / ms the two add up to exactly h·ΣF.
  const mu = m - ms;
  const rw = p.tyre.rollingRadius;
  const hs = (m * p.mass.cgHeight - mu * rw) / ms;
  const linkX = (ms / m) * groundX - (mu / m) * (dragX + extX);
  const linkY = (ms / m) * groundY - (mu / m) * extY;
  let heave = skidHeave - dfFront - dfRear;
  let pitchM = skidPitch - dfFront * mass.sprungA + dfRear * mass.sprungB;
  let rollM = skidRoll;
  for (let i = 0; i < 4; i++) {
    const f = bodyZ[i]!;
    heave += f;
    pitchM += f * bodyX[i]!;
    rollM += f * model.wheelLeft[i]!;
  }
  pitchM += hs * linkX;
  rollM += hs * linkY;
  // Unsprung inertia couples, as equal and opposite vertical forces on the wheels.
  const pitchU = ((mu / m) * (groundX + dragX + extX) * rw) / p.geometry.wheelbase / 2;
  const muFront = 2 * p.mass.unsprungFront;
  const muRear = 2 * p.mass.unsprungRear;
  const rollUF = ((muFront / m) * (groundY + extY) * rw) / p.geometry.trackFront;
  const rollUR = ((muRear / m) * (groundY + extY) * rw) / p.geometry.trackRear;
  unsprungZ[0] = pitchU + rollUF;
  unsprungZ[1] = pitchU - rollUF;
  unsprungZ[2] = -pitchU + rollUR;
  unsprungZ[3] = -pitchU - rollUR;
  const heaveAcc = heave / ms - gNormal;
  s.heaveRate += h * heaveAcc;
  s.pitchRate += (h * pitchM) / p.mass.pitchInertia;
  s.rollRate += (h * rollM) / p.mass.rollInertia;
  s.y += h * s.heaveRate;
  s.pitch += h * s.pitchRate;
  s.roll += h * s.rollRate;
  s.accelVertical = heaveAcc + gNormal;
  for (let i = 0; i < 4; i++) {
    const mw = i < 2 ? p.mass.unsprungFront : p.mass.unsprungRear;
    s.wheelVy[i] = s.wheelVy[i]! + h * ((tyreZ[i]! - bodyZ[i]! + unsprungZ[i]!) / mw - gNormal);
    s.wheelY[i] = s.wheelY[i]! + h * s.wheelVy[i]!;
    let a = s.wheelAngle[i]! + h * s.wheelSpeed[i]!;
    if (a > Math.PI) a -= 2 * Math.PI;
    else if (a < -Math.PI) a += 2 * Math.PI;
    s.wheelAngle[i] = a;
  }
}

/**
 * Barrier contact at the body's four footprint corners, resolved every substep. A corner behind
 * a barrier face is pushed back onto it (the whole car moves; position only). If that corner is
 * moving into the face, a planar impulse at the corner removes its normal speed (keeping
 * WALL_RESTITUTION of it) and a friction impulse, at most WALL_FRICTION times the normal one,
 * scrubs its speed along the face. Applied at the corner, both impulses also change the yaw
 * rate, so a car that hits at an angle swings round and slides along the barrier. The largest
 * normal speed met on the step is kept as the impact speed. No damage here.
 */
function wallContact(
  s: CarState,
  surface: SurfaceSampler,
  m: number,
  inertia: number,
  a: number,
  b: number,
): void {
  for (let k = 0; k < 4; k++) {
    const c = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const bx = k < 2 ? a + BODY_NOSE : -b - BODY_TAIL;
    const by = k % 2 === 0 ? BODY_HALF_WIDTH : -BODY_HALF_WIDTH;
    // Corner offset from the CoG in the world frame.
    const rx = bx * c - by * sn;
    const rz = -bx * sn - by * c;
    surface.wall!(s.x + rx, s.z + rz, s.wallHints[k] as SurfaceHint, wallSample);
    const depth = wallSample.depth;
    if (!(depth > 0)) continue;
    const nx = wallSample.normalX;
    const nz = wallSample.normalZ;
    s.x += depth * nx;
    s.z += depth * nz;
    s.wallContact = 1;
    // Corner velocity, world frame: v + ω × r with ω about +Y.
    const vwx = s.vx * c - s.vy * sn;
    const vwz = -s.vx * sn - s.vy * c;
    const w = s.yawRate;
    const px = vwx + w * rz;
    const pz = vwz - w * rx;
    const vn = px * nx + pz * nz;
    if (vn >= 0) continue;
    if (-vn > s.wallImpactSpeed) s.wallImpactSpeed = -vn;
    // Tangent along the face and the corner's sliding speed on it.
    const tx = -nz;
    const tz = nx;
    const vt = px * tx + pz * tz;
    const rn = rz * nx - rx * nz;
    const rt = rz * tx - rx * tz;
    const jn = (-(1 + WALL_RESTITUTION) * vn) / (1 / m + (rn * rn) / inertia);
    let jt = -vt / (1 / m + (rt * rt) / inertia);
    const jmax = wallRelease(s, nx, nz, vn) ? 0 : WALL_FRICTION * jn;
    if (jt > jmax) jt = jmax;
    else if (jt < -jmax) jt = -jmax;
    const jx = jn * nx + jt * tx;
    const jz = jn * nz + jt * tz;
    // Back to the car's frame: forward and left components of the impulse.
    s.vx += (jx * c - jz * sn) / m;
    s.vy += (-jx * sn - jz * c) / m;
    s.yawRate += (rz * jx - rx * jz) / inertia;
  }
}

/** Whether a corner resting on a barrier lets the car drive off along or away from it. */
function wallRelease(s: CarState, nx: number, nz: number, vn: number): boolean {
  if (-vn > WALL_RELEASE_SPEED || s.throttleApplied <= 0 || s.gear === 0) return false;
  if (s.vx * s.vx + s.vy * s.vy > WALL_RELEASE_SPEED * WALL_RELEASE_SPEED) return false;
  // The front wheels' heading in the world, forward in a forward gear and back in reverse.
  const heading = s.yaw + s.steerAngle;
  const dir = s.gear < 0 ? -1 : 1;
  const into = -(Math.cos(heading) * nx - Math.sin(heading) * nz) * dir;
  return into <= WALL_RELEASE_INTO;
}

/**
 * The contact's last line of defence against ground no wheel could roll onto. Two rules, both
 * at position level and both counted in the state's diagnostics:
 *
 * - A step (the ground under a wheel rose more than GROUND_STEP_RISE into its tyre since the
 *   last substep): that corner of the car, wheel and body together, is lifted by the rise,
 *   pivoting about the diagonally opposite corner (the two adjacent corners rise by half). The
 *   wheels move with their body corners, so no spring or tyre compression changes and no
 *   velocity changes: the step adds potential energy only.
 * - Penetration no deflection explains (a wheel past its bottoming depth by CONTACT_LIFT_MARGIN,
 *   or a floor skid past its saturation depth): the car moves up until it is back at that depth
 *   and its downward velocity is removed, as in an inelastic rim or floor strike.
 */
function liftOutOfGround(
  s: CarState,
  h: number,
  substeps: number,
  sprungA: number,
  sprungB: number,
): void {
  const p = s.model.params;
  const R = p.tyre.freeRadius;
  // A step's size is the extra tyre compression it causes: for a wheel already in the air,
  // only the part of the rise that reaches above the tyre's free radius counts.
  for (let i = 0; i < 4; i++) {
    const comp = gh[i]! + R - s.wheelY[i]!;
    const before = comp - ghRate[i]! * h;
    stepRise[i] = comp - (before > 0 ? before : 0);
    stepLift[i] = 0;
  }
  for (let pass = 0; pass < 4; pass++) {
    let k = -1;
    // The contact patch is sampled once per step and its height spread evenly over the
    // substeps, so a step's rise arrives in `substeps` equal shares: compare each share.
    let most = GROUND_STEP_RISE / substeps;
    for (let i = 0; i < 4; i++) {
      const left = stepRise[i]! - stepLift[i]!;
      if (left > most) {
        most = left;
        k = i;
      }
    }
    if (k < 0) break;
    pivotCorner(s, k, most, sprungA, sprungB);
    s.groundSteps += 1;
  }
  // Relative to the moved car, each wheel's ground rose by its own rise less its lift.
  for (let i = 0; i < 4; i++) ghRate[i] = ghRate[i]! - stepLift[i]! / h;

  const depthMax = tyreBottomDeflection(p.tyre) + CONTACT_LIFT_MARGIN;
  const floorMax = s.model.tyreForceMax / (0.5 * p.suspension.plankStiffness);
  let lift = 0;
  for (let i = 0; i < 4; i++) {
    const over = gh[i]! + R - s.wheelY[i]! - depthMax;
    if (over > lift) lift = over;
  }
  const halfWidth = p.suspension.floorHalfWidth;
  for (let k = 0; k < 4; k++) {
    const front = k < 2;
    const yl = k % 2 === 0 ? halfWidth : -halfWidth;
    const xb = front ? sprungA : -sprungB;
    const l = front ? 0 : 2;
    const across = yl / (2 * s.model.wheelLeft[l]!);
    const ground = (gh[l]! + gh[l + 1]!) / 2 + across * (gh[l]! - gh[l + 1]!);
    const over = ground - (s.y + xb * s.pitch + yl * s.roll) - floorMax;
    if (over > lift) lift = over;
  }
  if (lift <= 0) return;
  s.y += lift;
  for (let i = 0; i < 4; i++) s.wheelY[i] = s.wheelY[i]! + lift;
  if (s.heaveRate < 0) s.heaveRate = 0;
  for (let i = 0; i < 4; i++) if (s.wheelVy[i]! < 0) s.wheelVy[i] = 0;
  s.contactLifts += 1;
}

/**
 * Raise corner k of the car (body corner and wheel) by `dz`, pivoting about the diagonally
 * opposite corner: a rigid rotation and heave of the body, with each wheel following its corner.
 * Adds each corner's rise to `stepLift`.
 */
function pivotCorner(s: CarState, k: number, dz: number, sprungA: number, sprungB: number): void {
  const wl = s.model.wheelLeft;
  // Corner rises: k by dz, the opposite corner by 0, the two adjacent ones by dz / 2.
  const opp = 3 - k;
  for (let i = 0; i < 4; i++) cornerRise[i] = i === k ? dz : i === opp ? 0 : dz / 2;
  // Body pose change from the front-left, front-right and rear-left corner rises.
  const L = sprungA + sprungB;
  const dRoll =
    ((cornerRise[0]! - cornerRise[1]!) / (wl[0]! - wl[1]!) +
      (cornerRise[2]! - cornerRise[3]!) / (wl[2]! - wl[3]!)) /
    2;
  const front = (cornerRise[0]! + cornerRise[1]!) / 2;
  const rear = (cornerRise[2]! + cornerRise[3]!) / 2;
  const dPitch = (front - rear) / L;
  const dHeave = front - sprungA * dPitch;
  s.y += dHeave;
  s.pitch += dPitch;
  s.roll += dRoll;
  for (let i = 0; i < 4; i++) {
    const xb = i < 2 ? sprungA : -sprungB;
    const lift = dHeave + xb * dPitch + wl[i]! * dRoll;
    s.wheelY[i] = s.wheelY[i]! + lift;
    stepLift[i] = stepLift[i]! + lift;
  }
}

/** One wheel's share of an assist's per-wheel brake demand, clamped to [0, 1]. */
function wheelShare(demand: ArrayLike<number>, i: number): number {
  return clamp(finite(demand[i] ?? 0), 0, 1);
}

/** Engine, clutch, gearbox, differential, ERS and brakes for one substep. */
function stepPowertrain(
  s: CarState,
  throttle: number,
  brake: number,
  overtake: boolean,
  h: number,
  wheelBrake: ArrayLike<number> | undefined,
): void {
  const p = s.model.params;
  const eng = p.engine;
  const ers = p.ers;
  const tyre = p.tyre;
  const R = tyre.rollingRadius;
  const If = tyre.wheelInertiaFront;
  const Ir = tyre.wheelInertiaRear;
  const Je = eng.inertia;

  // Gear and shift. During a shift the clutch is open and the ECU matches engine speed to the
  // target gear, so the ratio change carries no inertia shock into the wheels.
  const carrier = (s.wheelSpeed[2]! + s.wheelSpeed[3]!) / 2;
  let shifting = false;
  if (s.shiftTimer > 0) {
    shifting = true;
    const targetRatio = gearRatio(p, s.shiftTarget);
    const idle = rpm(eng.idleRpm);
    const targetSpeed = Math.max(idle, Math.abs(targetRatio * carrier));
    const remaining = s.shiftTimer;
    s.engineSpeed += (targetSpeed - s.engineSpeed) * Math.min(1, h / remaining);
    s.shiftTimer -= h;
    if (s.shiftTimer <= 1e-12) {
      s.shiftTimer = 0;
      s.gear = s.shiftTarget;
    }
  }
  const G = gearRatio(p, s.gear);

  // Engine torque at the crank.
  const we = s.engineSpeed;
  const N = we / RPM;
  const limiter = clamp((eng.revLimit - N) / eng.limiterWidth, 0, 1);
  const thr = shifting ? 0 : throttle * limiter;
  const wot = engineFullLoadTorque(eng, s.model.iceEfficiency, N);
  const dragT = -(eng.dragTorqueBase + eng.dragTorquePerRpm * N);
  let te = thr * wot + (1 - thr) * dragT;
  const idle = rpm(eng.idleRpm);
  if (we < idle) te += Math.min(IDLE_GAIN * (idle - we), 200);
  if (s.fuelMass <= 0 && te > 0) te = 0;
  const icePower = te > 0 ? te * we : 0;

  // Fuel: idle consumption blended into the demand, never above the regulated flow.
  if (s.fuelMass > 0) {
    const limit = fuelFlow(eng, N);
    const demand = eng.idleFlow + thr * (limit - eng.idleFlow);
    const burn = demand < limit ? demand : limit;
    s.fuelMass = Math.max(0, s.fuelMass - burn * h);
  }

  // ERS. The MGU-H feeds the MGU-K directly first; only energy drawn from the store counts
  // toward the 4 MJ per-lap deployment limit (doc 1.3).
  if (s.mgukLocked !== 0 && s.vx >= ers.startDeploySpeed) s.mgukLocked = 0;
  const engaged = G !== 0 && !shifting && we > rpm(eng.clutchFullRpm);
  // The MGU-H recovers exhaust energy under load; at idle or on the overrun there is none.
  const mguh = thr > 0 ? Math.min(ers.mguhPower, (ers.mguhPower * icePower) / eng.peakPower) : 0;
  // The overtake button overrides the selected mode while held; the limits below still apply.
  const mode =
    ERS_MODES[overtake ? ErsMode.Overtake : s.ersMode | 0] ?? ERS_MODES[ErsMode.Balanced];
  const wantsDeploy =
    s.mgukLocked === 0 &&
    engaged &&
    throttle >= mode.minThrottle &&
    s.vx < mode.maxSpeed &&
    mode.power > 0;
  let deploy = wantsDeploy ? Math.min(mode.power, ers.mgukPower, ers.mgukTorque * we) : 0;
  const direct = Math.min(mguh, deploy);
  let fromStore = deploy - direct;
  const storeLimit = Math.min(ers.deployPerLap - s.ersDeployLap, s.ersStore) / h;
  if (fromStore > storeLimit) fromStore = Math.max(0, storeLimit);
  deploy = direct + fromStore;
  let toStore = mguh - direct;
  let harvest = 0;
  // Brake-by-wire: the pedal sets the torque each axle should get, independent of whether the
  // MGU-K can harvest. On the rear axle the MGU-K delivers what it can and friction supplies the
  // rest, so a full store, a spent harvest allowance or an open clutch changes only the split.
  const frontBrake = (brake * s.model.brakeCapacity * s.brakeBias) / 2;
  const rearRequest = brake * s.model.brakeCapacity * (1 - s.brakeBias);
  if (deploy === 0 && brake > BRAKE_ON && engaged && s.vx > 5 && we > 1) {
    const room = Math.max(0, (ers.storeWindow - s.ersStore) / h - toStore);
    const lapRoom = Math.max(0, (ers.harvestPerLap - s.ersHarvestLap) / h);
    const cap = Math.min(ers.mgukPower, ers.mgukTorque * we, room, lapRoom);
    // Torque at the rear wheels for crank power P is P / we · |G|; never more than requested.
    harvest = Math.min(cap, (rearRequest * we) / Math.abs(G));
  }
  toStore = Math.min(toStore, Math.max(0, (ers.storeWindow - s.ersStore) / h - harvest));
  s.ersStore += (toStore + harvest - fromStore) * h;
  s.ersDeployLap += fromStore * h;
  s.ersHarvestLap += harvest * h;
  s.mgukPower = deploy - harvest;
  s.mguhPower = mguh;
  const tk = we > 1 ? (deploy - harvest) / we : 0;
  const harvestAtWheels = we > 1 ? (harvest / we) * Math.abs(G) : 0;

  // Brakes (friction torque per wheel) plus rolling resistance as a torque on the wheel.
  const rearBrake = Math.max(0, rearRequest - harvestAtWheels) / 2;
  const crr = tyre.rollingResistance * R;
  // Per-wheel friction brake an assist asks for on top of the pedal, as a share of that wheel's
  // own full braking torque (`ControlInput.wheelBrake`). Absent, nothing below changes.
  const frontFull = (s.model.brakeCapacity * s.brakeBias) / 2;
  const rearFull = (s.model.brakeCapacity * (1 - s.brakeBias)) / 2;

  // Front wheels: free spin with Coulomb friction from brake and rolling resistance.
  for (let i = 0; i < 2; i++) {
    const fb = wheelBrake ? frontBrake + wheelShare(wheelBrake, i) * frontFull : frontBrake;
    const bound = ((fb + crr * s.load[i]! * rollDrag[i]!) * h) / If;
    let w = s.wheelSpeed[i]! - (h * s.forceX[i]! * R) / If;
    if (Math.abs(w) <= bound) w = 0;
    else w -= w > 0 ? bound : -bound;
    s.wheelSpeed[i] = w;
  }

  // Rear axle: engine, clutch, differential and both wheels solved together.
  const eff = p.gearbox.efficiency;
  const engineDrive = te + tk;
  const crank = engineDrive > 0 ? engineDrive * eff : engineDrive;
  let wE = we + (h * crank) / Je;
  if (shifting) wE = we;
  let wL = s.wheelSpeed[2]! - (h * s.forceX[2]! * R) / Ir;
  let wR = s.wheelSpeed[3]! - (h * s.forceX[3]! * R) / Ir;
  const clutchCap =
    G === 0 || shifting
      ? 0
      : eng.clutchCapacity *
        clamp((we / RPM - eng.clutchStartRpm) / (eng.clutchFullRpm - eng.clutchStartRpm), 0, 1) *
        h;
  const inputTorque = Math.abs(s.driveTorque * G);
  const ramp = s.driveTorque >= 0 ? p.diff.rampDrive : p.diff.rampCoast;
  const lsdCap = (p.diff.preload + ramp * inputTorque) * h;
  const rbL = wheelBrake ? rearBrake + wheelShare(wheelBrake, 2) * rearFull : rearBrake;
  const rbR = wheelBrake ? rearBrake + wheelShare(wheelBrake, 3) * rearFull : rearBrake;
  const brakeL = (rbL + crr * s.load[2]! * rollDrag[2]!) * h;
  const brakeR = (rbR + crr * s.load[3]! * rollDrag[3]!) * h;
  const clutchMass = clutchCap > 0 ? 1 / (1 / Je + (G * G) / (2 * Ir)) : 0;
  const halfG = G / 2;
  let lc = 0;
  let ld = 0;
  let lbl = 0;
  let lbr = 0;
  for (let it = 0; it < DRIVETRAIN_ITERATIONS; it++) {
    if (clutchCap > 0) {
      const v = wE - halfG * (wL + wR);
      const next = clamp(lc - clutchMass * v, -clutchCap, clutchCap);
      const d = next - lc;
      lc = next;
      wE += d / Je;
      wL -= (d * halfG) / Ir;
      wR -= (d * halfG) / Ir;
    }
    {
      const v = wR - wL;
      const next = clamp(ld - (Ir / 2) * v, -lsdCap, lsdCap);
      const d = next - ld;
      ld = next;
      wL -= d / Ir;
      wR += d / Ir;
    }
    {
      const next = clamp(lbl - Ir * wL, -brakeL, brakeL);
      wL += (next - lbl) / Ir;
      lbl = next;
    }
    {
      const next = clamp(lbr - Ir * wR, -brakeR, brakeR);
      wR += (next - lbr) / Ir;
      lbr = next;
    }
  }
  s.engineSpeed = wE > 0 ? wE : 0;
  s.wheelSpeed[2] = wL;
  s.wheelSpeed[3] = wR;
  // Torque the clutch passes to the gearbox, at the crank (positive when driving).
  s.driveTorque = -lc / h;
}

/** Fuel-flow limit at engine speed `N` rpm, kg/s (doc 1.1, [1] Art. 5.2.4). */
export function fuelFlow(eng: EngineParams, N: number): number {
  if (N >= eng.flowCornerRpm) return eng.flowMax;
  const q = eng.flowSlope * N + eng.flowOffset;
  return q < eng.flowMax ? (q > 0 ? q : 0) : eng.flowMax;
}

/** Full-throttle crank torque at `N` rpm: fuel-flow-limited power, faded above the peak band. */
export function engineFullLoadTorque(eng: EngineParams, efficiency: number, N: number): number {
  let power = efficiency * fuelFlow(eng, N) * eng.fuelEnergy;
  if (N > eng.powerFadeRpm) {
    const x = (N - eng.powerFadeRpm) / 1000;
    power *= Math.max(0, 1 - eng.powerFade * x * x);
  }
  const w = N * RPM;
  if (w < 1) return eng.maxTorque;
  const t = power / w;
  return t < eng.maxTorque ? t : eng.maxTorque;
}

/**
 * Aero coefficients at the given floor ride heights and DRS flap position: front and rear
 * downforce areas and the drag area, m². See `AeroParams` for the shape.
 */
export function aeroCoefficients(
  a: AeroParams,
  rideFront: number,
  rideRear: number,
  drs: number,
  out: { front: number; rear: number; drag: number },
): { front: number; rear: number; drag: number } {
  const mean = rideFront + (1 - a.frontHeightWeight) * (rideRear - rideFront);
  const dh = a.referenceHeight - mean;
  // Only the floor's share follows the floor height and stalls; the wings and bodywork do not.
  // The stall changes neither the drag nor the balance (doc 1.4).
  const leadingEdge = rideFront + a.leadingEdge * (rideRear - rideFront);
  const stall = clamp((a.stallHeight - leadingEdge) / a.stallWidth, 0, 1);
  const stallFactor = 1 - a.stallLoss * stall * stall * (3 - 2 * stall);
  const floorLift = clamp(1 + a.heightSensitivity * dh, 0.3, 2) * stallFactor;
  const lift = 1 - a.floorShare + a.floorShare * floorLift;
  const dragFactor =
    1 - a.floorShare + a.floorShare * clamp(1 + (a.heightSensitivity / 3) * dh, 0.5, 1.5);
  const balance = clamp(
    a.balance + a.rakeBalance * (rideRear - rideFront - a.referenceRake),
    0.2,
    0.8,
  );
  const total = a.clA * lift;
  out.front = total * balance;
  out.rear = total * (1 - balance) + a.clA * a.drsDownforce * drs;
  out.drag = a.cdA * dragFactor * (1 + a.drsDrag * drs);
  return out;
}

const RPM = (2 * Math.PI) / 60;

function rpm(value: number): number {
  return value * RPM;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}
