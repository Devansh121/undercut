import {
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  NoBlending,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  UnsignedIntType,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Quality } from '../quality';

/** Tone maps the pipeline can end in. Khronos PBR Neutral is the default (docs/render.md). */
export type ToneMap = 'agx' | 'aces' | 'neutral';

/** Per-frame grading inputs. */
export interface GradeFrame {
  /** Exposure multiplier on the linear scene before the tone map. */
  exposure: number;
  /** 0..1: how much edge blur the current speed asks for. */
  speedBlur: number;
  /** Seconds, for the grain pattern. */
  time: number;
}

const FINAL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * Final pass: ambient occlusion applied, exposure, the filmic tone map, a radial blur at the frame
 * edge that grows with speed, a lens vignette, film grain (also dithers away banding), and the
 * sRGB transfer. Output is display-referred sRGB, ready for SMAA or the screen.
 */
const FINAL_FRAGMENT = /* glsl */ `
#include <common>
#include <tonemapping_pars_fragment>
uniform sampler2D tScene;
uniform sampler2D tAo;
uniform float aoIntensity;
uniform float speedBlur;
uniform float vignette;
uniform float grain;
uniform float time;
uniform vec2 resolution;
varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  #ifdef USE_SPEED_BLUR
  {
    // Radial streak toward the centre, zero in the middle 55 % of the frame.
    vec2 d = vUv - 0.5;
    float edge = smoothstep(0.28, 0.62, length(d * vec2(resolution.x / resolution.y, 1.0) * 0.72));
    float amount = speedBlur * edge * 0.045;
    if (amount > 0.0005) {
      vec3 acc = col;
      for (int i = 1; i < 6; i++) acc += texture2D(tScene, vUv - d * amount * float(i) / 5.0).rgb;
      col = acc / 6.0;
    }
  }
  #endif
  #ifdef USE_AO
  {
    float ao = texture2D(tAo, vUv).r;
    col *= mix(1.0, ao, aoIntensity);
  }
  #endif
  #if defined(TM_AGX)
  col = AgXToneMapping(col);
  #elif defined(TM_ACES)
  col = ACESFilmicToneMapping(col);
  #else
  col = NeutralToneMapping(col);
  #endif
  #ifdef USE_GRADE
  {
    vec2 d = (vUv - 0.5) * vec2(resolution.x / resolution.y, 1.0);
    float v = 1.0 - vignette * smoothstep(0.35, 1.05, dot(d, d) * 1.6);
    col *= v;
  }
  #endif
  col = srgb(col);
  // Grain doubles as dither: about one 8-bit step, more in the shadows.
  float n = hash12(gl_FragCoord.xy + fract(time * 7.13) * 117.0) + hash12(gl_FragCoord.yx * 1.37 + fract(time * 3.7) * 71.0) - 1.0;
  col += n * (1.0 / 255.0 + grain * (1.0 - col));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The render pipeline. With `quality.post` the scene renders into a half-float target with MSAA,
 * then optional GTAO (half resolution, normals reconstructed from the resolved depth, so the scene
 * is drawn once), bloom (only above a threshold in scene-linear units), the final pass and SMAA.
 * Without it (Lite, software WebGL in CI) the scene renders straight to the canvas through the
 * renderer's own tone map: every post effect has that as its fallback.
 */
export class RenderPipeline {
  readonly toneMap: ToneMap;
  private readonly renderer: WebGLRenderer;
  private readonly quality: Quality;
  private hdr: WebGLRenderTarget | null = null;
  private ldr: WebGLRenderTarget | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private smaa: SMAAPass | null = null;
  private final: ShaderMaterial | null = null;
  private quad: FullScreenQuad | null = null;
  private width = 1;
  private height = 1;
  private readonly bloomThreshold: number;

  constructor(
    renderer: WebGLRenderer,
    quality: Quality,
    scene: Scene,
    camera: Camera,
    toneMap: ToneMap,
  ) {
    this.renderer = renderer;
    this.quality = quality;
    this.toneMap = toneMap;
    this.bloomThreshold = quality.bloom.threshold;
    if (!quality.post) return;
    const depthTexture = new DepthTexture(1, 1, UnsignedIntType);
    this.hdr = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      samples: quality.msaa,
      depthBuffer: true,
      depthTexture,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    });
    if (quality.ao.enabled) {
      this.gtao = new GTAOPass(scene, camera, 1, 1, { depthTexture });
      this.gtao.output = GTAOPass.OUTPUT.Off;
      this.gtao.updateGtaoMaterial({
        radius: 0.6,
        distanceExponent: 1.4,
        thickness: 1.2,
        scale: 1,
        samples: 12,
      });
      this.gtao.updatePdMaterial({
        lumaPhi: 10,
        depthPhi: 2,
        normalPhi: 3,
        radius: 6,
        rings: 2,
        samples: 12,
      });
    }
    if (quality.bloom.enabled) {
      this.bloom = new UnrealBloomPass(
        new Vector2(1, 1),
        quality.bloom.strength,
        0.55,
        this.bloomThreshold,
      );
    }
    this.final = new ShaderMaterial({
      name: 'FinalPass',
      vertexShader: FINAL_VERTEX,
      fragmentShader: FINAL_FRAGMENT,
      uniforms: {
        tScene: { value: this.hdr.texture },
        tAo: { value: this.gtao ? this.gtao.pdRenderTarget.texture : null },
        aoIntensity: { value: quality.ao.intensity },
        toneMappingExposure: { value: 1 },
        speedBlur: { value: 0 },
        vignette: { value: 0.22 },
        grain: { value: quality.grainVignette ? 0.012 : 0 },
        time: { value: 0 },
        resolution: { value: new Vector2(1, 1) },
      },
      defines: {
        [toneMap === 'agx' ? 'TM_AGX' : toneMap === 'aces' ? 'TM_ACES' : 'TM_NEUTRAL']: '',
        ...(this.gtao ? { USE_AO: '' } : {}),
        ...(quality.speedBlur ? { USE_SPEED_BLUR: '' } : {}),
        ...(quality.grainVignette ? { USE_GRADE: '' } : {}),
      },
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.final);
    if (quality.smaa) {
      this.ldr = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, depthBuffer: false });
      this.smaa = new SMAAPass();
      this.smaa.renderToScreen = true;
    }
  }

  /** Drawing-buffer size in pixels. */
  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    const w = this.width;
    const h = this.height;
    this.hdr?.setSize(w, h);
    this.ldr?.setSize(w, h);
    if (this.gtao)
      this.gtao.setSize(Math.ceil(w * this.quality.ao.scale), Math.ceil(h * this.quality.ao.scale));
    if (this.bloom) this.bloom.setSize(w, h);
    this.smaa?.setSize(w, h);
    if (this.final) (this.final.uniforms.resolution as { value: Vector2 }).value.set(w, h);
  }

  render(scene: Scene, camera: Camera, grade: GradeFrame): void {
    const r = this.renderer;
    if (!this.hdr || !this.final || !this.quad) {
      r.toneMappingExposure = grade.exposure;
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.hdr);
    r.clear();
    r.render(scene, camera);
    if (this.gtao) this.gtao.render(r, this.hdr, this.hdr, 0, false);
    if (this.bloom) {
      // Threshold in scene-linear units, so the same things bloom at any exposure.
      this.bloom.threshold = this.bloomThreshold / Math.max(1e-3, grade.exposure);
      this.bloom.render(r, this.hdr, this.hdr, 0, false);
    }
    const u = this.final.uniforms;
    (u.toneMappingExposure as { value: number }).value = grade.exposure;
    (u.speedBlur as { value: number }).value = this.quality.speedBlur ? grade.speedBlur : 0;
    (u.time as { value: number }).value = grade.time;
    r.toneMappingExposure = grade.exposure;
    if (this.smaa && this.ldr) {
      r.setRenderTarget(this.ldr);
      this.quad.render(r);
      this.smaa.render(r, null as unknown as WebGLRenderTarget, this.ldr, 0, false);
    } else {
      r.setRenderTarget(null);
      this.quad.render(r);
    }
  }

  dispose(): void {
    this.hdr?.depthTexture?.dispose();
    this.hdr?.dispose();
    this.ldr?.dispose();
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.smaa?.dispose();
    this.final?.dispose();
    this.quad?.dispose();
  }
}
