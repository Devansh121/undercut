import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Track } from '@undercut/track';

/** How much of the driving line to draw: off, only lift/braking zones, or the full ribbon. */
export type DrivingLineMode = 'off' | 'braking' | 'full';

/** Cue at one sample along the line: matches `@undercut/ai`'s `LineCue` values. */
export const DRIVING_LINE_CUE = {
  Throttle: 0,
  Lift: 1,
  Brake: 2,
} as const;
export type DrivingLineCue = (typeof DRIVING_LINE_CUE)[keyof typeof DRIVING_LINE_CUE];

/**
 * Provides the per-sample pedal cues ahead of the car. `@undercut/ai`'s `DrivingLine` satisfies
 * this structurally, keeping `@undercut/render` free of any dependency on `@undercut/ai`.
 */
export interface DrivingLineSource {
  fill(s: number, speed: number, from: number, spacing: number, out: Uint8Array): Uint8Array;
}

/** Snapshot of what the driving line drew on the latest frame (diagnostics and tests). */
export interface DrivingLineState {
  mode: DrivingLineMode;
  visible: boolean;
  throttleCount: number;
  liftCount: number;
  brakeCount: number;
  /** Distance ahead of the car to the nearest brake sample, m, or null when none is in view. */
  firstBrakeDistance: number | null;
}

export interface DrivingLineRibbonOptions {
  /** Start of the ribbon ahead of the car's centre, m (clears the front wing). */
  from?: number;
  /** Total length of the ribbon ahead of `from`, m. */
  length?: number;
  /** Spacing between cross-sections along the line, m. */
  step?: number;
  /** Half-width of the ribbon geometry, m (the shader narrows green/amber inside it). */
  halfWidth?: number;
  /** Elevation above the track surface, m (prevents z-fighting on crests and camber). */
  lift?: number;
}

const DEFAULT_FROM = 3.5;
const DEFAULT_LENGTH = 230;
const DEFAULT_STEP = 2;
const DEFAULT_HALF_WIDTH = 0.9;
const DEFAULT_LIFT = 0.045;

// Design-token palette (design/mock/tokens.css): --c-flag-green, --c-flag-yellow, --c-flag-red, --c-ink-0.
const COLOR_THROTTLE = new Color('#2fbf62').convertSRGBToLinear();
const COLOR_LIFT = new Color('#f6c90e').convertSRGBToLinear();
const COLOR_BRAKE = new Color('#e5383b').convertSRGBToLinear();
const COLOR_BORDER = new Color('#0b0c0e').convertSRGBToLinear();

const VERTEX_SHADER = /* glsl */ `
attribute vec3 aCue;
attribute float aAhead;

varying vec2 vUv;
varying vec3 vCue;
varying float vAhead;

void main() {
  vUv = uv;
  vCue = aCue;
  vAhead = aAhead;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uThrottle;
uniform vec3 uLift;
uniform vec3 uBrake;
uniform vec3 uBorder;
uniform float uFull;
uniform float uLength;
uniform float uGain;

varying vec2 vUv;
varying vec3 vCue;
varying float vAhead;

// Anti-aliased repeating band in phase [0, 1) with duty cycle and automatic distance pre-filtering
// so chevrons settle cleanly into a solid strip at grazing angles and far distance (zero shimmer).
float bandPattern(float coord, float spacing, float duty) {
  float x = coord / spacing;
  float fw = fwidth(x);
  float frac = fract(x);
  float edge = max(fw * 0.9, 0.02);
  float edgeIn = smoothstep(0.0, edge, frac);
  float edgeOut = 1.0 - smoothstep(duty - edge, duty, frac);
  float crisp = edgeIn * edgeOut;
  // Pre-filter toward the average duty as the period shrinks toward the pixel size.
  float alias = smoothstep(0.45, 1.15, fw);
  return mix(crisp, clamp(duty * 1.12, 0.0, 1.0), alias);
}

void main() {
  float au = abs(vUv.x);
  float s = vUv.y;
  float du = max(fwidth(au), 0.012);

  // Per-cue weights: in 'braking' mode throttle weight is hidden.
  float wT = vCue.x * uFull;
  float wL = vCue.y;
  float wB = vCue.z;
  float visWeight = clamp(wT + wL + wB, 0.0, 1.0);
  if (visWeight < 0.004) discard;

  // Distinct width, shape and cadence for each cue (colour-blind safe):
  // - Throttle (green): slim continuous centre strip with subtle forward ticks.
  // - Lift (amber): medium-width open forward chevrons (wide asphalt gap between chevrons).
  // - Brake (red): full-width bold chevrons framed by solid outer guide rails.
  float halfW = (0.30 * wT + 0.68 * wL + 0.96 * wB) / max(visWeight, 0.001);
  float outerEdge = 1.0 - smoothstep(halfW - du, halfW + du, au);
  if (outerEdge < 0.004) discard;

  // Dark border frame around the ribbon for crisp readability against sun-lit asphalt.
  float borderW = mix(0.08, 0.10, wB);
  float innerFill = 1.0 - smoothstep(halfW - borderW - du, halfW - borderW + du, au);

  // Forward-pointing chevron coordinate: tip at au=0 leads outer wings (au=1).
  // Generous longitudinal spacing keeps chevrons individually readable at low cockpit angles.
  float chevLift = bandPattern(s + au * 2.6, 9.5, 0.42);
  float chevBrake = bandPattern(s + au * 2.3, 6.2, 0.50);
  float tickThrottle = bandPattern(s + au * 1.4, 11.0, 0.25);

  // Shape mask per cue:
  // Throttle: solid slim core (0.82) + subtle brighter tick.
  float maskT = max(0.82, 0.82 + 0.18 * tickThrottle);
  // Lift: open chevrons (cut clear through between chevrons for unmistakable shape contrast).
  float maskL = chevLift;
  // Brake: bold chevrons + solid outer rails (|u| in [0.76, 0.96]) so braking reads immediately.
  float railB = smoothstep(0.76 - du, 0.76 + du, au) * outerEdge;
  float maskB = clamp(max(chevBrake, railB * 0.95), 0.0, 1.0);

  float shapeMask = (maskT * wT + maskL * wL + maskB * wB) / max(visWeight, 0.001);

  // Border outline wraps the active chevron/strip silhouette.
  float fillAlpha = shapeMask * innerFill;
  float outlineAlpha = clamp(shapeMask * outerEdge - fillAlpha, 0.0, 1.0);
  // Thin dark shadow border along each chevron edge for high luminance separation on sunlit track.
  float chevBorderL = bandPattern(s + au * 2.6 + 0.35, 9.5, 0.50);
  float chevBorderB = bandPattern(s + au * 2.3 + 0.32, 6.2, 0.60);
  float barBack = ((maskT * wT + chevBorderL * wL + max(chevBorderB, railB) * wB) / max(visWeight, 0.001)) * outerEdge;
  float frameAlpha = max(outlineAlpha, clamp(barBack - fillAlpha, 0.0, 1.0));

  vec3 cueCol = (uThrottle * wT + uLift * wL + uBrake * wB) / max(visWeight, 0.001);
  // Gentle centre highlight on the chevron face so it reads cleanly at low cockpit angles.
  cueCol *= mix(0.95, 1.14, 1.0 - au);
  vec3 col = mix(uBorder, cueCol * uGain, fillAlpha / max(fillAlpha + frameAlpha, 0.001));

  // Smooth fade at the car's nose and at the far horizon of the ribbon.
  float fadeNear = smoothstep(0.0, 5.0, vAhead);
  float fadeFar = 1.0 - smoothstep(uLength * 0.78, uLength, vAhead);
  float baseOpacity = (0.78 * wT + 0.90 * wL + 0.95 * wB) / max(visWeight, 0.001);
  float alpha = clamp((fillAlpha + frameAlpha * 0.88) * baseOpacity * visWeight * fadeNear * fadeFar, 0.0, 0.96);
  if (alpha < 0.004) discard;

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * One-draw-call on-track driving-line ribbon. Updates its sliding window ahead of the car in
 * place every frame with zero heap allocations. World-locked chevron coordinates keep the
 * pattern anchored to the asphalt while cue colours respond live to the car's current speed.
 */
export class DrivingLineRibbon {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly track: Track;
  private readonly offsets: ArrayLike<number>;
  private readonly from: number;
  private readonly length: number;
  private readonly step: number;
  private readonly halfWidth: number;
  private readonly lift: number;
  private readonly count: number;
  private readonly cues: Uint8Array;
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly cueAttr: Float32Array;
  private readonly aheadAttr: Float32Array;
  private readonly posBuffer: BufferAttribute;
  private readonly uvBuffer: BufferAttribute;
  private readonly cueBuffer: BufferAttribute;
  private readonly pLeft = { x: 0, y: 0, z: 0 };
  private readonly pRight = { x: 0, y: 0, z: 0 };
  private readonly hint = { index: -1 };
  private readonly proj = { s: 0, d: 0, index: -1 };
  private readonly state: DrivingLineState = {
    mode: 'off',
    visible: false,
    throttleCount: 0,
    liftCount: 0,
    brakeCount: 0,
    firstBrakeDistance: null,
  };
  private modeValue: DrivingLineMode = 'off';
  private source: DrivingLineSource | null = null;
  private disposed = false;

  constructor(track: Track, offsets: ArrayLike<number>, options: DrivingLineRibbonOptions = {}) {
    this.track = track;
    this.offsets = offsets;
    this.from = options.from ?? DEFAULT_FROM;
    this.length = options.length ?? DEFAULT_LENGTH;
    this.step = options.step ?? DEFAULT_STEP;
    this.halfWidth = options.halfWidth ?? DEFAULT_HALF_WIDTH;
    this.lift = options.lift ?? DEFAULT_LIFT;
    this.count = Math.max(2, Math.floor(this.length / this.step) + 1);
    this.cues = new Uint8Array(this.count);

    const verts = this.count * 2;
    this.positions = new Float32Array(verts * 3);
    this.uvs = new Float32Array(verts * 2);
    this.cueAttr = new Float32Array(verts * 3);
    this.aheadAttr = new Float32Array(verts);
    for (let k = 0; k < this.count; k++) {
      const ahead = k * this.step;
      this.uvs[k * 4] = -1;
      this.uvs[k * 4 + 2] = 1;
      this.aheadAttr[k * 2] = ahead;
      this.aheadAttr[k * 2 + 1] = ahead;
    }

    const indices = new Uint16Array((this.count - 1) * 6);
    for (let k = 0; k < this.count - 1; k++) {
      const a = k * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const o = k * 6;
      // +Y upward winding: left = a/c, right = b/d, forward = a->c.
      indices[o] = a;
      indices[o + 1] = b;
      indices[o + 2] = c;
      indices[o + 3] = b;
      indices[o + 4] = d;
      indices[o + 5] = c;
    }

    const geometry = new BufferGeometry();
    this.posBuffer = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    this.uvBuffer = new BufferAttribute(this.uvs, 2).setUsage(DynamicDrawUsage);
    this.cueBuffer = new BufferAttribute(this.cueAttr, 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.posBuffer);
    geometry.setAttribute('uv', this.uvBuffer);
    geometry.setAttribute('aCue', this.cueBuffer);
    geometry.setAttribute('aAhead', new BufferAttribute(this.aheadAttr, 1));
    geometry.setIndex(new BufferAttribute(indices, 1));

    const material = new ShaderMaterial({
      name: 'driving-line',
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uThrottle: { value: COLOR_THROTTLE.clone() },
        uLift: { value: COLOR_LIFT.clone() },
        uBrake: { value: COLOR_BRAKE.clone() },
        uBorder: { value: COLOR_BORDER.clone() },
        uFull: { value: 0 },
        uLength: { value: this.length },
        uGain: { value: 1.2 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'driving-line';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 1;
  }

  get mode(): DrivingLineMode {
    return this.modeValue;
  }

  setMode(mode: DrivingLineMode): void {
    this.modeValue = mode;
    this.state.mode = mode;
    this.mesh.material.uniforms.uFull!.value = mode === 'full' ? 1 : 0;
    if (mode === 'off' || this.source === null) {
      this.mesh.visible = false;
      this.state.visible = false;
    }
  }

  setSource(source: DrivingLineSource | null): void {
    this.source = source;
    if (source === null || this.modeValue === 'off') {
      this.mesh.visible = false;
      this.state.visible = false;
    }
  }

  /** Latest state summary for telemetry/tests (reused object; copy if storing). */
  snapshot(): Readonly<DrivingLineState> {
    return this.state;
  }

  /**
   * Re-position and re-colour the ribbon ahead of a car at world `(x, z)` travelling at `speed`
   * m/s. `exposure` compensates the unlit colours so they stay readable under any time of day or
   * cockpit exposure shift.
   */
  update(x: number, z: number, speed: number, exposure = 1): void {
    if (this.disposed) return;
    if (this.modeValue === 'off' || this.source === null) {
      this.mesh.visible = false;
      this.state.visible = false;
      this.state.throttleCount = 0;
      this.state.liftCount = 0;
      this.state.brakeCount = 0;
      this.state.firstBrakeDistance = null;
      return;
    }

    const q = this.track.project(x, z, this.hint, this.proj);
    const carS = q.s;
    const cues = this.source.fill(carS, Math.max(0, speed), this.from, this.step, this.cues);

    let throttleCount = 0;
    let liftCount = 0;
    let brakeCount = 0;
    let firstBrake: number | null = null;

    const track = this.track;
    const pos = this.positions;
    const uvs = this.uvs;
    const ca = this.cueAttr;
    const pL = this.pLeft;
    const pR = this.pRight;
    const hw = this.halfWidth;
    const lift = this.lift;

    for (let k = 0; k < this.count; k++) {
      const distAhead = this.from + k * this.step;
      const worldS = carS + distAhead;
      const sw = track.wrap(worldS);
      const d = this.offsetAt(sw);
      track.pointAt(sw, d + hw, pL);
      track.pointAt(sw, d - hw, pR);

      const po = k * 6;
      pos[po] = pL.x;
      pos[po + 1] = pL.y + lift;
      pos[po + 2] = pL.z;
      pos[po + 3] = pR.x;
      pos[po + 4] = pR.y + lift;
      pos[po + 5] = pR.z;

      // World-locked v coordinate (metres along track) keeps chevrons fixed to the asphalt.
      const uo = k * 4;
      uvs[uo + 1] = worldS;
      uvs[uo + 3] = worldS;

      const cue = cues[k]!;
      let wT = 0;
      let wL = 0;
      let wB = 0;
      if (cue === DRIVING_LINE_CUE.Brake) {
        wB = 1;
        brakeCount++;
        if (firstBrake === null) firstBrake = distAhead;
      } else if (cue === DRIVING_LINE_CUE.Lift) {
        wL = 1;
        liftCount++;
      } else {
        wT = 1;
        throttleCount++;
      }
      ca[po] = wT;
      ca[po + 1] = wL;
      ca[po + 2] = wB;
      ca[po + 3] = wT;
      ca[po + 4] = wL;
      ca[po + 5] = wB;
    }

    const visible = this.modeValue === 'full' || liftCount > 0 || brakeCount > 0;
    this.mesh.visible = visible;
    this.state.mode = this.modeValue;
    this.state.visible = visible;
    this.state.throttleCount = throttleCount;
    this.state.liftCount = liftCount;
    this.state.brakeCount = brakeCount;
    this.state.firstBrakeDistance = firstBrake;

    if (!visible) return;

    // Normalize unlit linear brightness against scene exposure (cockpit adds +0.4 EV, night 1.6).
    const safeExp = Math.max(0.25, exposure);
    this.mesh.material.uniforms.uGain!.value = 0.95 / safeExp;
    this.posBuffer.needsUpdate = true;
    this.uvBuffer.needsUpdate = true;
    this.cueBuffer.needsUpdate = true;
  }

  /** Linearly interpolated racing-line offset at wrapped `s`, m. */
  private offsetAt(sw: number): number {
    const n = this.offsets.length;
    if (n === 0) return 0;
    const u = sw / this.track.lap.step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    return (this.offsets[i] ?? 0) + ((this.offsets[j] ?? 0) - (this.offsets[i] ?? 0)) * f;
  }

  /** World point of the centre of sample `k` (unit tests). */
  sampleCenter(k: number, out = new Vector3()): Vector3 {
    const o = k * 6;
    return out.set(
      (this.positions[o]! + this.positions[o + 3]!) * 0.5,
      (this.positions[o + 1]! + this.positions[o + 4]!) * 0.5,
      (this.positions[o + 2]! + this.positions[o + 5]!) * 0.5,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
