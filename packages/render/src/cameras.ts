import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { CarPose } from '@undercut/sim';
import type { CarModel } from './car/car-model';

export type CameraName = 'chase-far' | 'chase-near' | 'tcam' | 'cockpit' | 'look-back' | 'tv';

/** Cycle order for the camera button. Look-back is also held on its own button. */
export const CAMERA_ORDER: readonly CameraName[] = ['chase-near', 'chase-far', 'tcam', 'cockpit'];

export const CAMERA_LABELS: Readonly<Record<CameraName, string>> = Object.freeze({
  'chase-far': 'Far chase',
  'chase-near': 'Near chase',
  tcam: 'T-cam',
  cockpit: 'Cockpit',
  'look-back': 'Look back',
  tv: 'Trackside',
});

/** What a camera reads each frame. */
export interface CameraFrame {
  pose: CarPose;
  /** Forward speed, m/s. */
  speed: number;
  /** Accelerometer, g: forward, left. */
  longG: number;
  latG: number;
  /** Real seconds since the last frame (0 while paused). */
  dt: number;
  /** A running clock for shake, s. */
  time: number;
  car: CarModel;
}

/** One camera's behaviour. The rig swaps these live. */
export interface CameraMode {
  readonly name: CameraName;
  /** Driver's helmet visible in this view. */
  readonly helmet: boolean;
  /** Jump to the steady state for the current frame (after a reset or a switch). */
  snap(frame: CameraFrame): void;
  update(frame: CameraFrame, camera: PerspectiveCamera): void;
}

const V_TOP = 95;
const tmp = new Vector3();
const tmp2 = new Vector3();

/** Critically damped approach of `current` toward `target` with time constant `tau`. */
function approach(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0 || dt <= 0) return dt <= 0 ? current : target;
  return target + (current - target) * Math.exp(-dt / tau);
}

function angleApproach(current: number, target: number, tau: number, dt: number): number {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return current + d - d * Math.exp(-dt / Math.max(1e-4, tau));
}

/** Field of view widening with speed: +4° at top speed (visual direction). */
function speedFov(base: number, speed: number): number {
  const f = Math.min(1, Math.max(0, speed / V_TOP));
  return base + 4 * f * f;
}

/** Small, smooth, speed-dependent shake from incommensurate sines (no randomness). */
function shake(time: number, speed: number, amount: number): [number, number] {
  const f = Math.min(1, Math.max(0, speed / V_TOP));
  const a = amount * f * f;
  return [
    a * (Math.sin(time * 31.7) * 0.6 + Math.sin(time * 53.3 + 1.3) * 0.4),
    a * (Math.sin(time * 27.1 + 0.7) * 0.6 + Math.sin(time * 61.9 + 2.1) * 0.4),
  ];
}

/**
 * Chase camera: low and slightly late. The heading follows the car's yaw through a damper
 * (~0.12 s), height through a slower one, the position springs toward its target, and it looks
 * ahead into the corner along the yaw rate. Never rigidly glued to the car.
 */
export class ChaseCamera implements CameraMode {
  readonly helmet = true;
  private yaw = 0;
  private y = 0;
  private readonly pos = new Vector3();
  private readonly look = new Vector3();
  private lastYaw = 0;
  private yawRate = 0;

  constructor(
    readonly name: CameraName,
    private readonly distance: number,
    private readonly height: number,
    private readonly fov: number,
    private readonly yawTau = 0.12,
  ) {}

  snap(f: CameraFrame): void {
    this.yaw = f.pose.yaw;
    this.lastYaw = f.pose.yaw;
    this.yawRate = 0;
    this.y = f.pose.y;
    this.target(f, this.pos);
    this.look.set(f.pose.x, f.pose.y + 0.8, f.pose.z);
  }

  private target(f: CameraFrame, out: Vector3): Vector3 {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const d = this.distance + Math.min(1, f.speed / V_TOP) * 0.6;
    return out.set(f.pose.x - c * d, this.y + this.height, f.pose.z + s * d);
  }

  update(f: CameraFrame, camera: PerspectiveCamera): void {
    const dt = f.dt;
    if (dt > 0) {
      let dy = f.pose.yaw - this.lastYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yawRate = approach(this.yawRate, dy / dt, 0.15, dt);
      this.lastYaw = f.pose.yaw;
    }
    this.yaw = angleApproach(this.yaw, f.pose.yaw, this.yawTau, dt);
    this.y = approach(this.y, f.pose.y, 0.2, dt);
    this.target(f, tmp);
    const k = 1 - Math.exp(-dt / 0.05);
    this.pos.lerp(tmp, dt > 0 ? k : 0);
    // Look ahead of the car, swung into the corner by the yaw rate.
    const ahead = 6 + Math.min(1, f.speed / V_TOP) * 6;
    const swing = MathUtils.clamp(this.yawRate * 0.35, -0.5, 0.5);
    const yaw = f.pose.yaw + swing;
    tmp2.set(f.pose.x + Math.cos(yaw) * ahead, this.y + 0.75, f.pose.z - Math.sin(yaw) * ahead);
    this.look.lerp(tmp2, dt > 0 ? 1 - Math.exp(-dt / 0.06) : 0);
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
    const [sx, sy] = shake(f.time, f.speed, 0.0016);
    camera.rotateX(sx);
    camera.rotateY(sy);
    camera.fov = speedFov(this.fov, f.speed);
  }
}

/** A camera fixed to the body (T-cam, cockpit) with a small, damped head movement. */
export class BodyCamera implements CameraMode {
  private headX = 0;
  private headZ = 0;

  constructor(
    readonly name: CameraName,
    readonly helmet: boolean,
    private readonly mount: (car: CarModel) => Vector3,
    private readonly fov: number,
    private readonly headTravel: number,
    private readonly lookPitch = 0,
    private readonly backwards = false,
  ) {}

  snap(): void {
    this.headX = 0;
    this.headZ = 0;
  }

  update(f: CameraFrame, camera: PerspectiveCamera): void {
    const car = f.car;
    car.root.updateMatrixWorld(true);
    // Head moves against the g-load, at most `headTravel` metres (2 cm in the cockpit).
    const max = this.headTravel;
    this.headX = approach(this.headX, MathUtils.clamp(-f.longG * 0.005, -max, max), 0.12, f.dt);
    this.headZ = approach(this.headZ, MathUtils.clamp(f.latG * 0.005, -max, max), 0.12, f.dt);
    tmp.copy(this.mount(car));
    tmp.x += this.headX;
    tmp.z += this.headZ;
    const eye = car.body.localToWorld(tmp.clone());
    const dir = this.backwards ? -1 : 1;
    tmp2.copy(this.mount(car));
    tmp2.x += 10 * dir;
    tmp2.y += Math.tan(this.lookPitch) * 10;
    const target = car.body.localToWorld(tmp2);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0).applyQuaternion(car.body.getWorldQuaternion(camera.quaternion));
    camera.lookAt(target);
    const [sx, sy] = shake(f.time, f.speed, this.name === 'cockpit' ? 0.0012 : 0.0008);
    camera.rotateX(sx);
    camera.rotateY(sy);
    camera.up.set(0, 1, 0);
    camera.fov = speedFov(this.fov, f.speed);
  }
}

/** Look-back: from ahead of the car, looking back over the nose at what follows. */
export class LookBackCamera implements CameraMode {
  readonly name = 'look-back' as const;
  readonly helmet = true;
  snap(): void {}
  update(f: CameraFrame, camera: PerspectiveCamera): void {
    const c = Math.cos(f.pose.yaw);
    const s = Math.sin(f.pose.yaw);
    camera.position.set(f.pose.x + c * 3.4, f.pose.y + 1.25, f.pose.z - s * 3.4);
    camera.lookAt(f.pose.x - c * 12, f.pose.y + 0.6, f.pose.z + s * 12);
    camera.fov = 62;
  }
}

/**
 * Trackside TV camera: fixed in the world, a long lens following the car with a little operator
 * lag. Position and focal length are set from outside (replay director, screenshot stations).
 */
export class TvCamera implements CameraMode {
  readonly name = 'tv' as const;
  readonly helmet = true;
  readonly position = new Vector3(0, 2, 0);
  /** Vertical field of view, degrees (about 9° is a 150 mm lens on full frame). */
  fov = 12;
  /** A fixed point to frame instead of the player's car (a grid shot), or null. */
  target: Vector3 | null = null;
  private readonly aim = new Vector3();
  snap(f: CameraFrame): void {
    if (this.target) this.aim.copy(this.target);
    else this.aim.set(f.pose.x, f.pose.y + 0.45, f.pose.z);
  }
  update(f: CameraFrame, camera: PerspectiveCamera): void {
    if (this.target) tmp.copy(this.target);
    else tmp.set(f.pose.x, f.pose.y + 0.45, f.pose.z);
    this.aim.lerp(tmp, f.dt > 0 ? 1 - Math.exp(-f.dt / 0.12) : 0);
    camera.position.copy(this.position);
    camera.lookAt(this.aim);
    camera.fov = this.fov;
  }
}

/** Switches cameras live and runs the active one; a held look-back overrides any of them. */
export class CameraRig {
  readonly tv = new TvCamera();
  private readonly modes: Map<CameraName, CameraMode>;
  private currentName: CameraName = 'chase-near';
  private wasLookBack = false;
  private needsSnap = true;

  constructor() {
    const list: CameraMode[] = [
      new ChaseCamera('chase-near', 4.9, 1.45, 60),
      new ChaseCamera('chase-far', 7.6, 2.15, 56, 0.14),
      new BodyCamera('tcam', true, (car) => car.tcamMount, 66, 0.004, -0.085),
      new BodyCamera('cockpit', false, (car) => car.cockpitEye, 74, 0.02, -0.07),
      new LookBackCamera(),
      this.tv,
    ];
    this.modes = new Map(list.map((m) => [m.name, m]));
  }

  get current(): CameraName {
    return this.currentName;
  }

  set(name: CameraName): void {
    if (!this.modes.has(name)) return;
    this.currentName = name;
    this.needsSnap = true;
  }

  next(): CameraName {
    const i = CAMERA_ORDER.indexOf(this.currentName);
    this.set(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length] as CameraName);
    return this.currentName;
  }

  /** Snap the active camera next frame (after a reset or teleport). */
  snap(): void {
    this.needsSnap = true;
  }

  update(frame: CameraFrame, camera: PerspectiveCamera, lookBack: boolean): CameraMode {
    const mode = (
      lookBack ? this.modes.get('look-back') : this.modes.get(this.currentName)
    ) as CameraMode;
    if (this.needsSnap || lookBack !== this.wasLookBack) {
      mode.snap(frame);
      this.needsSnap = false;
    }
    this.wasLookBack = lookBack;
    mode.update(frame, camera);
    camera.updateProjectionMatrix();
    return mode;
  }
}
