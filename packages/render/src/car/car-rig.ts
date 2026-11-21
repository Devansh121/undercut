import type { Material, Mesh, Object3D } from 'three';
import { MathUtils, MeshStandardMaterial, Quaternion, Vector3 } from 'three';

/**
 * The animated nodes of one car asset (docs/car-asset.md), driven from a pose. Ported from the
 * contract's reference rig (tools/car/preview/car-rig.js on the car branch). Works on any level of
 * detail: nodes a level does not have are skipped.
 */
export const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const;
/** Asset wheel radius and the floor reference plane height at rest, m. */
export const ASSET_TYRE_RADIUS = 0.36;
export const ASSET_FLOOR_Y = 0.04;

export interface RigPose {
  /** Wheel rotation per corner, rad; rolling forward is negative about +Z (contract). */
  spin: ArrayLike<number>;
  /** Road-wheel steer angle, rad, positive left. */
  steer: number;
  /** Wheel-centre height per corner in the car root's frame (yaw-only, ground at the car), m. */
  wheelY: ArrayLike<number>;
  /** DRS flap, 0 closed to 1 open. */
  drs: number;
  /** Steering-wheel rotation, rad, positive left. */
  wheelTurn: number;
  headYaw: number;
  /** Brake disc heat per corner, 0..1. */
  glow: ArrayLike<number>;
  /** Rain light, 0..1. */
  rain: number;
}

interface Link {
  o: Object3D;
  follower: Object3D;
  /** Outboard joint in the follower's frame. */
  attach: Vector3;
  /** Rest direction pivot → outboard, in the link's parent frame. */
  rest: Vector3;
}

const v = new Vector3();
const q = new Quaternion();
const q2 = new Quaternion();

export class CarRig {
  readonly wheels: (Object3D | undefined)[];
  readonly steerNodes: (Object3D | undefined)[];
  readonly suspension: (Object3D | undefined)[];
  readonly rest: Vector3[];
  readonly drs: Object3D | undefined;
  readonly steeringWheel: Object3D | undefined;
  readonly helmet: Object3D | undefined;
  readonly discMaterials: (MeshStandardMaterial | null)[] = [];
  readonly rainMaterial: MeshStandardMaterial | null = null;
  private readonly links: Link[] = [];
  private readonly wheelAxis = new Vector3(-1, 0, 0);
  private readonly openRad: number;

  /** `root` is the asset's `car` node. Disc and rain-light materials are cloned per car. */
  constructor(
    readonly root: Object3D,
    private readonly owned: Material[],
  ) {
    const node = (n: string): Object3D | undefined => root.getObjectByName(n) ?? undefined;
    this.wheels = CORNERS.map((c) => node(`wheel_${c}`));
    this.steerNodes = CORNERS.map((c) => node(`steer_${c}`));
    this.suspension = CORNERS.map((c) => node(`suspension_${c}`));
    this.rest = this.suspension.map((s) => (s ? s.position.clone() : new Vector3()));
    this.drs = node('drs_flap');
    this.openRad = MathUtils.degToRad((this.drs?.userData.open_deg as number | undefined) ?? 22);
    this.steeringWheel = node('steering_wheel');
    const axis = this.steeringWheel?.userData.axis as number[] | undefined;
    if (axis) this.wheelAxis.fromArray(axis).normalize();
    this.helmet = node('helmet');

    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const ud = o.userData as { outboard?: number[]; follows?: string };
      if (!ud.outboard || !ud.follows) return;
      const follower = node(ud.follows);
      if (!follower) return;
      const out = new Vector3().fromArray(ud.outboard);
      const attach = follower.worldToLocal(root.localToWorld(out.clone()));
      this.links.push({ o, follower, attach, rest: out.sub(o.position).normalize() });
    });

    for (const c of CORNERS) {
      const disc = node(`brake_disc_${c}`);
      let mat: MeshStandardMaterial | null = null;
      disc?.traverse((m) => {
        const mesh = m as Mesh;
        if (!mesh.isMesh || !(mesh.material instanceof MeshStandardMaterial)) return;
        mat ??= this.own(mesh.material.clone());
        mat.emissiveIntensity = 0;
        mesh.material = mat;
      });
      this.discMaterials.push(mat);
    }
    const rain = node('rain_light');
    let rainMat: MeshStandardMaterial | null = null;
    rain?.traverse((m) => {
      const mesh = m as Mesh;
      if (!mesh.isMesh || !(mesh.material instanceof MeshStandardMaterial)) return;
      rainMat ??= this.own(mesh.material.clone());
      rainMat.emissive.set('#ff2010');
      rainMat.emissiveIntensity = 0;
      mesh.material = rainMat;
    });
    this.rainMaterial = rainMat;
  }

  private own<T extends Material>(m: T): T {
    this.owned.push(m);
    return m;
  }

  /**
   * Pose the nodes. `bodyToRoot` is the sprung body's rotation relative to the car's yaw frame
   * (pitch and roll); suspension nodes are counter-rotated so wheels stay upright, and placed so
   * each wheel centre is at `wheelY` in the root frame.
   */
  setPose(
    p: RigPose,
    assetToRoot: { localToWorld(v: Vector3): Vector3; worldToLocal(v: Vector3): Vector3 },
    bodyTilt: Quaternion,
  ): void {
    for (let i = 0; i < 4; i++) {
      const s = this.suspension[i];
      if (s) {
        // Rest position in the asset frame → root frame, take the sim's wheel height, back.
        v.copy(this.rest[i] as Vector3);
        assetToRoot.localToWorld(v);
        v.y = p.wheelY[i] as number;
        assetToRoot.worldToLocal(v);
        s.position.copy(v);
        s.quaternion.copy(q.copy(bodyTilt).invert());
      }
      const w = this.wheels[i];
      if (w) w.rotation.z = p.spin[i] as number;
      const st = this.steerNodes[i];
      if (st) st.rotation.y = p.steer;
      const disc = this.discMaterials[i];
      if (disc) {
        const heat = p.glow[i] as number;
        disc.emissiveIntensity = 4 * heat * heat;
      }
    }
    if (this.drs) this.drs.rotation.z = this.openRad * Math.min(1, Math.max(0, p.drs));
    if (this.steeringWheel)
      this.steeringWheel.quaternion.setFromAxisAngle(this.wheelAxis, p.wheelTurn);
    if (this.helmet) this.helmet.rotation.y = p.headYaw;
    if (this.rainMaterial) this.rainMaterial.emissiveIntensity = 6 * p.rain;
    this.root.updateMatrixWorld(true);
    for (const L of this.links) {
      v.copy(L.attach);
      L.follower.localToWorld(v);
      this.root.worldToLocal(v);
      v.sub(L.o.position).normalize();
      q2.setFromUnitVectors(L.rest, v);
      L.o.quaternion.copy(q2);
    }
    for (const L of this.links) L.o.updateMatrixWorld(true);
  }
}
