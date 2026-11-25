import {
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';

import type { CarGeometry } from './car-model';

const m = new Matrix4();
const q = new Quaternion();
const p = new Vector3();
const s = new Vector3();
const up = new Vector3(0, 1, 0);

/** The footprint's shape: how far it reaches past the wheels and how soft its edges are, m. */
export const CONTACT_FOOTPRINT = Object.freeze({
  /** Clear margin round the outermost shadow, m. */
  margin: 0.25,
  /** Under the floor between the axles: half width, and the penumbra of its edge, m. */
  floorHalfWidth: 0.62,
  floorEdge: 0.22,
  /** The floor's reach behind the front axle and ahead of the rear one, m. */
  floorFrontInset: 0.45,
  floorRearInset: 0.1,
  /** Each tyre's own patch: length along the car and penumbra, m. */
  tyreLength: 0.55,
  tyreEdge: 0.07,
  /** The nose and front wing ahead of the front axle: half width, reach and strength. */
  noseHalfWidth: 0.24,
  noseReach: 0.95,
  nose: 0.45,
  /** A faint occlusion round the whole car (strength and its fall-off), so it never floats. */
  halo: 0.22,
  haloEdge: 0.35,
});

const TYRE_HALF_WIDTH = { front: 0.18, rear: 0.2225 };

/** A footprint mask in the car's frame: alpha rows from the front (row 0) to the rear. */
export interface Footprint {
  data: Uint8Array;
  cols: number;
  rows: number;
  /** Size on the ground, m: across and along the car. */
  width: number;
  length: number;
  /** The mask's centre ahead of the CoG, m. */
  ahead: number;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Signed distance outside an axis-aligned rectangle centred at (cx, cz), m (negative inside). */
function boxDistance(x: number, z: number, cx: number, cz: number, hx: number, hz: number): number {
  const dx = Math.abs(x - cx) - hx;
  const dz = Math.abs(z - cz) - hz;
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
}

/**
 * The shadow a car casts under lights from every side (floodlights) or a soft sky: darkest under
 * the floor between the axles and under each tyre, the nose and front wing lighter, and a faint
 * occlusion round the whole car, all with short penumbrae, so it hugs the car instead of
 * spreading past it as one blob. Laid out from the car's own wheelbase and tracks.
 */
export function contactFootprint(
  geo: Pick<CarGeometry, 'wheelbase' | 'axleFront' | 'trackFront' | 'trackRear' | 'tyreRadius'>,
  texelsPerMetre = 24,
): Footprint {
  const f = CONTACT_FOOTPRINT;
  const front = geo.axleFront;
  const rear = geo.axleFront - geo.wheelbase;
  const fore = front + Math.max(geo.tyreRadius, f.noseReach) + f.margin;
  const aft = -rear + geo.tyreRadius + f.margin;
  const half =
    Math.max(geo.trackFront / 2 + TYRE_HALF_WIDTH.front, geo.trackRear / 2 + TYRE_HALF_WIDTH.rear) +
    f.margin;
  const width = 2 * half;
  const length = fore + aft;
  const cols = Math.max(8, Math.round(width * texelsPerMetre));
  const rows = Math.max(8, Math.round(length * texelsPerMetre));
  const data = new Uint8Array(cols * rows);
  const floorFront = front - f.floorFrontInset;
  const floorRear = rear + f.floorRearInset;
  const tyres = [
    { x: front, z: geo.trackFront / 2, hz: TYRE_HALF_WIDTH.front },
    { x: rear, z: geo.trackRear / 2, hz: TYRE_HALF_WIDTH.rear },
  ];
  for (let j = 0; j < rows; j++) {
    // Row 0 is the front edge.
    const x = fore - ((j + 0.5) / rows) * length;
    for (let i = 0; i < cols; i++) {
      const z = -half + ((i + 0.5) / cols) * width;
      const floor = boxDistance(
        x,
        z,
        (floorFront + floorRear) / 2,
        0,
        (floorFront - floorRear) / 2,
        f.floorHalfWidth,
      );
      let a = 1 - smooth(-f.floorEdge / 2, f.floorEdge / 2, floor);
      for (const t of tyres) {
        const d = boxDistance(x, Math.abs(z), t.x, t.z, f.tyreLength / 2, t.hz);
        a = Math.max(a, 1 - smooth(-f.tyreEdge / 2, f.tyreEdge / 2, d));
      }
      const nose = boxDistance(x, z, front + f.noseReach / 2, 0, f.noseReach / 2, f.noseHalfWidth);
      a = Math.max(a, f.nose * (1 - smooth(-f.floorEdge / 2, f.floorEdge / 2, nose)));
      // The halo: distance outside the car's outline (axles to tyres' outer faces).
      const outline = boxDistance(x, z, (front + rear) / 2, 0, (front - rear) / 2, half - f.margin);
      a = Math.max(a, f.halo * (1 - smooth(0, f.haloEdge, outline)));
      data[j * cols + i] = Math.round(Math.min(1, a) * 255);
    }
  }
  return { data, cols, rows, width, length, ahead: (fore - aft) / 2 };
}

/**
 * The contact shadow under each car (`contactFootprint`): where the shadow map is off (Lite),
 * only covers the player's car (Mobile), or there is no shadow-casting key light (night under
 * floodlights). One instanced draw for every car.
 */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly texture: DataTexture;
  private readonly footprint: Footprint;
  private count = 0;

  constructor(capacity: number, opacity: number, geo: CarGeometry) {
    this.footprint = contactFootprint(geo);
    const fp = this.footprint;
    // three.js reads an alpha map's green channel: the mask goes in every channel.
    const rgba = new Uint8Array(fp.data.length * 4);
    for (let k = 0; k < fp.data.length; k++) rgba.fill(fp.data[k] as number, k * 4, k * 4 + 4);
    this.texture = new DataTexture(rgba, fp.cols, fp.rows, RGBAFormat, UnsignedByteType);
    this.texture.minFilter = LinearMipmapLinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
    const material = new MeshBasicMaterial({
      color: 0x000000,
      alphaMap: this.texture,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'contact-shadows';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** A car at ground height `y`, CoG at (x, z), heading `yaw`. */
  add(x: number, y: number, z: number, yaw: number): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    const fp = this.footprint;
    // The plane's +Z (texture row 0, the front) along the car's heading.
    q.setFromAxisAngle(up, yaw + Math.PI / 2);
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    m.compose(
      p.set(x + fx * fp.ahead, y + 0.01, z + fz * fp.ahead),
      q,
      s.set(fp.width, 1, fp.length),
    );
    this.mesh.setMatrixAt(this.count++, m);
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.texture.dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * How dark the contact shadow under each car is (0: none). Presets that ask for it (Mobile, Lite)
 * always have one; any preset gets a full one when the scene has no shadow-casting key light
 * (night under floodlights, a sun turned off), so cars never float.
 */
export function contactShadowOpacity(
  quality: { contactShadow: boolean },
  hasShadowKey: boolean,
): number {
  if (!hasShadowKey) return 0.65;
  return quality.contactShadow ? 0.35 : 0;
}
