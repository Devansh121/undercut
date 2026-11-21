import {
  BufferAttribute,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector2,
  Vector3,
  TubeGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import type { CarPose } from '@undercut/sim';
import type { Quality } from '../quality';
import { carbonTexture } from '../textures';
import { loft, plate, wingElement, type Section } from './loft';

/**
 * INTERIM CAR, to be replaced in M2 by the real model (docs/adr/0005-car-model.md).
 *
 * A single-seater of the 2022–2025 ground-effect era built in code from lofted, smoothed
 * sections: monocoque and nose, sidepods, engine cover with fin, floor and diffuser, multi-
 * element front wing, rear wing with a DRS flap that opens, endplates, halo, wheel covers and
 * tyres with compound marks, and suspension arms that follow the wheels. The car frame is the
 * body frame: +X forward, +Y up, +Z right; the origin is the floor reference under the CoG.
 */

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
}

export interface CarGeometry {
  wheelbase: number;
  /** Front axle ahead of the CoG, m. */
  axleFront: number;
  trackFront: number;
  trackRear: number;
  tyreRadius: number;
}

interface Corner {
  /** Moves with the wheel centre. */
  corner: Group;
  /** Steers (front only). */
  steer: Group;
  /** Spins about the axle. */
  spin: Group;
  front: boolean;
  left: boolean;
}

interface Arm {
  mesh: Mesh;
  /** Inboard point in the body frame. */
  inboard: Vector3;
  /** Outboard point relative to the wheel centre (car frame axes). */
  outboard: Vector3;
  wheel: number;
}

const FRONT_TYRE_WIDTH = 0.305;
const REAR_TYRE_WIDTH = 0.405;
const RIM_RADIUS = 0.229;
/** Steering-wheel turns per road-wheel angle. */
const STEERING_RATIO = 6;
/** DRS flap angle closed and open, rad (trailing edge up). */
const FLAP_CLOSED = 0.62;
const FLAP_OPEN = 0.08;

const up = new Vector3(0, 1, 0);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();

export class CarModel {
  /** Yaw-only frame at ground level under the CoG. */
  readonly root = new Group();
  /** Sprung body: heave, pitch and roll. */
  readonly body = new Group();
  readonly driverHead = new Group();
  readonly cockpitEye = new Vector3();
  readonly tcamMount = new Vector3();
  private readonly corners: Corner[] = [];
  private readonly arms: Arm[] = [];
  private readonly flap = new Group();
  private readonly steeringWheel = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly textures: Texture[] = [];
  private readonly geo: CarGeometry;

  constructor(geo: CarGeometry, livery: Livery, quality: Quality, ghost = false) {
    this.geo = geo;
    this.root.name = ghost ? 'ghost-car' : 'car';
    this.root.add(this.body);
    const m = this.buildMaterials(livery, quality, ghost);
    this.buildBody(geo, livery, m);
    this.buildWings(geo, m);
    this.buildHalo(m);
    this.buildCockpit(m);
    this.buildWheels(geo, m);
    this.buildSuspension(geo, m);
    this.root.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = !ghost;
        o.receiveShadow = !ghost;
      }
    });
  }

  private g<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private buildMaterials(livery: Livery, q: Quality, ghost: boolean) {
    if (ghost) {
      const ghostMat = new MeshStandardMaterial({
        color: '#bcd3ff',
        roughness: 0.35,
        metalness: 0,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      this.materials.push(ghostMat);
      return {
        paint: ghostMat,
        carbon: ghostMat,
        tyre: ghostMat,
        rim: ghostMat,
        dark: ghostMat,
        metal: ghostMat,
        helmet: ghostMat,
        visor: ghostMat,
      };
    }
    const carbonMap = carbonTexture(q.anisotropy);
    carbonMap.repeat.set(1 / 0.05, 1 / 0.05);
    this.textures.push(carbonMap);
    const paint = new MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: q.clearcoat ? 1 : 0,
      clearcoatRoughness: 0.06,
    });
    const carbon = new MeshPhysicalMaterial({
      color: '#ffffff',
      map: carbonMap,
      roughness: 0.42,
      metalness: 0.1,
      clearcoat: q.clearcoat ? 0.6 : 0,
      clearcoatRoughness: 0.15,
    });
    const tyre = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
    const rim = new MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.75 });
    const dark = new MeshStandardMaterial({ color: '#0d0e10', roughness: 0.7, metalness: 0 });
    const metal = new MeshStandardMaterial({ color: '#2b2e33', roughness: 0.4, metalness: 0.8 });
    const helmet = new MeshPhysicalMaterial({
      color: new Color(livery.secondary),
      roughness: 0.25,
      clearcoat: q.clearcoat ? 1 : 0,
    });
    const visor = new MeshPhysicalMaterial({ color: '#141821', roughness: 0.08, metalness: 0.6 });
    this.materials.push(paint, carbon, tyre, rim, dark, metal, helmet, visor);
    return { paint, carbon, tyre, rim, dark, metal, helmet, visor };
  }

  private add(parent: Group, geometry: BufferGeometry, material: Material, name: string): Mesh {
    const mesh = new Mesh(this.g(geometry), material);
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  }

  private buildBody(
    geo: CarGeometry,
    livery: Livery,
    m: ReturnType<CarModel['buildMaterials']>,
  ): void {
    const a = geo.axleFront;
    const primary = new Color(livery.primary);
    const secondary = new Color(livery.secondary);
    const accent = new Color(livery.accent);
    // Kestrel's chevron-nose pattern: a forward-pointing chevron on the nose, a spine stripe on
    // the engine cover, the lower flanks in the accent colour.
    const colour = (x: number, y: number, z: number, out: Color): void => {
      const chevron = x - (a + 0.15) + Math.abs(z) * 1.6;
      if (x > a - 0.6 && chevron > 0 && chevron < 0.32 && y > 0.18) out.copy(secondary);
      else if (x < 0.2 && x > -1.9 && Math.abs(z) < 0.035 && y > 0.5) out.copy(secondary);
      else if (y < 0.16) out.copy(accent);
      else out.copy(primary);
    };
    const tub: Section[] = [
      { x: a + 1.02, y: 0.13, w: 0.05, top: 0.035, bottom: 0.03, n: 2.2 },
      { x: a + 0.8, y: 0.16, w: 0.1, top: 0.06, bottom: 0.05, n: 2.4 },
      { x: a + 0.4, y: 0.24, w: 0.16, top: 0.1, bottom: 0.09, n: 2.6 },
      { x: a, y: 0.31, w: 0.22, top: 0.14, bottom: 0.13, n: 2.8 },
      { x: a - 0.55, y: 0.35, w: 0.27, top: 0.21, bottom: 0.18, n: 3 },
      { x: a - 1.05, y: 0.37, w: 0.3, top: 0.24, bottom: 0.2, n: 3.2 },
      { x: a - 1.7, y: 0.39, w: 0.31, top: 0.25, bottom: 0.21, n: 3.2 },
      { x: a - 2.1, y: 0.45, w: 0.26, top: 0.44, bottom: 0.25, n: 2.6 },
      { x: a - 2.5, y: 0.43, w: 0.24, top: 0.36, bottom: 0.25, n: 2.6 },
      { x: a - 3.2, y: 0.36, w: 0.17, top: 0.24, bottom: 0.2, n: 2.4 },
      { x: a - 3.85, y: 0.32, w: 0.1, top: 0.13, bottom: 0.11, n: 2.2 },
      { x: a - 4.3, y: 0.33, w: 0.04, top: 0.04, bottom: 0.04, n: 2 },
    ];
    this.add(this.body, loft(tub, { around: 40, subdivide: 5, colour }), m.paint, 'monocoque');

    // Sidepods, one per side, with a dark inlet at the front.
    for (const side of [1, -1]) {
      const pod: Section[] = [
        { x: a - 1.2, y: 0.34, z: 0.5 * side, w: 0.17, top: 0.12, bottom: 0.13, n: 3.2 },
        { x: a - 1.45, y: 0.33, z: 0.56 * side, w: 0.23, top: 0.17, bottom: 0.14, n: 3 },
        { x: a - 2.1, y: 0.31, z: 0.54 * side, w: 0.24, top: 0.16, bottom: 0.13, n: 2.8 },
        { x: a - 2.8, y: 0.26, z: 0.43 * side, w: 0.17, top: 0.12, bottom: 0.1, n: 2.6 },
        { x: a - 3.45, y: 0.22, z: 0.3 * side, w: 0.08, top: 0.07, bottom: 0.06, n: 2.2 },
      ];
      this.add(this.body, loft(pod, { around: 28, subdivide: 5, colour }), m.paint, 'sidepod');
      const inlet: Section[] = [
        { x: a - 1.19, y: 0.36, z: 0.53 * side, w: 0.13, top: 0.07, bottom: 0.08, n: 3.2 },
        { x: a - 1.22, y: 0.36, z: 0.53 * side, w: 0.13, top: 0.07, bottom: 0.08, n: 3.2 },
      ];
      this.add(this.body, loft(inlet, { around: 24, subdivide: 1 }), m.dark, 'inlet');
    }

    // Airbox intake above the driver's head, and the engine-cover fin.
    this.add(
      this.body,
      loft(
        [
          { x: a - 2.02, y: 0.8, w: 0.07, top: 0.06, bottom: 0.05, n: 2.4 },
          { x: a - 2.05, y: 0.8, w: 0.07, top: 0.06, bottom: 0.05, n: 2.4 },
        ],
        { around: 20, subdivide: 1 },
      ),
      m.dark,
      'airbox',
    );
    const fin = plate(
      [
        [a - 2.3, 0.78],
        [a - 3.9, 0.5],
        [a - 3.95, 0.66],
        [a - 2.5, 0.88],
      ],
      0.012,
    );
    fin.setAttribute('color', solidColours(fin, primary));
    this.add(this.body, fin, m.paint, 'fin');

    // Floor: plan outline with the cut-outs ahead of the rear tyres, and the diffuser ramp.
    const rearInner = geo.trackRear / 2 - REAR_TYRE_WIDTH / 2 - 0.04;
    const floor = plate(
      [
        [a - 0.75, 0.33],
        [a - 1.15, 0.78],
        [a - 2.6, 0.95],
        [a - 3.0, 0.9],
        [a - 3.15, rearInner],
        [a - 3.95, rearInner],
        [a - 3.95, -rearInner],
        [a - 3.15, -rearInner],
        [a - 3.0, -0.9],
        [a - 2.6, -0.95],
        [a - 1.15, -0.78],
        [a - 0.75, -0.33],
      ],
      0.02,
    );
    floor.rotateX(Math.PI / 2);
    floor.translate(0, 0.012, 0);
    this.add(this.body, floor, m.carbon, 'floor');
    const diffuser = plate(
      [
        [0, 0],
        [-0.55, 0.26],
        [-0.6, 0.26],
        [-0.05, 0],
      ],
      2 * rearInner,
    );
    diffuser.translate(a - 3.4, 0.02, 0);
    this.add(this.body, diffuser, m.carbon, 'diffuser');
    // Plank under the floor centreline.
    const plank = plate(
      [
        [a - 0.9, 0.15],
        [a - 3.5, 0.15],
        [a - 3.5, -0.15],
        [a - 0.9, -0.15],
      ],
      0.01,
    );
    plank.rotateX(Math.PI / 2);
    this.add(this.body, plank, m.dark, 'plank');
  }

  private buildWings(geo: CarGeometry, m: ReturnType<CarModel['buildMaterials']>): void {
    const a = geo.axleFront;
    // Front wing: four elements stepping up and back, endplates at the full width.
    const elements = [
      { x: a + 1.12, y: 0.06, chord: 0.3, angle: 0.06 },
      { x: a + 0.9, y: 0.1, chord: 0.22, angle: 0.28 },
      { x: a + 0.74, y: 0.15, chord: 0.17, angle: 0.48 },
      { x: a + 0.62, y: 0.21, chord: 0.13, angle: 0.7 },
    ];
    for (const e of elements) {
      const w = wingElement(e.chord, 0.1, 0.05, 1.86, e.angle);
      w.translate(e.x, e.y, 0);
      this.add(this.body, w, m.carbon, 'front-wing');
    }
    for (const side of [1, -1]) {
      const ep = plate(
        [
          [a + 1.16, 0.03],
          [a + 0.5, 0.03],
          [a + 0.45, 0.3],
          [a + 0.75, 0.33],
          [a + 1.12, 0.16],
        ],
        0.012,
      );
      ep.translate(0, 0, 0.935 * side);
      this.add(this.body, ep, m.carbon, 'front-endplate');
    }
    // Nose pylons down to the main plane.
    for (const side of [1, -1]) {
      const pylon = plate(
        [
          [a + 0.95, 0.1],
          [a + 0.7, 0.1],
          [a + 0.7, 0.2],
          [a + 0.9, 0.16],
        ],
        0.015,
      );
      pylon.translate(0, 0, 0.07 * side);
      this.add(this.body, pylon, m.carbon, 'nose-pylon');
    }

    // Rear wing: beam wing, main plane, DRS flap on a pivot at its leading edge, endplates.
    const r = a - geo.wheelbase;
    const beam = wingElement(0.22, 0.11, 0.05, 0.9, 0.2);
    beam.translate(r - 0.4, 0.46, 0);
    this.add(this.body, beam, m.carbon, 'beam-wing');
    const main = wingElement(0.36, 0.11, 0.07, 1.02, 0.14);
    main.translate(r - 0.48, 0.78, 0);
    this.add(this.body, main, m.carbon, 'rear-wing');
    const flap = wingElement(0.22, 0.09, 0.06, 1.0, 0);
    this.flap.position.set(r - 0.78, 0.86, 0);
    this.flap.rotation.z = -FLAP_CLOSED;
    this.add(this.flap, flap, m.carbon, 'drs-flap');
    this.body.add(this.flap);
    for (const side of [1, -1]) {
      const ep = plate(
        [
          [r - 0.4, 0.4],
          [r - 1.05, 0.42],
          [r - 1.08, 1.02],
          [r - 0.5, 0.98],
          [r - 0.36, 0.72],
        ],
        0.012,
      );
      ep.translate(0, 0, 0.52 * side);
      this.add(this.body, ep, m.carbon, 'rear-endplate');
    }
    const swan = plate(
      [
        [r - 0.15, 0.36],
        [r - 0.3, 0.36],
        [r - 0.62, 0.84],
        [r - 0.5, 0.86],
      ],
      0.02,
    );
    this.add(this.body, swan, m.carbon, 'wing-pylon');
  }

  private buildHalo(m: ReturnType<CarModel['buildMaterials']>): void {
    const a = this.geo.axleFront;
    const c = a - 1.25;
    const hoop = new CatmullRomCurve3([
      new Vector3(c - 0.55, 0.6, -0.31),
      new Vector3(c - 0.4, 0.84, -0.3),
      new Vector3(c + 0.05, 0.89, -0.22),
      new Vector3(c + 0.27, 0.87, 0),
      new Vector3(c + 0.05, 0.89, 0.22),
      new Vector3(c - 0.4, 0.84, 0.3),
      new Vector3(c - 0.55, 0.6, 0.31),
    ]);
    this.add(this.body, new TubeGeometry(hoop, 48, 0.024, 10, false), m.carbon, 'halo');
    const pillar = new CatmullRomCurve3([
      new Vector3(c + 0.62, 0.52, 0),
      new Vector3(c + 0.45, 0.72, 0),
      new Vector3(c + 0.27, 0.87, 0),
    ]);
    this.add(this.body, new TubeGeometry(pillar, 12, 0.026, 10, false), m.carbon, 'halo-pillar');
  }

  private buildCockpit(m: ReturnType<CarModel['buildMaterials']>): void {
    const a = this.geo.axleFront;
    const c = a - 1.35;
    // Cockpit opening rim (dark) and the driver's helmet with a visor band.
    this.add(
      this.body,
      loft(
        [
          { x: c + 0.55, y: 0.61, w: 0.04, top: 0.012, bottom: 0.012, n: 2 },
          { x: c + 0.3, y: 0.615, w: 0.2, top: 0.012, bottom: 0.012, n: 2 },
          { x: c - 0.25, y: 0.62, w: 0.25, top: 0.012, bottom: 0.012, n: 2 },
          { x: c - 0.5, y: 0.63, w: 0.18, top: 0.012, bottom: 0.012, n: 2 },
        ],
        { around: 24, subdivide: 4 },
      ),
      m.dark,
      'cockpit',
    );
    this.driverHead.position.set(c - 0.22, 0.73, 0);
    this.body.add(this.driverHead);
    const helmet = loft(
      [
        { x: 0.16, y: 0, w: 0.04, top: 0.04, bottom: 0.03, n: 2 },
        { x: 0.12, y: 0.01, w: 0.11, top: 0.1, bottom: 0.08, n: 2.2 },
        { x: 0.0, y: 0.02, w: 0.13, top: 0.13, bottom: 0.1, n: 2.3 },
        { x: -0.12, y: 0.01, w: 0.12, top: 0.11, bottom: 0.1, n: 2.2 },
        { x: -0.17, y: -0.01, w: 0.05, top: 0.05, bottom: 0.05, n: 2 },
      ],
      { around: 28, subdivide: 4 },
    );
    this.add(this.driverHead, helmet, m.helmet, 'helmet');
    const visor = loft(
      [
        { x: 0.135, y: 0.035, w: 0.085, top: 0.025, bottom: 0.02, n: 3 },
        { x: 0.1, y: 0.04, w: 0.115, top: 0.03, bottom: 0.025, n: 3 },
        { x: 0.06, y: 0.045, w: 0.125, top: 0.03, bottom: 0.025, n: 3 },
      ],
      { around: 24, subdivide: 3 },
    );
    this.add(this.driverHead, visor, m.visor, 'visor');
    this.cockpitEye.set(c - 0.12, 0.79, 0);
    this.tcamMount.set(a - 2.1, 0.98, 0);

    // Steering wheel: a flat-bottomed grip plate with a dark display, turning on the column.
    this.steeringWheel.position.set(c + 0.32, 0.6, 0);
    const wheel = plate(
      [
        [-0.13, -0.05],
        [-0.15, 0.02],
        [-0.12, 0.08],
        [-0.06, 0.06],
        [0.06, 0.06],
        [0.12, 0.08],
        [0.15, 0.02],
        [0.13, -0.05],
        [0.05, -0.07],
        [-0.05, -0.07],
      ],
      0.025,
      0.004,
    );
    // Plate is in X–Y; turn it to face the driver (normal −X): the plate's X becomes Z.
    wheel.rotateY(Math.PI / 2);
    this.add(this.steeringWheel, wheel, m.carbon, 'steering-wheel');
    const display = plate(
      [
        [-0.05, -0.025],
        [0.05, -0.025],
        [0.05, 0.035],
        [-0.05, 0.035],
      ],
      0.004,
    );
    display.rotateY(Math.PI / 2);
    display.translate(-0.016, 0, 0);
    this.add(this.steeringWheel, display, m.visor, 'wheel-display');
    this.body.add(this.steeringWheel);
  }

  private buildWheels(geo: CarGeometry, m: ReturnType<CarModel['buildMaterials']>): void {
    const R = geo.tyreRadius;
    const make = (
      width: number,
    ): { tyre: BufferGeometry; cover: BufferGeometry; inner: BufferGeometry } => {
      const hw = width / 2;
      const profile = [
        [RIM_RADIUS - 0.005, -hw + 0.012],
        [R - 0.07, -hw - 0.006],
        [R - 0.025, -hw + 0.008],
        [R, -hw + 0.04],
        [R + 0.002, 0],
        [R, hw - 0.04],
        [R - 0.025, hw - 0.008],
        [R - 0.07, hw + 0.006],
        [RIM_RADIUS - 0.005, hw - 0.012],
      ].map(([r, y]) => new Vector2(r as number, y as number));
      const tyre = new LatheGeometry(profile, 64);
      colourTyre(tyre, R, hw);
      // Wheel cover (outer face) and the inner rim barrel.
      const cover = new LatheGeometry(
        [
          new Vector2(0.0, hw - 0.012),
          new Vector2(0.05, hw - 0.012),
          new Vector2(0.07, hw - 0.03),
          new Vector2(RIM_RADIUS - 0.03, hw - 0.04),
          new Vector2(RIM_RADIUS, hw - 0.018),
        ],
        48,
      );
      colourCover(cover);
      const inner = new LatheGeometry(
        [
          new Vector2(RIM_RADIUS, hw - 0.02),
          new Vector2(RIM_RADIUS - 0.01, -hw + 0.02),
          new Vector2(0.06, -hw + 0.05),
        ],
        32,
      );
      colourPlain(inner, '#3a3d42');
      for (const g of [tyre, cover, inner]) g.rotateX(Math.PI / 2);
      return { tyre: this.g(tyre), cover: this.g(cover), inner: this.g(inner) };
    };
    const front = make(FRONT_TYRE_WIDTH);
    const rear = make(REAR_TYRE_WIDTH);
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const left = i % 2 === 0;
      const corner = new Group();
      const steer = new Group();
      const spin = new Group();
      corner.add(steer);
      steer.add(spin);
      const set = isFront ? front : rear;
      const holder = new Group();
      // Lathe axis is now Z with the outer face toward +Z: flip left wheels to face outward.
      if (left) holder.rotation.y = Math.PI;
      holder.add(
        new Mesh(set.tyre, m.tyre),
        new Mesh(set.cover, m.rim),
        new Mesh(set.inner, m.rim),
      );
      spin.add(holder);
      const x = isFront ? geo.axleFront : geo.axleFront - geo.wheelbase;
      const z = ((isFront ? geo.trackFront : geo.trackRear) / 2) * (left ? -1 : 1);
      corner.position.set(x, R, z);
      this.root.add(corner);
      this.corners.push({ corner, steer, spin, front: isFront, left });
    }
  }

  private buildSuspension(geo: CarGeometry, m: ReturnType<CarModel['buildMaterials']>): void {
    const unit = this.g(new CylinderGeometry(1, 1, 1, 8, 1));
    // Flattened, faired arms: wider than deep.
    unit.scale(1, 1, 0.45);
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const side = i % 2 === 0 ? -1 : 1;
      const x = front ? geo.axleFront : geo.axleFront - geo.wheelbase;
      const width = front ? FRONT_TYRE_WIDTH : REAR_TYRE_WIDTH;
      const hub = width / 2 - 0.09;
      const inZ = front ? 0.17 : 0.22;
      const legs: [Vector3, Vector3, number][] = [
        // Upper wishbone (two legs), lower wishbone (two legs), push/pull rod, track rod.
        [new Vector3(x + 0.22, 0.5, inZ * side), new Vector3(0, 0.16, -hub * side), 0.016],
        [new Vector3(x - 0.2, 0.48, inZ * side), new Vector3(0, 0.16, -hub * side), 0.016],
        [new Vector3(x + 0.28, 0.2, inZ * side), new Vector3(0, -0.14, -hub * side), 0.018],
        [
          new Vector3(x - 0.26, 0.2, (inZ + 0.02) * side),
          new Vector3(0, -0.14, -hub * side),
          0.018,
        ],
        [
          new Vector3(x + (front ? -0.05 : 0.08), front ? 0.56 : 0.24, (inZ - 0.04) * side),
          new Vector3(0, front ? -0.12 : 0.13, -hub * side),
          0.012,
        ],
        [
          new Vector3(x + (front ? 0.12 : -0.12), 0.34, inZ * side),
          new Vector3(front ? 0.12 : -0.12, 0.02, -hub * side),
          0.011,
        ],
      ];
      for (const [inboard, outboard, radius] of legs) {
        const mesh = new Mesh(unit, m.carbon);
        mesh.scale.set(radius, 1, radius);
        mesh.name = 'suspension';
        this.root.add(mesh);
        this.arms.push({ mesh, inboard, outboard, wheel: i });
      }
    }
  }

  /** Place the car at an interpolated pose; `drs` is the flap position, 0 closed to 1 open. */
  apply(pose: CarPose, drs: number): void {
    this.root.position.set(pose.x, 0, pose.z);
    this.root.rotation.set(0, pose.yaw, 0);
    this.body.position.set(0, pose.y, 0);
    this.body.rotation.set(pose.roll, 0, pose.pitch, 'ZXY');
    for (let i = 0; i < 4; i++) {
      const c = this.corners[i] as Corner;
      c.corner.position.y = pose.wheelY[i] as number;
      c.steer.rotation.y = c.front ? pose.steerAngle : 0;
      c.spin.rotation.z = -(pose.wheelAngle[i] as number);
    }
    this.flap.rotation.z = -(
      FLAP_CLOSED +
      (FLAP_OPEN - FLAP_CLOSED) * Math.min(1, Math.max(0, drs))
    );
    this.steeringWheel.rotation.x = -pose.steerAngle * STEERING_RATIO;
    this.updateArms();
  }

  private updateArms(): void {
    this.body.updateMatrix();
    for (const arm of this.arms) {
      const c = this.corners[arm.wheel] as Corner;
      tmpA.copy(arm.inboard).applyMatrix4(this.body.matrix);
      tmpB.copy(arm.outboard);
      tmpB.add(c.corner.position);
      const mesh = arm.mesh;
      mesh.position.copy(tmpA).add(tmpB).multiplyScalar(0.5);
      tmpB.sub(tmpA);
      const len = tmpB.length();
      mesh.scale.y = len;
      tmpQ.setFromUnitVectors(up, tmpB.multiplyScalar(1 / Math.max(1e-6, len)));
      mesh.quaternion.copy(tmpQ);
    }
  }

  /** Show or hide the driver's helmet (hidden for the cockpit camera). */
  setHelmetVisible(visible: boolean): void {
    this.driverHead.visible = visible;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}

/** Rubber with a coloured compound ring on both sidewalls, broken by two printed gaps. */
function colourTyre(g: BufferGeometry, R: number, hw: number): void {
  const pos = g.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  const rubber = new Color('#1c1c1e');
  const mark = new Color('#d23b33');
  const print = new Color('#d9d6cf');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    const sidewall = Math.abs(y) > hw - 0.03;
    c.copy(rubber);
    if (sidewall && r > R - 0.075 && r < R - 0.05) c.copy(mark);
    if (sidewall && r > R - 0.048 && r < R - 0.03 && Math.abs(Math.sin(ang)) < 0.18) c.copy(print);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
}

/** Wheel cover: dark carbon disc with five lighter vents so the spin reads at a glance. */
function colourCover(g: BufferGeometry): void {
  const pos = g.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  const base = new Color('#1b1d21');
  const vent = new Color('#6b7079');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const ang = Math.atan2(z, x);
    c.copy(base);
    if (r > 0.08 && r < 0.19 && Math.cos(ang * 5) > 0.75) c.copy(vent);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
}

function colourPlain(g: BufferGeometry, colour: string): void {
  const pos = g.getAttribute('position');
  const c = new Color(colour);
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) colours.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new BufferAttribute(colours, 3));
}

function solidColours(g: BufferGeometry, c: Color): BufferAttribute {
  const n = g.getAttribute('position').count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) out.set([c.r, c.g, c.b], i * 3);
  return new BufferAttribute(out, 3);
}
