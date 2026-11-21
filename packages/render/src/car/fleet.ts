import type { Material, Mesh, MeshStandardMaterial } from 'three';
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  DataArrayTexture,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Object3D,
  type Texture,
  type Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { createCarPose, type CarPose } from '@undercut/sim';
import type { CarLod, Quality } from '../quality';
import type { CarAssets, CarLivery } from './car-assets';
import { CarModel, type CarGeometry } from './car-model';
import { COMPOUND_COLOURS, CARBON, LIVERY_GLSL, drawMarking } from './livery';
import { COMPOUND_GLSL, ensureCarShader } from './car-shader';
import { ditherCode, lodBlend } from './lod';

/** Most cars a fleet draws (a full grid). */
export const FLEET_CAPACITY = 24;
const MASK_SIZE = 512;
const CROSSFADE_M = 4;

/** Decal atlas: per car a number cell (1.6:1) and a code cell (3.4:1), 128 px tall. */
const CELL_H = 128;
const NUMBER_W = 205;
const CODE_W = 435;
const ATLAS_W = 1280;
const PER_ROW = 2;
const ATLAS_H = Math.ceil(FLEET_CAPACITY / PER_ROW) * CELL_H;

const BAYER = /* glsl */ `
float fleetBayer(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}`;

interface LodSet {
  lod: CarLod;
  /** One instanced mesh per mesh of the template, in traversal order. */
  meshes: InstancedMesh[];
  fade: InstancedBufferAttribute;
  primary: InstancedBufferAttribute;
  secondary: InstancedBufferAttribute;
  accent: InstancedBufferAttribute;
  mask: InstancedBufferAttribute;
  decal: InstancedBufferAttribute;
}

interface FleetCar {
  pose: CarPose;
  livery: number;
  drs: number;
  /** A posed, never-drawn copy of the asset per level, whose node matrices feed the instances. */
  posed: Map<CarLod, { model: CarModel; meshes: Mesh[] }>;
  dirty: boolean;
}

/**
 * The other cars on track, drawn instanced: every mesh of a level of detail is one draw call for
 * all the cars at that level, whatever their livery. Liveries are per-instance colours over a mask
 * array, numbers and codes come from one atlas, and levels cross-fade by camera distance with
 * complementary dithering. Geometry and textures are the shared asset's; nothing is copied per car.
 */
export class CarFleet {
  readonly group = new Group();
  private readonly sets: LodSet[] = [];
  private readonly cars: FleetCar[] = [];
  private readonly liveries: CarLivery[] = [];
  private readonly materials: Material[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly textures: Texture[] = [];
  private readonly atlas: CanvasTexture;
  private readonly atlasCtx: CanvasRenderingContext2D | null;
  private readonly maskArray: DataArrayTexture;
  private readonly patternIndex = new Map<string, number>();
  private readonly lodLevels: CarLod[];
  private readonly distances: number[];

  constructor(
    private readonly assets: CarAssets,
    private readonly quality: Quality,
    private readonly geo: CarGeometry,
  ) {
    this.group.name = 'fleet';
    this.lodLevels = [...quality.carLods];
    this.distances = [...quality.carLodDistances];
    // Masks as one array texture, one layer per pattern.
    const patterns = [...assets.maskImages.keys()];
    patterns.forEach((p, i) => this.patternIndex.set(p, i));
    const layers = Math.max(1, patterns.length);
    const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4 * layers);
    const canvas = document.createElement('canvas');
    canvas.width = MASK_SIZE;
    canvas.height = MASK_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    patterns.forEach((p, i) => {
      const img = assets.maskImages.get(p);
      if (!ctx || !img) return;
      ctx.clearRect(0, 0, MASK_SIZE, MASK_SIZE);
      ctx.drawImage(img, 0, 0, MASK_SIZE, MASK_SIZE);
      data.set(ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data, i * MASK_SIZE * MASK_SIZE * 4);
    });
    this.maskArray = new DataArrayTexture(data, MASK_SIZE, MASK_SIZE, layers);
    this.maskArray.format = RGBAFormat;
    this.maskArray.type = UnsignedByteType;
    this.maskArray.minFilter = LinearMipmapLinearFilter;
    this.maskArray.magFilter = LinearFilter;
    this.maskArray.generateMipmaps = true;
    this.maskArray.needsUpdate = true;
    this.textures.push(this.maskArray);

    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = ATLAS_W;
    atlasCanvas.height = ATLAS_H;
    this.atlasCtx = atlasCanvas.getContext('2d');
    this.atlas = new CanvasTexture(atlasCanvas);
    this.atlas.flipY = false;
    this.atlas.colorSpace = SRGBColorSpace;
    this.atlas.anisotropy = quality.anisotropy;
    this.textures.push(this.atlas);

    for (const lod of this.lodLevels) this.sets.push(this.buildSet(lod));
  }

  private buildSet(lod: CarLod): LodSet {
    const n = FLEET_CAPACITY;
    const attr = (size: number): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(n * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    const set: LodSet = {
      lod,
      meshes: [],
      fade: attr(1),
      primary: attr(3),
      secondary: attr(3),
      accent: attr(3),
      mask: attr(1),
      decal: attr(4),
    };
    const mats = new Map<Material, Material>();
    const template = this.assets.template(lod).root;
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = new BufferGeometry();
      for (const [k, a] of Object.entries(mesh.geometry.attributes)) g.setAttribute(k, a);
      g.setIndex(mesh.geometry.index);
      g.setAttribute('aFade', set.fade);
      g.setAttribute('aPrimary', set.primary);
      g.setAttribute('aSecondary', set.secondary);
      g.setAttribute('aAccent', set.accent);
      g.setAttribute('aMask', set.mask);
      g.setAttribute('aDecal', set.decal);
      g.boundingSphere = mesh.geometry.boundingSphere;
      this.geometries.push(g);
      const base = mesh.material as Material;
      const kind = mesh.userData.decal as string | undefined;
      const key = kind ? (`decal-${kind}` as unknown as Material) : base;
      let m = mats.get(key);
      if (!m) {
        m = this.fleetMaterial(base, kind);
        mats.set(key, m);
      }
      const im = new InstancedMesh(g, m, n);
      im.name = `fleet:${lod}:${mesh.name}`;
      im.count = 0;
      im.visible = false;
      im.frustumCulled = false;
      im.castShadow = mesh.castShadow && !kind;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      this.group.add(im);
      set.meshes.push(im);
    });
    return set;
  }

  /** A fleet copy of an asset material: dithered LOD fade, and per-instance livery or decals. */
  private fleetMaterial(base: Material, decal: string | undefined): Material {
    let m: MeshStandardMaterial;
    if (decal) {
      m = new MeshPhysicalMaterial({
        map: this.atlas,
        transparent: true,
        roughness: 0.32,
        clearcoat: this.quality.clearcoat ? 1 : 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        depthWrite: false,
      });
    } else {
      m = (base as MeshStandardMaterial).clone();
      if (m.name === 'brake_disc' || m.name === 'rain_light') m.emissiveIntensity = 0;
    }
    const paint = !decal && m.name === 'paint';
    const tyre = !decal && m.name === 'tyre';
    if (paint) {
      // Any mask keeps the UV varyings; the shader samples the array instead.
      m.map = this.assets.masks.values().next().value ?? null;
      m.color.set(0xffffff);
    }
    const uniforms = {
      uMasks: { value: this.maskArray },
      uCarbon: { value: new Color(CARBON) },
      uCell: {
        value: [decal === 'code' ? CODE_W / ATLAS_W : NUMBER_W / ATLAS_W, CELL_H / ATLAS_H],
      },
      uCompound: { value: new Color(COMPOUND_COLOURS.medium) },
    };
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aFade; varying float vFade;
          attribute vec3 aPrimary; attribute vec3 aSecondary; attribute vec3 aAccent; attribute float aMask; attribute vec4 aDecal;
          varying vec3 vPrimary; varying vec3 vSecondary; varying vec3 vAccent; varying float vMask;
          uniform vec2 uCell;`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vFade = aFade; vPrimary = aPrimary; vSecondary = aSecondary; vAccent = aAccent; vMask = aMask;
          ${decal ? `vMapUv = uv * uCell + ${decal === 'code' ? 'aDecal.zw' : 'aDecal.xy'};` : ''}`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vFade; varying vec3 vPrimary; varying vec3 vSecondary; varying vec3 vAccent; varying float vMask;
          uniform highp sampler2DArray uMasks; uniform vec3 uCarbon;
          ${BAYER}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
          {
            float b = fleetBayer(gl_FragCoord.xy);
            if (vFade >= 0.0 ? b >= vFade : b < vFade + 2.0) discard;
          }`,
        );
      if (tyre) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uCompound;')
          .replace('#include <map_fragment>', `#include <map_fragment>\n${COMPOUND_GLSL}`);
      }
      if (paint) {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <map_fragment>',
            `float liveryCarbon = 0.0;
            {
              vec3 uPrimary = vPrimary; vec3 uSecondary = vSecondary; vec3 uAccent = vAccent;
              ${LIVERY_GLSL.replace('LIVERY_SAMPLE', 'texture(uMasks, vec3(vMapUv, vMask)).rgb')}
            }`,
          )
          .replace(
            '#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.42, liveryCarbon);',
          );
      }
    };
    m.customProgramCacheKey = () =>
      `fleet-${paint ? 'paint' : tyre ? 'tyre' : decal ? `decal-${decal}` : 'part'}`;
    if (!decal) ensureCarShader(m as never);
    this.materials.push(m);
    return m;
  }

  /** Add a car (static until `setPose`). Returns its index, or -1 when the fleet is full. */
  add(livery: CarLivery, pose: CarPose, drs = 0): number {
    if (this.cars.length >= FLEET_CAPACITY) return -1;
    const index = this.cars.length;
    const p = createCarPose();
    copyPose(pose, p);
    this.liveries.push(livery);
    this.cars.push({ pose: p, livery: index, drs, posed: new Map(), dirty: true });
    this.drawMarkings(index, livery);
    return index;
  }

  setPose(index: number, pose: CarPose, drs = 0): void {
    const car = this.cars[index];
    if (!car) return;
    copyPose(pose, car.pose);
    car.drs = drs;
    car.dirty = true;
  }

  clear(): void {
    for (const car of this.cars) for (const { model } of car.posed.values()) model.dispose();
    this.cars.length = 0;
    this.liveries.length = 0;
    for (const s of this.sets) {
      for (const m of s.meshes) {
        m.count = 0;
        m.visible = false;
      }
    }
  }

  get size(): number {
    return this.cars.length;
  }

  private drawMarkings(i: number, l: CarLivery): void {
    const ctx = this.atlasCtx;
    if (!ctx) return;
    const x = (i % PER_ROW) * (NUMBER_W + CODE_W);
    const y = Math.floor(i / PER_ROW) * CELL_H;
    drawMarking(ctx, String(l.number), x, y, NUMBER_W, CELL_H, l.primary);
    drawMarking(ctx, l.code, x + NUMBER_W, y, CODE_W, CELL_H, l.primary);
    this.atlas.needsUpdate = true;
  }

  private posed(car: FleetCar, lod: CarLod): { model: CarModel; meshes: Mesh[] } {
    let p = car.posed.get(lod);
    if (!p) {
      const livery = this.liveries[car.livery] as CarLivery;
      const model = new CarModel(this.assets, lod, livery, this.quality, this.geo, 'none');
      const meshes: Mesh[] = [];
      model.root.traverse((o) => {
        if ((o as Mesh).isMesh) meshes.push(o as Mesh);
      });
      p = { model, meshes };
      car.posed.set(lod, p);
      car.dirty = true;
    }
    if (car.dirty) {
      p.model.apply(car.pose, { drs: car.drs, glow: [0, 0, 0, 0], rain: 0, headYaw: 0 });
    }
    return p;
  }

  /** Assign levels by distance from `eye` and write every instance. Call once per frame. */
  update(eye: Vector3): void {
    const counts = this.sets.map(() => 0);
    const c = new Color();
    for (let ci = 0; ci < this.cars.length; ci++) {
      const car = this.cars[ci] as FleetCar;
      const dist = Math.hypot(car.pose.x - eye.x, car.pose.y - eye.y, car.pose.z - eye.z);
      const blend = lodBlend(dist, this.distances, CROSSFADE_M);
      const incoming = blend.length === 2 ? (blend[1]?.fade ?? 1) : 1;
      blend.forEach((w, k) => {
        const setIndex = Math.min(w.level, this.sets.length - 1);
        const set = this.sets[setIndex] as LodSet;
        const posed = this.posed(car, set.lod);
        const slot = counts[setIndex] as number;
        counts[setIndex] = slot + 1;
        const code = blend.length === 1 ? 1 : ditherCode(incoming, k === 1);
        set.fade.setX(slot, code);
        const l = this.liveries[car.livery] as CarLivery;
        set.primary.setXYZ(slot, ...rgb(c, l.primary));
        set.secondary.setXYZ(slot, ...rgb(c, l.secondary));
        set.accent.setXYZ(slot, ...rgb(c, l.accent));
        set.mask.setX(slot, this.patternIndex.get(l.pattern) ?? 0);
        const x = (car.livery % PER_ROW) * (NUMBER_W + CODE_W);
        const y = Math.floor(car.livery / PER_ROW) * CELL_H;
        set.decal.setXYZW(slot, x / ATLAS_W, y / ATLAS_H, (x + NUMBER_W) / ATLAS_W, y / ATLAS_H);
        set.meshes.forEach((im, mi) => {
          const src = posed.meshes[mi];
          if (src) im.setMatrixAt(slot, src.matrixWorld);
        });
      });
      car.dirty = false;
    }
    this.sets.forEach((set, si) => {
      const count = counts[si] as number;
      for (const im of set.meshes) {
        im.count = count;
        // Empty sets stay out of every pass (no empty draws, no unused shader variants).
        im.visible = count > 0;
        im.instanceMatrix.needsUpdate = true;
      }
      for (const a of [set.fade, set.primary, set.secondary, set.accent, set.mask, set.decal])
        a.needsUpdate = true;
    });
  }

  /** Meshes to hook into the cascaded shadows. */
  get root(): Object3D {
    return this.group;
  }

  dispose(): void {
    this.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    for (const s of this.sets) for (const m of s.meshes) m.dispose();
    this.group.removeFromParent();
  }
}

function rgb(c: Color, hex: string): [number, number, number] {
  c.set(hex);
  return [c.r, c.g, c.b];
}

function copyPose(a: CarPose, b: CarPose): void {
  b.x = a.x;
  b.y = a.y;
  b.z = a.z;
  b.yaw = a.yaw;
  b.pitch = a.pitch;
  b.roll = a.roll;
  b.steerAngle = a.steerAngle;
  b.wheelY.set(a.wheelY);
  b.wheelAngle.set(a.wheelAngle);
}
