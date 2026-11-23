import {
  Color,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshPhysicalMaterial,
  NoColorSpace,
  PerspectiveCamera,
  Plane,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Mesh,
  type Object3D,
  type Scene,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { hash01 } from './dressing';

/**
 * Open water (Singapore's bay and river): a surface lit as water, not as a dark plastic sheet.
 *
 * - **Waves**: a tiling slope map generated at load (a sum of directional waves whose wave
 *   vectors are whole numbers of cycles per tile, so it tiles exactly), read at three scales
 *   drifting in different directions: short chop, a cross chop and a long swell. The slopes
 *   flatten with distance (the mip chain does part of it) and the lost detail goes into
 *   roughness, so the far bay neither sparkles nor turns into a mirror.
 * - **Fresnel**: the physical material's own, from the index of refraction of water (F0 2 %):
 *   dark where you look down into it, the sky and skyline where you look across it.
 * - **Reflection**: a planar reflection of the sky dome and the skyline (buildings, stands,
 *   backdrops, floodlight masts; on High also the circuit, ground and trees) rendered from the
 *   mirrored camera into a half-float target at a fraction of the frame's resolution, read
 *   through the wave slopes. It replaces the prefiltered environment map's radiance in the
 *   material's own image-based specular term, so the BRDF weights it. At night the lit windows
 *   and lamps are what it reflects. Without a reflection (a preset with it off, or no float
 *   targets) the environment map stands in.
 */

/** The reflection draws objects on this layer (the main camera keeps layer 0). */
export const REFLECT_LAYER = 5;

/** What a preset draws of the water (presets.json, `world.water`). */
export interface WaterQuality {
  /** Reflection target size as a fraction of the drawing buffer (0: no planar reflection). */
  reflection: number;
  /** The reflection also draws the circuit, the ground and the trees (else sky and skyline). */
  scenery: boolean;
  /** Slope map size, texels. */
  waveTexels: number;
}

/** Slope map tile sizes, m: chop, cross chop, swell. */
export const WAVE_TILES: readonly [number, number, number] = [7.5, 19, 61];

/**
 * A tiling slope map: per texel the surface slope (dh/dx, dh/dz) of a sum of directional waves,
 * stored as 0.5 + slope / (2 * SLOPE_RANGE) in red and green, the height in blue (unused by the
 * shader; kept for checks), alpha 1. Wave vectors are whole cycles per tile, so the map tiles
 * without a seam; amplitudes fall with wavenumber (a steep spectrum, wind-driven toward +x).
 */
export const SLOPE_RANGE = 2.4;
export function waveSlopes(size: number, seed = 7): Float32Array {
  const waves: { kx: number; kz: number; a: number; phase: number }[] = [];
  for (let i = 0; i < 48; i++) {
    // Direction about the wind (+x) within ±70°, wavenumber 2..18 cycles per tile.
    const ang = (hash01(seed, i, 1) - 0.5) * 2.4;
    const k = 2 + Math.floor(Math.pow(hash01(seed, i, 2), 1.6) * 16);
    const kx = Math.round(Math.cos(ang) * k);
    const kz = Math.round(Math.sin(ang) * k);
    if (kx === 0 && kz === 0) continue;
    const kk = Math.hypot(kx, kz);
    // Slope amplitude ∝ k · a ∝ k^-0.6: short waves still carry visible slope (the chop).
    waves.push({ kx, kz, a: Math.pow(kk, -1.6), phase: hash01(seed, i, 3) * Math.PI * 2 });
  }
  const out = new Float32Array(size * size * 3);
  const tau = Math.PI * 2;
  // Normalise so the slopes' standard deviation is 0.72 (about a third of the stored range).
  let var2 = 0;
  for (const w of waves) var2 += 0.5 * (w.a * tau) ** 2 * (w.kx * w.kx + w.kz * w.kz);
  const norm = 0.72 / Math.sqrt(var2 / 2);
  for (let j = 0; j < size; j++) {
    const v = j / size;
    for (let i = 0; i < size; i++) {
      const u = i / size;
      let sx = 0;
      let sz = 0;
      let h = 0;
      for (const w of waves) {
        const t = tau * (w.kx * u + w.kz * v) + w.phase;
        const c = Math.cos(t) * w.a * tau;
        sx += c * w.kx;
        sz += c * w.kz;
        h += Math.sin(t) * w.a;
      }
      const o = (j * size + i) * 3;
      out[o] = sx * norm;
      out[o + 1] = sz * norm;
      out[o + 2] = h * norm;
    }
  }
  return out;
}

/** The slope map as a repeating, mipmapped texture (linear data, no colour space). */
export function waveTexture(size: number): DataTexture {
  const s = waveSlopes(size);
  const data = new Uint8Array(size * size * 4);
  const enc = (x: number): number =>
    Math.round(Math.min(1, Math.max(0, 0.5 + x / (2 * SLOPE_RANGE))) * 255);
  for (let p = 0; p < size * size; p++) {
    data[p * 4] = enc(s[p * 3] as number);
    data[p * 4 + 1] = enc(s[p * 3 + 1] as number);
    data[p * 4 + 2] = enc((s[p * 3 + 2] as number) * 0.5);
    data[p * 4 + 3] = 255;
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const PARS_VERTEX = /* glsl */ `
varying vec3 vWaterWorld;`;
const WORLD_VERTEX = /* glsl */ `
#include <project_vertex>
vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`;

const PARS_FRAGMENT = /* glsl */ `
varying vec3 vWaterWorld;
uniform sampler2D uWaveSlopes;
uniform float uWaveTime;
uniform vec3 uWaveTiles;
uniform float uWaveStrength;
#ifdef WATER_REFLECT
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
#endif
// Slope of one layer (standard deviation about 0.72 before the layer's weight).
vec2 waterSlope(vec2 p, float scale, vec2 drift, mat2 turn) {
  vec2 s = texture2D(uWaveSlopes, turn * (p / scale) + drift * uWaveTime).xy;
  return (s * 2.0 - 1.0) * ${SLOPE_RANGE.toFixed(2)};
}`;

/**
 * Slopes of the three layers, each weighted to its own steepness (harbour chop about 0.08, the
 * cross chop 0.06, the swell 0.03 standard deviation), faded with distance; the lost slope
 * variance goes to roughness.
 */
const NORMAL_FRAGMENT = /* glsl */ `
#include <normal_fragment_maps>
vec2 waterSlopeXZ;
float waterRough;
{
  float dist = length(vWaterWorld - cameraPosition);
  vec2 p = vWaterWorld.xz;
  const mat2 I2 = mat2(1.0, 0.0, 0.0, 1.0);
  const mat2 R1 = mat2(0.6, 0.8, -0.8, 0.6);
  const mat2 R2 = mat2(-0.28, 0.96, -0.96, -0.28);
  vec2 chop = waterSlope(p, uWaveTiles.x, vec2(0.031, 0.012), I2) * 0.11;
  vec2 crossChop = waterSlope(p, uWaveTiles.y, vec2(-0.011, 0.017), R1) * 0.085;
  vec2 swell = waterSlope(p, uWaveTiles.z, vec2(0.004, -0.002), R2) * 0.04;
  // Short waves fade first (they alias first): by 60 m the chop, by 250 m the cross chop.
  float fChop = 1.0 / (1.0 + dist / 60.0);
  float fCross = 1.0 / (1.0 + dist / 250.0);
  waterSlopeXZ = (chop * fChop + crossChop * fCross + swell) * uWaveStrength;
  // Slope variance the fade removed, as roughness (Toksvig-like): far water reads as a glossy
  // sheet with a soft sun path instead of a mirror.
  waterRough = (1.0 - fChop * fChop) * 0.0064 + (1.0 - fCross * fCross) * 0.0037;
  // GGX alpha (roughness squared) of the unresolved slopes: alpha² = 2 σ². (The roughness
  // factor is read later, in the physical material's lights chunk.)
  roughnessFactor = pow(pow(roughnessFactor, 4.0) + 2.0 * waterRough, 0.25);
  vec3 wn = normalize(vec3(-waterSlopeXZ.x, 1.0, -waterSlopeXZ.y));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`;

/** The planar reflection read through the wave slopes, in place of the environment's radiance. */
const REFLECT_FRAGMENT = /* glsl */ `
#include <lights_fragment_maps>
#ifdef WATER_REFLECT
{
  // Offset along the slope in metres: the reflection wobbles with the waves, less far away.
  vec3 q = vWaterWorld + vec3(waterSlopeXZ.x, 0.0, waterSlopeXZ.y) * 2.2;
  vec4 rc = uReflectionMatrix * vec4(q, 1.0);
  vec2 ruv = clamp(rc.xy / rc.w, vec2(0.001), vec2(0.999));
  radiance = texture2D(uReflection, ruv).rgb;
}
#endif`;

/** Uniforms the water shader shares with its surface (time, reflection). */
interface WaterUniforms {
  uWaveSlopes: { value: DataTexture };
  uWaveTime: { value: number };
  uWaveTiles: { value: Vector3 };
  uWaveStrength: { value: number };
  uReflection: { value: WebGLRenderTarget['texture'] | null };
  uReflectionMatrix: { value: Matrix4 };
}

/**
 * The reflected camera for a horizontal mirror at height `level`: the eye mirrored, the
 * projection the same but with its near plane replaced by the water plane (oblique clipping,
 * after Lengyel and three.js's Reflector), so nothing under the water draws into the reflection.
 * `texture` maps world points to the reflection target's uv (and depth) in clip space.
 */
export class MirrorCamera {
  readonly camera = new PerspectiveCamera();
  readonly texture = new Matrix4();
  private readonly plane = new Plane();
  private readonly clip = new Vector4();
  private readonly q = new Vector4();
  private readonly v = new Vector3();
  private readonly look = new Vector3();
  private readonly up = new Vector3();

  update(main: Camera, level: number): void {
    const cam = this.camera;
    const mw = main.matrixWorld.elements;
    // Eye mirrored about y = level.
    const ex = mw[12] as number;
    const ey = mw[13] as number;
    const ez = mw[14] as number;
    cam.position.set(ex, 2 * level - ey, ez);
    // Forward (-z column) and up (y column), mirrored in y.
    this.look.set(-(mw[8] as number), mw[9] as number, -(mw[10] as number));
    this.up.set(mw[4] as number, -(mw[5] as number), mw[6] as number);
    cam.up.copy(this.up);
    this.v.copy(cam.position).add(this.look);
    cam.lookAt(this.v);
    if ((main as PerspectiveCamera).isPerspectiveCamera) cam.far = (main as PerspectiveCamera).far;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const p = cam.projectionMatrix;
    p.copy(main.projectionMatrix);
    // Mirrored image: flip the horizontal view offset as the reflection flips left and right.
    p.elements[8] = -(p.elements[8] as number);
    p.elements[12] = -(p.elements[12] as number);
    cam.projectionMatrixInverse.copy(p).invert();
    this.texture.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texture.multiply(p).multiply(cam.matrixWorldInverse);
    // Oblique near plane: the water plane in the mirrored camera's view space.
    this.plane.set(new Vector3(0, 1, 0), -level).applyMatrix4(cam.matrixWorldInverse);
    const c = this.clip.set(
      this.plane.normal.x,
      this.plane.normal.y,
      this.plane.normal.z,
      this.plane.constant,
    );
    const e = p.elements;
    this.q.set(
      (Math.sign(c.x) + (e[8] as number)) / (e[0] as number),
      (Math.sign(c.y) + (e[9] as number)) / (e[5] as number),
      -1,
      (1 + (e[10] as number)) / (e[14] as number),
    );
    c.multiplyScalar(2 / c.dot(this.q));
    e[2] = c.x;
    e[6] = c.y;
    e[10] = c.z + 1;
    e[14] = c.w;
    cam.projectionMatrixInverse.copy(p).invert();
  }
}

/** Which objects the reflection draws, by name (see the module comment). */
export function reflectedByName(
  name: string,
  scenery: boolean,
  skyline: (n: string) => boolean,
): boolean {
  if (name === 'sky') return true;
  if (/^world:(buildings|pit-building|stands|bridges|bridge-struct)/.test(name)) return true;
  if (skyline(name)) return true;
  if (!scenery) return false;
  return (
    name === 'track' ||
    name.startsWith('world:ground') ||
    name.startsWith('prop:tree-') ||
    name.startsWith('prop:floodlight') ||
    name.startsWith('prop:lighting-truss') ||
    name.startsWith('prop:street-')
  );
}

/**
 * The water surfaces' material and their reflection. One reflection plane, at the level of the
 * largest body; bodies more than `LEVEL_TOLERANCE` off it use the environment map instead.
 */
export class WaterSurface {
  /** Material of the bodies at the reflection's level (the planar reflection when on). */
  readonly material: MeshPhysicalMaterial;
  /** Material of the bodies at other levels (environment map only). */
  readonly flatMaterial: MeshPhysicalMaterial;
  readonly level: number;
  private readonly uniforms: WaterUniforms;
  private readonly slopes: DataTexture;
  private readonly target: WebGLRenderTarget | null = null;
  private readonly mirror = new MirrorCamera();
  private readonly size = new Vector2();
  private marked = false;
  private pending = false;
  /** Reflection passes drawn (for the frame stats). */
  passes = 0;

  constructor(
    level: number,
    private readonly quality: WaterQuality,
    /** Kit or other objects named for the skyline the reflection always draws. */
    private readonly skyline: (name: string) => boolean = () => false,
    floatTargets = true,
  ) {
    this.level = level;
    this.slopes = waveTexture(quality.waveTexels);
    this.uniforms = {
      uWaveSlopes: { value: this.slopes },
      uWaveTime: { value: 0 },
      uWaveTiles: { value: new Vector3(...WAVE_TILES) },
      uWaveStrength: { value: 1 },
      uReflection: { value: null },
      uReflectionMatrix: { value: this.mirror.texture },
    };
    if (quality.reflection > 0 && floatTargets) {
      this.target = new WebGLRenderTarget(1, 1, {
        type: HalfFloatType,
        depthBuffer: true,
        generateMipmaps: false,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
      });
      this.target.texture.name = 'water-reflection';
      this.uniforms.uReflection.value = this.target.texture;
    }
    this.material = this.makeMaterial(this.target !== null, 'water');
    this.flatMaterial = this.target ? this.makeMaterial(false, 'water-flat') : this.material;
  }

  private makeMaterial(reflect: boolean, name: string): MeshPhysicalMaterial {
    // Harbour water: little light comes back out of it (a deep green-grey), all the rest is
    // the surface's reflection, weighted by the material's Fresnel at water's index (1.33).
    const m = new MeshPhysicalMaterial({
      color: new Color('#0c2224'),
      roughness: 0.06,
      metalness: 0,
      ior: 1.333,
      specularIntensity: 1,
      envMapIntensity: 1,
    });
    m.name = name;
    const u = this.uniforms;
    m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, u);
      if (reflect) shader.defines = { ...(shader.defines ?? {}), WATER_REFLECT: '' };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PARS_VERTEX}`)
        .replace('#include <project_vertex>', WORLD_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PARS_FRAGMENT}`)
        .replace('#include <normal_fragment_maps>', NORMAL_FRAGMENT)
        .replace('#include <lights_fragment_maps>', REFLECT_FRAGMENT);
    };
    m.customProgramCacheKey = () => `water-v1-${reflect ? 1 : 0}`;
    return m;
  }

  /** Hook a body's mesh: the first one drawn each frame renders the reflection. */
  attach(mesh: Mesh): void {
    if (!this.target || mesh.material !== this.material) return;
    mesh.onBeforeRender = (renderer, scene, camera) => this.reflect(renderer, scene, camera);
  }

  /** Per frame: wave time, and allow one reflection pass. */
  update(time: number): void {
    this.uniforms.uWaveTime.value = time;
    this.pending = true;
  }

  private markScene(scene: Scene): void {
    this.marked = true;
    scene.traverse((o: Object3D) => {
      if (reflectedByName(o.name, this.quality.scenery, this.skyline)) {
        o.traverse((c) => c.layers.enable(REFLECT_LAYER));
      }
    });
  }

  private reflect(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const target = this.target;
    if (!target || !this.pending) return;
    // Only from above the water, and only for the view's own camera (not a shadow or probe).
    if (!(camera as PerspectiveCamera).isPerspectiveCamera) return;
    if (camera.layers.isEnabled(REFLECT_LAYER) || camera === this.mirror.camera) return;
    const eyeY = camera.matrixWorld.elements[13] as number;
    if (eyeY <= this.level + 0.05) return;
    this.pending = false;
    if (!this.marked) this.markScene(scene);
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(16, Math.round(this.size.x * this.quality.reflection));
    const h = Math.max(16, Math.round(this.size.y * this.quality.reflection));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    this.mirror.update(camera, this.level);
    this.mirror.camera.layers.set(REFLECT_LAYER);
    const previous = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, this.mirror.camera);
    renderer.shadowMap.autoUpdate = shadows;
    renderer.setRenderTarget(previous);
    this.passes++;
  }

  dispose(): void {
    this.slopes.dispose();
    this.target?.dispose();
    this.material.dispose();
    if (this.flatMaterial !== this.material) this.flatMaterial.dispose();
  }
}
