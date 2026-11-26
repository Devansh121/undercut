import {
  Color,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { Quality } from '../quality';

/**
 * The rear view's camera in the car's body frame (+X forward, +Y up): a little behind and above
 * the driver's eye on the centreline, looking straight back. One wide image serves both mirrors;
 * each glass looks up its own reflected direction in it, so the left mirror shows the back left.
 */
export const MIRROR_VIEW = Object.freeze({
  /** Offset from the cockpit eye, m. */
  back: 0.1,
  up: 0.12,
  /** Fit for the cockpit's damped head travel, plus a border outside the glass lookup. */
  headTravel: 0.03,
  border: 0.08,
  /** Near plane past the headrest, m; far plane, m. */
  near: 0.35,
  far: 350,
});

/** Silvered glass: about 80 % reflectance, a faint cool tint as a real wing mirror has. */
export const MIRROR_TINT: readonly [number, number, number] = [0.78, 0.8, 0.82];

const VERTEX = /* glsl */ `
varying vec3 vMirrorWorld;
varying vec3 vMirrorNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vMirrorWorld = w.xyz;
  vMirrorNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tMirror;
uniform float uLive;
uniform mat3 uMirrorView;
uniform vec4 uMirrorProj;
uniform vec3 uTint;
uniform sampler2D tSky;
uniform float skyScale;
uniform mat3 skyRotation;
uniform vec3 groundRadiance;
uniform vec3 hazeColour;
uniform float haze;
varying vec3 vMirrorWorld;
varying vec3 vMirrorNormal;
#include <common>
// The sky dome's own lookup (environment.ts) without the sun: sky above, the circuit's ground
// bounce below, the haze at the horizon. The static reflection, and the edge of the live one.
vec3 staticView(vec3 dir) {
  vec3 d = skyRotation * dir;
  vec2 uv = vec2(atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5, 0.5 - asin(clamp(d.y, -1.0, 1.0)) * RECIPROCAL_PI);
  vec3 col = texture2D(tSky, uv).rgb * skyScale;
  col = mix(col, groundRadiance, smoothstep(-0.01, -0.12, dir.y));
  float h = (1.0 - smoothstep(-0.02, 0.16, dir.y)) * smoothstep(-0.2, -0.03, dir.y);
  return mix(col, hazeColour, haze * h);
}
void main() {
  vec3 n = normalize(vMirrorNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 r = reflect(normalize(vMirrorWorld - cameraPosition), n);
  vec3 col = staticView(r);
  if (uLive > 0.5) {
    vec3 v = uMirrorView * r;
    if (v.z < -0.05) {
      vec2 uv = (uMirrorProj.xy * v.xy / -v.z + uMirrorProj.zw) * 0.5 + 0.5;
      vec2 e = min(uv, 1.0 - uv);
      float inside = smoothstep(0.0, 0.03, min(e.x, e.y));
      col = mix(col, texture2D(tMirror, clamp(uv, 0.0, 1.0)).rgb, inside);
    }
  }
  gl_FragColor = vec4(col * uTint, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * The cockpit's wing mirrors. On presets with `mirrors.width` the scene behind is rendered from
 * MIRROR_VIEW into a small half-float target every `mirrors.every`th drawn frame while the
 * cockpit camera is on, after the frame's own render (so the water's reflection and the shadow
 * maps are not redone for it); elsewhere the glass shows a static reflection of the circuit's sky
 * and ground, which is what the old flat grey stood in for.
 */
export class CockpitMirrors {
  readonly material: ShaderMaterial;
  readonly camera = new PerspectiveCamera(90, 1, MIRROR_VIEW.near, MIRROR_VIEW.far);
  private readonly target: WebGLRenderTarget | null = null;
  private readonly every: number;
  private countdown = 0;
  private readonly rot = new Matrix3();
  /** Rear-view renders so far (for tests and the stats). */
  passes = 0;

  constructor(
    quality: Pick<Quality, 'mirrors'>,
    sky: Record<string, { value: unknown }>,
    eye: { x: number; y: number; z: number },
    body: Object3D,
  ) {
    const { width, height, every } = quality.mirrors;
    this.every = every;
    if (width > 0 && height > 0 && every > 0) {
      this.target = new WebGLRenderTarget(width, height, {
        type: HalfFloatType,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
      });
      this.target.texture.name = 'cockpit-mirrors';
      this.camera.aspect = width / height;
    }
    this.camera.name = 'mirror-camera';
    this.camera.position.set(eye.x - MIRROR_VIEW.back, eye.y + MIRROR_VIEW.up, eye.z);
    // Looking down the body's -X: a quarter turn about +Y carries the camera's -Z there.
    this.camera.rotation.set(0, Math.PI / 2, 0);
    this.camera.updateProjectionMatrix();
    body.add(this.camera);
    if (this.target) this.fitProjection(body, eye);
    const p = this.camera.projectionMatrix.elements;
    this.material = new ShaderMaterial({
      name: 'mirror_glass',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tMirror: { value: this.target?.texture ?? null },
        uLive: { value: 0 },
        uMirrorView: { value: this.rot },
        uMirrorProj: { value: new Vector4(p[0], p[5], -(p[8] ?? 0), -(p[9] ?? 0)) },
        uTint: { value: new Color(...MIRROR_TINT) },
        tSky: sky.tSky as { value: unknown },
        skyScale: sky.skyScale as { value: unknown },
        skyRotation: sky.skyRotation as { value: unknown },
        groundRadiance: sky.groundRadiance as { value: unknown },
        hazeColour: sky.hazeColour as { value: unknown },
        haze: sky.haze as { value: unknown },
      },
      // The glass is wound facing forward in the asset: seen from the driver's eye its back face
      // was culled and the road showed through the housing (the old "flat grey").
      side: DoubleSide,
      toneMapped: true,
    });
    // Its uniforms reach only the compiled shader: list the target for the texture-memory count.
    this.material.userData.surfaceUniforms = this.target
      ? { tMirror: this.material.uniforms.tMirror }
      : {};
  }

  /**
   * Bound the actual glass's reflected rays in the rear camera, in body space. The texture's
   * aspect is a pixel budget, not the optical field of view: these independent, off-centre
   * bounds include both mirrors without wasting most of the image above/below the glass.
   * Done once, and only for live mirrors; the car's rigid world pose cannot change the bounds.
   */
  private fitProjection(body: Object3D, eye: { x: number; y: number; z: number }): void {
    body.updateWorldMatrix(true, true);
    const worldToBody = body.matrixWorld.clone().invert();
    const toBody = new Matrix4();
    const normalToBody = new Matrix3();
    const toView = new Matrix3().setFromMatrix4(this.camera.matrix.clone().invert());
    const point = new Vector3();
    const normal = new Vector3();
    const ray = new Vector3();
    const head = new Vector3();
    let left = Infinity;
    let right = -Infinity;
    let bottom = Infinity;
    let top = -Infinity;
    body.traverse((object) => {
      if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
      if (object.material.name !== 'mirror_glass') return;
      toBody.multiplyMatrices(worldToBody, object.matrixWorld);
      normalToBody.getNormalMatrix(toBody);
      const positions = object.geometry.getAttribute('position');
      const normals = object.geometry.getAttribute('normal');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(toBody);
        normal.fromBufferAttribute(normals, i).applyMatrix3(normalToBody).normalize();
        for (const x of [-1, 1])
          for (const y of [-1, 1])
            for (const z of [-1, 1]) {
              head.set(
                eye.x + x * MIRROR_VIEW.headTravel,
                eye.y + y * MIRROR_VIEW.headTravel,
                eye.z + z * MIRROR_VIEW.headTravel,
              );
              ray.copy(point).sub(head).normalize().reflect(normal).applyMatrix3(toView);
              if (ray.z >= -0.05) continue;
              left = Math.min(left, ray.x / -ray.z);
              right = Math.max(right, ray.x / -ray.z);
              bottom = Math.min(bottom, ray.y / -ray.z);
              top = Math.max(top, ray.y / -ray.z);
            }
      }
    });
    if (!(right > left && top > bottom)) return;
    const dx = (right - left) * MIRROR_VIEW.border;
    const dy = (top - bottom) * MIRROR_VIEW.border;
    const n = this.camera.near;
    this.camera.projectionMatrix.makePerspective(
      (left - dx) * n,
      (right + dx) * n,
      (top + dy) * n,
      (bottom - dy) * n,
      n,
      this.camera.far,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /** Whether this preset renders the rear view (false: the static reflection only). */
  get live(): boolean {
    return this.target !== null;
  }

  /** The cockpit camera is off: the next time it is on, render the rear view at once. */
  idle(): void {
    this.countdown = 0;
  }

  /**
   * After the frame's render, with the cockpit camera on: every `every`th call renders the rear
   * view. World matrices are current (the frame's render updated them).
   */
  render(renderer: WebGLRenderer, scene: Scene): void {
    const target = this.target;
    if (!target) return;
    if (--this.countdown > 0) return;
    this.countdown = this.every;
    this.camera.updateMatrixWorld();
    this.rot.setFromMatrix4(this.camera.matrixWorldInverse);
    const previous = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const autoUpdate = scene.matrixWorldAutoUpdate;
    scene.matrixWorldAutoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, this.camera);
    scene.matrixWorldAutoUpdate = autoUpdate;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.setRenderTarget(previous);
    this.material.uniforms.uLive!.value = 1;
    this.passes++;
  }

  /** The drawing buffer the rear view uses, px (0 × 0 when static). */
  size(out = new Vector2()): Vector2 {
    return out.set(this.target?.width ?? 0, this.target?.height ?? 0);
  }

  dispose(): void {
    this.camera.removeFromParent();
    this.target?.dispose();
    this.material.dispose();
  }
}
