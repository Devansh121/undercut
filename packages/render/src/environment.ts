import type { Material, PointLight } from 'three';
import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  Object3D,
  PMREMGenerator,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { LightPool, type LocalLight } from './lighting/light-pool';
import { isLitMaterial } from './lighting/registration';
import { SHADOW_CASTER_LAYER } from './props/registry';
import { groundBounce, skyRotation, type SkyMeta, type TimeOfDay } from './lighting/time-of-day';
import type { Quality } from './quality';

/**
 * Height fog for every material: extinction falls off exponentially with height above the camera
 * (scale 60 m), integrated along the view ray, so low ground hazes over first and the sky stays
 * clear. Colour comes from the sky's horizon (set on the scene fog per circuit). The fog density
 * uniform is the extinction per metre at camera height. Installed once for the page.
 */
let fogInstalled = false;
function installHeightFog(): void {
  if (fogInstalled) return;
  fogInstalled = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogOffset;
#endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogOffset = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogOffset;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogDist = length( vFogOffset );
    float fogK = vFogOffset.y / 60.0;
    float fogH = abs( fogK ) > 1e-3 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0 - 0.5 * fogK;
    float fogFactor = 1.0 - exp( - fogDensity * fogDist * fogH );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform sampler2D tSky;
uniform float skyScale;
uniform mat3 skyRotation;
uniform vec3 sunDirection;
uniform vec3 sunRadiance;
uniform float sunCos;
uniform vec3 hazeColour;
uniform float haze;
uniform vec3 groundRadiance;
varying vec3 vDir;
#include <common>
void main() {
  vec3 dir = normalize(vDir);
  vec3 d = skyRotation * dir;
  // Equirect lookup (three.js convention); the image is stored top row first, unflipped.
  vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) * RECIPROCAL_PI);
  // Analytic derivatives avoid the seam where atan wraps.
  vec2 duvx = dFdx(uv); vec2 duvy = dFdy(uv);
  duvx.x -= floor(duvx.x + 0.5); duvy.x -= floor(duvy.x + 0.5);
  vec3 col = textureGrad(tSky, uv, duvx, duvy).rgb;
  // Dither by about one 8-bit sRGB step of the stored image (converted to linear) so the
  // quantised cloud gradients do not show as bands after exposure and the tone map.
  float dn = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  col = max(col + dn * (2.2 / 255.0) * pow(col + 1e-4, vec3(0.545)), 0.0) * skyScale;
  #ifdef SUN_DISC
  float mu = dot(dir, sunDirection);
  if (mu > sunCos) {
    // Limb darkening across the disc.
    float r = sqrt(max(0.0, 1.0 - (1.0 - mu) / (1.0 - sunCos)));
    col += sunRadiance * (0.4 + 0.6 * r);
  }
  #endif
  // Below the horizon: the circuit's ground bounce, not the pure-sky image's blue lower half.
  col = mix(col, groundRadiance, smoothstep(-0.01, -0.12, dir.y));
  // The horizon melts into the haze the ground is fogged with.
  float h = (1.0 - smoothstep(-0.02, 0.16, dir.y)) * smoothstep(-0.2, -0.03, dir.y);
  col = mix(col, hazeColour, haze * h);
  gl_FragColor = vec4(col, 1.0);
  // Drawn straight to the canvas (the direct path) the sky needs the renderer's tone map and sRGB
  // output like every built-in material; three.js enables these chunks only for canvas output,
  // so into HDR targets and the environment bake the sky stays linear.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface SkyAsset {
  meta: SkyMeta;
  image: ImageBitmap;
}

/** Average linear colour of the sky just above the horizon (2–8°), in radiance units. */
function horizonColour(image: ImageBitmap, scale: number): Color {
  const w = 64;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const out = new Color(0.6, 0.65, 0.7);
  if (!ctx) return out;
  ctx.drawImage(image, 0, 0, w, h);
  // Rows for elevations 2–8°: v = 0.5 - el/180.
  const y0 = Math.floor(h * (0.5 - 8 / 180));
  const y1 = Math.ceil(h * (0.5 - 2 / 180));
  const data = ctx.getImageData(0, y0, w, Math.max(1, y1 - y0)).data;
  const c = new Color();
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    c.setRGB(
      (data[i] as number) / 255,
      (data[i + 1] as number) / 255,
      (data[i + 2] as number) / 255,
      SRGBColorSpace,
    );
    r += c.r;
    g += c.g;
    b += c.b;
  }
  return out.setRGB((r / n) * scale, (g / n) * scale, (b / n) * scale);
}

/**
 * Sky, sun, image-based light, haze and (at night) local lights for one session.
 *
 * - The sky is the circuit's HDRI with its sun painted out (tools/assets/build_textures.py), on
 *   a dome that follows the camera, rotated so the photographed sun sits at the circuit's bearing.
 *   The sun is drawn back as an analytic disc and lit as a directional light whose irradiance is
 *   the one measured on the image, so sky and sun keep the photographed ratio.
 * - The same dome without the disc is prefiltered (PMREM) into the scene's environment map.
 * - Sun shadows are cascaded (three's CSM): every lit material is registered so it picks its
 *   cascade; the cascades snap to texels, so edges do not crawl when the car moves.
 */
export class Environment {
  readonly sunDirection = new Vector3(0, 1, 0);
  readonly fog: FogExp2;
  readonly pool: LightPool | null;
  readonly csm: CSM | null = null;
  private readonly sun: DirectionalLight | null = null;
  private readonly sunTarget = new Object3D();
  private readonly fill: HemisphereLight | null = null;
  private readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly skyTexture: Texture;
  private envTarget: WebGLRenderTarget | null = null;
  private readonly registered = new WeakSet<Material>();
  private readonly quality: Quality;
  readonly exposure: number;
  /** Directional sun irradiance (sky units) and colour, for tests and the dashboard of lights. */
  readonly sunIrradiance: number;

  constructor(
    private readonly scene: Scene,
    camera: PerspectiveCamera,
    tod: TimeOfDay,
    sky: SkyAsset,
    quality: Quality,
  ) {
    installHeightFog();
    this.quality = quality;
    this.exposure = tod.exposure;
    const meta = sky.meta;
    const { rotationY, sunDirection } = skyRotation(meta, tod.sunAzimuthDeg);
    this.sunDirection.set(...sunDirection);
    const skyScale = meta.scale * tod.skyIntensity;

    this.skyTexture = new Texture(sky.image);
    this.skyTexture.colorSpace = SRGBColorSpace;
    this.skyTexture.flipY = false;
    this.skyTexture.generateMipmaps = false;
    this.skyTexture.minFilter = LinearFilter;
    this.skyTexture.magFilter = LinearFilter;
    this.skyTexture.needsUpdate = true;

    // Sun: measured irradiance and solid angle give the disc's radiance.
    const irr = new Color(...meta.sun.irradiance).multiplyScalar(tod.sunScale * tod.skyIntensity);
    const lum = irr.r * 0.2126 + irr.g * 0.7152 + irr.b * 0.0722;
    const key = lum > 1e-4 ? lum : tod.sunFallback * skyScale * 0.1;
    this.sunIrradiance = key;
    const sunColour = lum > 1e-4 ? irr.clone().multiplyScalar(1 / lum) : new Color(1, 1, 1);
    const solid = Math.max(meta.sun.solidAngleSr, 6.8e-5);
    const sunCos = 1 - solid / (2 * Math.PI);
    // Clamp the disc so bloom makes a glare, not a white-out.
    const discRadiance = irr
      .clone()
      .multiplyScalar(Math.min(1 / solid, 2000 / Math.max(1e-3, lum)));

    const haze = tod.fogColour
      ? new Color(tod.fogColour).multiplyScalar(tod.skyIntensity)
      : horizonColour(sky.image, skyScale);
    this.fog = new FogExp2(haze, tod.fogDensity);
    scene.fog = this.fog;

    const rot = new Matrix3().setFromMatrix4(new Matrix4().makeRotationY(-rotationY));
    const material = new ShaderMaterial({
      name: 'Sky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        tSky: { value: this.skyTexture },
        skyScale: { value: skyScale },
        skyRotation: { value: rot },
        sunDirection: { value: this.sunDirection },
        sunRadiance: { value: discRadiance },
        sunCos: { value: sunCos },
        hazeColour: { value: haze },
        haze: { value: 0.85 },
        groundRadiance: { value: new Color(...groundBounce(meta, tod)) },
      },
      defines: lum > 1e-4 ? { SUN_DISC: '' } : {},
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
    });
    this.dome = new Mesh(new SphereGeometry(100, 64, 32), material);
    this.dome.name = 'sky';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.onBeforeRender = (_r, _s, cam) => {
      this.dome.position.copy(cam.position);
      this.dome.updateMatrixWorld();
    };
    scene.add(this.dome);

    // Direct light.
    const softness = tod.shadowSoftness;
    if (key > 1e-4) {
      if (quality.shadow.cascades > 0) {
        const csm = new CSM({
          camera,
          parent: scene,
          cascades: quality.shadow.cascades,
          maxFar: quality.shadow.maxFar,
          mode: 'practical',
          shadowMapSize: quality.shadow.mapSize,
          lightDirection: this.sunDirection.clone().negate(),
          lightIntensity: key,
          lightNear: 1,
          lightFar: 1200,
          lightMargin: 150,
          shadowBias: -0.00008,
        });
        csm.fade = true;
        for (const light of csm.lights) {
          light.color.copy(sunColour);
          light.shadow.normalBias = 0.025;
          // PCF radius in this three.js spreads wide: 0.5 is a slightly soft sun edge.
          light.shadow.radius = quality.shadow.softness * softness * 0.45;
          light.shadow.blurSamples = 12;
          // Shadow-only prop proxies (PropKind.shadowLevel) are drawn by these cameras alone.
          light.shadow.camera.layers.enable(SHADOW_CASTER_LAYER);
        }
        this.csm = csm;
      } else {
        this.sun = new DirectionalLight(sunColour, key);
        this.sun.position.copy(this.sunDirection).multiplyScalar(500);
        this.sun.target = this.sunTarget;
        scene.add(this.sun, this.sunTarget);
      }
    }

    // Without a prefiltered environment (Lite), a hemisphere stands in for the sky.
    if (quality.envSize <= 0) {
      const skyIrr = new Color(...meta.skyIrradiance).multiplyScalar(tod.skyIntensity / Math.PI);
      this.fill = new HemisphereLight(
        skyIrr.clone().multiplyScalar(1.4),
        new Color('#4a4f33').multiplyScalar(skyIrr.g * 0.5),
        1,
      );
      scene.add(this.fill);
    }
    this.pool =
      tod.localLightSlots > 0
        ? new LightPool(scene, Math.min(tod.localLightSlots, quality.post ? 8 : 4))
        : null;
  }

  /** How many times the environment map was prefiltered (once, plus once per context restore). */
  bakes = 0;

  /**
   * A scene holding only the sky dome (sharing its geometry and material), for render checks
   * that need the sky's output through each render path without the circuit or the cars.
   */
  skyOnlyScene(): Scene {
    const scene = new Scene();
    const dome = new Mesh(this.dome.geometry, this.dome.material);
    dome.frustumCulled = false;
    dome.onBeforeRender = (_r, _s, cam) => {
      dome.position.copy(cam.position);
      dome.updateMatrixWorld();
    };
    scene.add(dome);
    return scene;
  }

  /** Prefilter the sky (without the sun disc) into the scene's environment map. */
  bake(renderer: WebGLRenderer): void {
    if (this.quality.envSize <= 0) return;
    this.bakes++;
    const pmrem = new PMREMGenerator(renderer);
    const skyScene = new Scene();
    const mat = this.dome.material.clone();
    delete mat.defines.SUN_DISC;
    (mat.uniforms.haze as { value: number }).value = 0.6;
    mat.uniforms.tSky = this.dome.material.uniforms.tSky as { value: Texture };
    const dome = new Mesh(this.dome.geometry, mat);
    dome.frustumCulled = false;
    skyScene.add(dome);
    const target = pmrem.fromScene(skyScene, 0, 0.1, 1000, { size: this.quality.envSize });
    mat.dispose();
    pmrem.dispose();
    this.envTarget?.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 1.28;
  }

  /**
   * Hook every lit material under `root` into the cascaded shadows (once per material). Must run
   * for every object added to the scene: without it a material would be lit by every cascade.
   */
  register(root: Object3D): void {
    const csm = this.csm;
    if (!csm) return;
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        if (!isLitMaterial(m) || this.registered.has(m)) continue;
        this.registered.add(m);
        const prev = m.onBeforeCompile;
        csm.setupMaterial(m);
        const hook = m.onBeforeCompile;
        m.onBeforeCompile = function (shader, renderer) {
          prev.call(this, shader, renderer);
          hook.call(this, shader, renderer);
        };
      }
    });
  }

  /** Whether `m` is hooked into the cascades (always true without cascades). */
  isRegistered(m: Material): boolean {
    return this.csm === null || this.registered.has(m);
  }

  /** Local lights (floodlights) the pool assigns to its slots each frame. */
  setLocalLights(lights: readonly LocalLight[]): void {
    this.pool?.setLights(lights);
  }

  /** Per frame, before rendering: cascades follow the camera, the pool picks its lights. */
  update(camera: PerspectiveCamera, focus: Vector3, projectionChanged: boolean): void {
    if (this.csm) {
      if (projectionChanged) this.csm.updateFrustums();
      this.csm.update();
    }
    if (this.sun) {
      this.sunTarget.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(this.sunDirection, 500);
      this.sunTarget.updateMatrixWorld();
    }
    this.pool?.update(camera.position);
  }

  /** Lights that cast shadows (for counting draw cost). */
  get shadowLights(): readonly (DirectionalLight | PointLight)[] {
    return this.csm ? this.csm.lights : [];
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.envTarget = null;
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.skyTexture.dispose();
    if (this.csm) {
      for (const l of this.csm.lights) l.shadow.dispose();
      this.csm.remove();
      this.csm.dispose();
    }
    this.sun?.shadow.dispose();
    this.pool?.dispose();
    this.scene.fog = null;
  }
}
