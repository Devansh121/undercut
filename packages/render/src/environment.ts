import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MathUtils,
  Object3D,
  PMREMGenerator,
  Scene,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Quality } from './quality';

/** Lighting preset for a circuit: sun position and colour, sky and haze. */
export interface LightingPreset {
  /** Sun elevation and azimuth, degrees. Azimuth 0 is north (−Z), 90 east (+X). */
  sunElevation: number;
  sunAzimuth: number;
  /** Sun colour and illuminance scale. */
  sunColour: string;
  sunIntensity: number;
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  cloudCoverage: number;
  /** Exponential fog density, per metre, and the haze colour it fades to. */
  fogDensity: number;
  fogColour: string;
  exposure: number;
  /** Scale of the sky's image-based light; the analytic sky is bright and very blue. */
  envIntensity: number;
  /** Hemisphere fill intensity. */
  fill: number;
}

/** Monza, afternoon, partly cloudy, sun ~35° in the south-west (docs/visual-direction.md). */
export const MONZA_AFTERNOON: Readonly<LightingPreset> = Object.freeze({
  sunElevation: 35,
  sunAzimuth: 235,
  sunColour: '#fff1df',
  sunIntensity: 3.2,
  turbidity: 4.5,
  rayleigh: 1.4,
  mieCoefficient: 0.004,
  mieDirectionalG: 0.82,
  cloudCoverage: 0.35,
  fogDensity: 0.00042,
  fogColour: '#c2cbd1',
  exposure: 0.8,
  envIntensity: 0.38,
  fill: 0.2,
});

/**
 * Sky, sun, sky fill and haze. The sky is the Preetham analytic model with a cloud layer; the
 * same sky, without the sun disc, is prefiltered into the environment map so paint, carbon and
 * asphalt reflect the sky they sit under. The sun's shadow box follows a focus point.
 */
export class Environment {
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  readonly fill: HemisphereLight;
  readonly sunDirection = new Vector3();
  private readonly target = new Object3D();
  private envTarget: WebGLRenderTarget | null = null;
  private readonly quality: Quality;
  private readonly envIntensity: number;

  constructor(scene: Scene, preset: LightingPreset, quality: Quality) {
    this.quality = quality;
    this.envIntensity = preset.envIntensity;
    const phi = MathUtils.degToRad(90 - preset.sunElevation);
    const theta = MathUtils.degToRad(preset.sunAzimuth);
    // Azimuth from north (−Z) toward east (+X).
    this.sunDirection.set(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      -Math.sin(phi) * Math.cos(theta),
    );

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    (u.turbidity as { value: number }).value = preset.turbidity;
    (u.rayleigh as { value: number }).value = preset.rayleigh;
    (u.mieCoefficient as { value: number }).value = preset.mieCoefficient;
    (u.mieDirectionalG as { value: number }).value = preset.mieDirectionalG;
    (u.sunPosition as { value: Vector3 }).value.copy(this.sunDirection);
    if (u.cloudCoverage)
      (u.cloudCoverage as { value: number }).value = quality.clouds ? preset.cloudCoverage : 0;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new DirectionalLight(preset.sunColour, preset.sunIntensity);
    this.sun.castShadow = quality.shadowMapSize > 0;
    const cam = this.sun.shadow.camera;
    const e = quality.shadowExtent;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 1;
    cam.far = 600;
    this.sun.shadow.mapSize.set(
      Math.max(1, quality.shadowMapSize),
      Math.max(1, quality.shadowMapSize),
    );
    // Normal offset beats depth bias on thin parts (wings, halo) without peter-panning the car.
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2;
    this.sun.target = this.target;
    scene.add(this.sun, this.target);

    // Bounce from the parkland below, sky above; the environment map does most of the work.
    // Without an environment map the sky's light comes from the hemisphere fill alone.
    const fill = quality.envSize > 0 ? preset.fill : preset.fill + preset.envIntensity * 1.6;
    this.fill = new HemisphereLight('#d9e0e4', '#5a5f3e', fill);
    scene.add(this.fill);

    scene.fog = new FogExp2(new Color(preset.fogColour), preset.fogDensity);
  }

  /** Prefilter the sky into the scene's environment map. Call once after construction. */
  bakeEnvironment(renderer: WebGLRenderer, scene: Scene): void {
    if (this.quality.envSize <= 0) return;
    const pmrem = new PMREMGenerator(renderer);
    const skyScene = new Scene();
    // A temporary sky sharing the live sky's uniforms, with the sun disc hidden so the disc does
    // not burn into the prefiltered map. Its own geometry and material are released below.
    const sky = new Sky();
    sky.scale.setScalar(9000);
    const ownUniforms = sky.material.uniforms;
    sky.material.uniforms = this.sky.material.uniforms;
    const disc = sky.material.uniforms.showSunDisc as { value: number | boolean } | undefined;
    const before = disc?.value;
    if (disc) disc.value = typeof before === 'boolean' ? false : 0;
    skyScene.add(sky);
    const target = pmrem.fromScene(skyScene, 0, 0.1, 10000, { size: this.quality.envSize });
    if (disc && before !== undefined) disc.value = before;
    sky.material.uniforms = ownUniforms;
    sky.geometry.dispose();
    sky.material.dispose();
    pmrem.dispose();
    // Keep the whole render target: disposing only its texture leaves the framebuffer behind.
    this.envTarget?.dispose();
    this.envTarget = target;
    scene.environment = target.texture;
    scene.environmentIntensity = this.envIntensity;
  }

  /** Centre the shadow box on `focus`, snapped to whole shadow texels so edges do not crawl. */
  follow(focus: Vector3): void {
    const e = this.quality.shadowExtent;
    const texel = (2 * e) / Math.max(1, this.quality.shadowMapSize);
    // Snap in the light's view plane: build its basis and quantise the focus along it.
    const dir = this.sunDirection;
    const right = new Vector3(0, 1, 0).cross(dir).normalize();
    const up = dir.clone().cross(right).normalize();
    const r = Math.round(focus.dot(right) / texel) * texel;
    const u2 = Math.round(focus.dot(up) / texel) * texel;
    const f = focus.dot(dir);
    const snapped = right
      .multiplyScalar(r)
      .add(up.multiplyScalar(u2))
      .add(dir.clone().multiplyScalar(f));
    this.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(dir, 300);
    this.target.updateMatrixWorld();
  }

  dispose(): void {
    this.envTarget?.dispose();
    this.envTarget = null;
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    // The shadow map (its render target) belongs to the light.
    this.sun.shadow.dispose();
  }
}
