import type { Material, Mesh } from 'three';
import {
  Box3,
  Color,
  Group,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type Matrix4,
  type Object3D,
  type Texture,
} from 'three';
import type { CarPose } from '@undercut/sim';
import type { CarLod, Quality } from '../quality';
import { ASSET_FLOOR_Y, CarRig, type RigPose } from './car-rig';
import type { CarAssets, CarLivery } from './car-assets';
import { ensureCarShader } from './car-shader';
import {
  Dashboard,
  MEDIUM_COMPOUND,
  compoundMaterial,
  decalMaterial,
  liveryMaterial,
  markingsTexture,
  type CompoundLook,
} from './livery';

export type { CarLivery } from './car-assets';

/** Where the sim's car frame sits on the asset (from the sim's parameters). */
export interface CarGeometry {
  wheelbase: number;
  /** Front axle ahead of the CoG, m. */
  axleFront: number;
  trackFront: number;
  trackRear: number;
  tyreRadius: number;
}

/** Per-frame extras the sim pose does not carry. */
export interface CarExtras {
  /** DRS flap, 0 closed to 1 open. */
  drs: number;
  /** Brake disc heat per corner, 0..1. */
  glow: ArrayLike<number>;
  /** Rain light, 0..1. */
  rain: number;
  /** Driver's head yaw into the corner, rad. */
  headYaw: number;
}

/**
 * The cockpit at night: the screen brighter and matte (anti-glare, so floodlights do not wash it
 * grey), and the faint light it and the wheel's lit buttons put on the face, gloves and grips,
 * as an emission of each material's own albedo (linear, before exposure).
 */
export const COCKPIT_NIGHT = Object.freeze({
  displayEmissive: 2.2,
  displayRoughness: 0.55,
  wheelFill: 0.55,
  /** The gloves' share of it: light suede, already the brightest thing on the wheel. */
  gloveFill: 0.12,
  fillColour: [0.86, 0.9, 1] as const,
});

const NIGHT_UNLIT = new Set(['display', 'wheel_controls']);

/** Steering-wheel turns per road-wheel angle. */
export const STEERING_RATIO = 6;
const FRONT_TYRE_HALF = 0.18;
const REAR_TYRE_HALF = 0.2225;
const ZERO4 = [0, 0, 0, 0];

const tiltQ = new Quaternion();
const tmp = new Vector3();

/**
 * One drawn car built on the asset (docs/car-asset.md): the yaw frame at the sim's (x, z), the
 * sprung body pitched and rolled about the CoG, the asset inside it placed so its floor reference
 * plane is at the sim's ride height, wheels at the sim's wheel heights, every moving node posed.
 * The player's car carries its own decals and steering-wheel display; the ghost wears one
 * translucent material.
 */
export class CarModel {
  /** Yaw-only frame at ground level under the CoG. */
  readonly root = new Group();
  /** Sprung body: heave, pitch and roll about the CoG. */
  readonly body = new Group();
  /** Cockpit eye and T-cam lens in the body frame. */
  readonly cockpitEye = new Vector3();
  readonly tcamMount = new Vector3();
  readonly lod: CarLod;
  private readonly asset: Object3D;
  private readonly rig: CarRig;
  private readonly owned: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly dash: Dashboard | null = null;
  private readonly bodyBox = new Box3();
  private readonly ghostMaterial: MeshStandardMaterial | null = null;
  private readonly rigPose: RigPose;
  private readonly wheelYRoot = new Float64Array(4);
  private readonly spin = new Float64Array(4);

  constructor(
    assets: CarAssets,
    lod: CarLod,
    livery: CarLivery,
    quality: Quality,
    readonly geo: CarGeometry,
    mode: 'player' | 'ghost' | 'none' = 'player',
    compound: CompoundLook = MEDIUM_COMPOUND,
    /** Night under floodlights: the wheel's screen lights its face (COCKPIT_NIGHT). */
    night = false,
  ) {
    const ghost = mode === 'ghost';
    this.lod = lod;
    this.root.name = ghost ? 'ghost-car' : 'car';
    this.root.add(this.body);
    const template = assets.template(lod);
    this.asset = template.root.clone(true);
    // The asset's origin is under the middle of the wheelbase; the sim's is under the CoG.
    const cogX = geo.wheelbase / 2 - geo.axleFront;
    this.asset.position.set(-cogX, -ASSET_FLOOR_Y, 0);
    this.body.add(this.asset);
    this.cockpitEye.set(0.24 - cogX, 0.805 - ASSET_FLOOR_Y, 0);
    this.tcamMount.set(0.02 - cogX, 1.13 - ASSET_FLOOR_Y, 0);

    if (ghost) {
      const g = new MeshStandardMaterial({
        color: '#bcd3ff',
        roughness: 0.35,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      this.owned.push(g);
      this.ghostMaterial = g;
      this.asset.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.material = g;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        if (isDecal(mesh)) mesh.visible = false;
      });
    } else if (mode === 'player') {
      this.dress(assets, livery, quality, compound);
    }
    this.rig = new CarRig(this.asset, this.owned);
    this.rigPose = {
      spin: this.spin,
      steer: 0,
      wheelY: this.wheelYRoot,
      drs: 0,
      wheelTurn: 0,
      headYaw: 0,
      glow: ZERO4,
      rain: 0,
    };
    if (mode === 'player') {
      const display = findMaterial(this.asset, 'display');
      if (display) {
        const own = display.clone();
        this.owned.push(own);
        replaceMaterial(this.asset, display, own);
        const dash = new Dashboard();
        dash.apply(own);
        this.dash = dash;
        if (night) {
          own.emissiveIntensity = COCKPIT_NIGHT.displayEmissive;
          own.roughness = COCKPIT_NIGHT.displayRoughness;
        }
      }
      if (night) this.lightWheelAtNight();
    }
    if (!ghost) {
      this.asset.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && mesh.material instanceof MeshStandardMaterial && !isDecal(mesh))
          ensureCarShader(mesh.material as never);
      });
    }
    // Bodywork extent in the body frame at rest (links and wheels have their own boxes).
    this.body.updateMatrixWorld(true);
    const body = this.asset.getObjectByName('body');
    if (body) this.bodyBox.setFromObject(body, true);
    this.bodyBox.applyMatrix4(this.body.matrixWorld.clone().invert());
  }

  private dress(
    assets: CarAssets,
    livery: CarLivery,
    quality: Quality,
    compound: CompoundLook,
  ): void {
    const paint = findMaterial(this.asset, 'paint');
    const mask = assets.masks.get(livery.team);
    if (paint && mask) {
      const m = liveryMaterial(paint, mask, livery);
      this.owned.push(m);
      replaceMaterial(this.asset, paint, m);
      // The gloves on the steering wheel share the paint mesh material: fabric, not clear coat.
      const wheel = this.asset.getObjectByName('steering_wheel');
      if (wheel) {
        const gloves = liveryMaterial(paint, mask, livery) as MeshStandardMaterial & {
          clearcoat?: number;
        };
        gloves.roughness = 0.85;
        if (gloves.clearcoat !== undefined) gloves.clearcoat = 0;
        this.owned.push(gloves);
        wheel.traverse((o) => {
          const mesh = o as Mesh;
          if (mesh.isMesh && mesh.material === m) mesh.material = gloves;
        });
      }
    }
    const tyre = findMaterial(this.asset, 'tyre');
    if (tyre) {
      const m = compoundMaterial(tyre, compound);
      this.owned.push(m);
      replaceMaterial(this.asset, tyre, m);
    }
    // One canvas for the decal mesh: number left (u 0–0.4), code right (docs/car-asset.md).
    const decals = this.asset.getObjectByName('decals');
    if (!decals) return;
    const info = decals.userData.decal as
      { canvas?: [number, number]; number_u?: [number, number] } | undefined;
    const tex = markingsTexture(
      livery,
      info?.canvas ?? [2048, 512],
      info?.number_u?.[1] ?? 0.4,
      quality.anisotropy,
    );
    this.textures.push(tex);
    const mat = decalMaterial(tex, quality.clearcoat);
    this.owned.push(mat);
    decals.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.material = mat;
      mesh.castShadow = false;
    });
  }

  /** Place the car at an interpolated pose. */
  apply(pose: CarPose, extras: CarExtras): void {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.set(0, pose.yaw, 0);
    this.body.position.set(0, pose.y, 0);
    this.body.rotation.set(pose.roll, 0, pose.pitch, 'ZXY');
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < 4; i++) {
      this.wheelYRoot[i] = pose.wheelY[i] as number;
      this.spin[i] = -(pose.wheelAngle[i] as number);
    }
    const p = this.rigPose;
    p.steer = pose.steerAngle;
    p.wheelTurn = pose.steerAngle * STEERING_RATIO;
    p.drs = extras.drs;
    p.glow = extras.glow;
    p.rain = extras.rain;
    p.headYaw = extras.headYaw;
    tiltQ.copy(this.body.quaternion);
    this.rig.setPose(p, this.rootFrame, tiltQ);
  }

  /** Asset-frame ↔ yaw-frame conversion for the rig (world Y in the yaw frame is world Y). */
  private readonly rootFrame = {
    localToWorld: (v: Vector3): Vector3 => this.root.worldToLocal(this.asset.localToWorld(v)),
    worldToLocal: (v: Vector3): Vector3 => this.asset.worldToLocal(this.root.localToWorld(v)),
  };

  /** Ghost only: fade out as it nears the camera so it never fills the screen. */
  setGhostFade(distanceToCamera: number): void {
    if (!this.ghostMaterial) return;
    const f = Math.min(1, Math.max(0, (distanceToCamera - 4) / 8));
    this.ghostMaterial.opacity = 0.32 * f;
    this.root.visible = f > 0.01;
  }

  /**
   * World-space points that bound the car as drawn: the bodywork box corners in the body frame
   * and each wheel's box corners. Call after `apply`; fills and returns `out` (40 points).
   */
  boundingPoints(out: Vector3[]): Vector3[] {
    this.root.updateMatrixWorld(true);
    let k = 0;
    const put = (x: number, y: number, z: number, m: Matrix4): void => {
      const v = out[k] ?? (out[k] = new Vector3());
      v.set(x, y, z).applyMatrix4(m);
      k++;
    };
    const b = this.bodyBox;
    for (let i = 0; i < 8; i++) {
      put(
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z,
        this.body.matrixWorld,
      );
    }
    const R = this.geo.tyreRadius;
    this.rig.wheels.forEach((w, i) => {
      if (!w) return;
      const hw = i < 2 ? FRONT_TYRE_HALF : REAR_TYRE_HALF;
      const s = this.rig.suspension[i];
      const m = (s ?? w).matrixWorld;
      for (let j = 0; j < 8; j++) put(j & 1 ? R : -R, j & 2 ? R : -R, j & 4 ? hw : -hw, m);
    });
    out.length = k;
    return out;
  }

  /** Wheel-centre world position of a corner (tests, contact shadows). */
  wheelWorld(i: number, out = tmp): Vector3 {
    const s = this.rig.suspension[i];
    return s ? s.getWorldPosition(out) : out.set(0, 0, 0);
  }

  /** `speed` is already in `unit` (the label drawn under it). */
  setDashboard(gear: number, speed: number, revLights: number, unit = 'KM/H'): void {
    this.dash?.draw(gear, speed, revLights, unit);
  }

  get dashboard(): { gear: string; speed: string; revs: number; unit: string } | null {
    return this.dash?.shown ?? null;
  }

  /**
   * At night the wheel's screen and its lit buttons are the brightest things a hand's width from
   * the face, gloves and grips: every material on the wheel (its own copy where the car shares
   * it) takes a faint emission of its own albedo, so the face reads in the dark instead of
   * dropping to black between floodlights. The screen is left as it is.
   */
  private lightWheelAtNight(): void {
    const wheel = this.asset.getObjectByName('steering_wheel');
    if (!wheel) return;
    const copies = new Map<Material, Material>();
    const fill = new Color(...COCKPIT_NIGHT.fillColour).multiplyScalar(COCKPIT_NIGHT.wheelFill);
    wheel.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const from = mesh.material as Material;
      // The screen is lit already; the buttons and switches keep their own colours unlit (their
      // blue and red caps glowing read as toy LEDs).
      if (!(from instanceof MeshStandardMaterial) || NIGHT_UNLIT.has(from.name)) return;
      let to = copies.get(from);
      if (!to) {
        // The car's own materials here are the gloves' livery material, whose map is the
        // team's mask (region codes, not colour): they glow by their colour alone.
        const livery = this.owned.includes(from);
        const own = livery ? from : from.clone();
        if (own !== from) this.owned.push(own);
        const m = own as MeshStandardMaterial;
        if (livery) {
          m.emissive.copy(m.color).multiply(fill).multiplyScalar(COCKPIT_NIGHT.gloveFill);
        } else if (m.map) {
          m.emissiveMap = m.map;
          m.emissive.copy(fill);
        } else {
          m.emissive.copy(m.color).multiply(fill);
        }
        m.emissiveIntensity = 1;
        copies.set(from, own);
        to = own;
      }
      mesh.material = to;
    });
  }

  /**
   * Put `material` on the wing mirrors' glass (the cockpit mirrors' reflection). Returns how
   * many meshes took it.
   */
  useMirrorMaterial(material: Material): number {
    let n = 0;
    this.asset.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && (mesh.material as Material).name === 'mirror_glass') {
        mesh.material = material;
        n++;
      }
    });
    return n;
  }

  /** Show or hide the driver's helmet (hidden for the cockpit camera). */
  setHelmetVisible(visible: boolean): void {
    if (this.rig.helmet) this.rig.helmet.visible = visible;
  }

  dispose(): void {
    this.dash?.dispose();
    for (const m of this.owned) m.dispose();
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent();
  }
}

/** A mesh of the asset's `decals` node (the race number and driver code carriers). */
export function isDecal(o: Object3D): boolean {
  return o.name === 'decals' || o.parent?.name === 'decals';
}

export function findMaterial(root: Object3D, name: string): MeshStandardMaterial | null {
  let found: MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (found || !mesh.isMesh) return;
    const m = mesh.material as MeshStandardMaterial;
    if (m.name === name) found = m;
  });
  return found;
}

export function replaceMaterial(root: Object3D, from: Material, to: Material): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && mesh.material === from) mesh.material = to;
  });
}
