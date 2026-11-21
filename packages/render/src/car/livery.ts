import type { Material } from 'three';
import {
  CanvasTexture,
  Color,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  Vector3,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import type { CarLivery } from './car-assets';

/** Carbon where the livery mask's B channel says bare carbon (docs/car-asset.md). */
export const CARBON = '#141518';

/**
 * A tyre compound as `design/compounds.json` describes it: its colour and the tick slots it
 * lights in each group on the sidewall, with the sidewall layout (groups per sidewall, slot
 * spacing in TEXCOORD_1 u).
 */
export interface CompoundLook {
  colour: string;
  slots: readonly number[];
  groupsPerSidewall: number;
  slotSpacingU: number;
}

/** Medium (two outer ticks, orange) as in design/compounds.json, for when none is given. */
export const MEDIUM_COMPOUND: CompoundLook = Object.freeze({
  colour: '#F2902F',
  slots: [-1, 1],
  groupsPerSidewall: 4,
  slotSpacingU: 0.012,
});

/**
 * Sidewall shading for a compound: the bright texels of the tyre texture are markings; in each
 * group of three tick slots the compound's slots are lit in its colour, the others stay rubber,
 * and the maker's lettering stays neutral grey. Needs uniforms uCompound, uLit, uGroups, uSlot.
 */
export const COMPOUND_GLSL = /* glsl */ `
#ifdef USE_MAP
{
  float marking = smoothstep(0.05, 0.35, diffuseColor.r);
  float f = fract(vMapUv.x * uGroups) - 0.5;
  float slotIndex = f / (uSlot * uGroups);
  float isTick = step(abs(f), 1.6 * uSlot * uGroups);
  float k = clamp(floor(slotIndex + 0.5), -1.0, 1.0);
  float lit = k < -0.5 ? uLit.x : (k > 0.5 ? uLit.z : uLit.y);
  vec3 rubber = vec3(0.016);
  vec3 tickCol = mix(rubber, uCompound * 0.85, lit);
  diffuseColor.rgb = mix(rubber, mix(vec3(0.55), tickCol, isTick), marking);
}
#endif`;

export const COMPOUND_PARS = /* glsl */ `
uniform vec3 uCompound;
uniform vec3 uLit;
uniform float uGroups;
uniform float uSlot;`;

/** Uniforms for COMPOUND_GLSL. */
export function compoundUniforms(c: CompoundLook): Record<string, { value: unknown }> {
  const lit = [-1, 0, 1].map((k) => (c.slots.includes(k) ? 1 : 0));
  return {
    uCompound: { value: new Color(c.colour) },
    uLit: { value: new Vector3(lit[0], lit[1], lit[2]) },
    uGroups: { value: c.groupsPerSidewall },
    uSlot: { value: c.slotSpacingU },
  };
}

/** Shader fragment that turns the mask in `map` into paint (shared by single and fleet cars). */
export const LIVERY_GLSL = /* glsl */ `
  vec3 liv = LIVERY_SAMPLE;
  liveryCarbon = liv.b;
  vec3 paint = uPrimary * max(0.0, 1.0 - liv.r - liv.g) + uSecondary * liv.r + uAccent * liv.g;
  diffuseColor.rgb = mix(paint, uCarbon, liveryCarbon);`;

/**
 * The painted bodywork recoloured from a livery mask (R secondary, G accent, B bare carbon) and
 * the team's three colours. One clone per car, shared by every painted mesh of that car.
 */
export function liveryMaterial(
  base: MeshStandardMaterial,
  mask: Texture,
  livery: CarLivery,
): MeshStandardMaterial {
  const m = base.clone();
  m.map = mask;
  m.color.set(0xffffff);
  const uniforms = {
    uPrimary: { value: new Color(livery.primary) },
    uSecondary: { value: new Color(livery.secondary) },
    uAccent: { value: new Color(livery.accent) },
    uCarbon: { value: new Color(CARBON) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uPrimary;\nuniform vec3 uSecondary;\nuniform vec3 uAccent;\nuniform vec3 uCarbon;',
      )
      .replace(
        '#include <map_fragment>',
        `float liveryCarbon = 0.0;
        #ifdef USE_MAP
        ${LIVERY_GLSL.replace('LIVERY_SAMPLE', 'texture2D(map, vMapUv).rgb')}
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, liveryCarbon);',
      );
  };
  m.customProgramCacheKey = () => 'car-livery';
  m.userData.livery = uniforms;
  return m;
}

/**
 * Draw one car's markings into a canvas cell laid out like the decal mesh's UVs
 * (docs/car-asset.md): the race number centred in u 0–0.4, the driver code in u 0.4–1, on
 * transparent, light or dark against the primary colour.
 */
export function drawMarkings(
  ctx: CanvasRenderingContext2D,
  livery: Pick<CarLivery, 'number' | 'code' | 'primary'>,
  x: number,
  y: number,
  w: number,
  h: number,
  split = 0.4,
): void {
  const c = new Color(livery.primary);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const fill = lum > 0.35 ? '#15161a' : '#f2f0eb';
  const outline = lum > 0.35 ? 'rgba(242,240,235,0.85)' : 'rgba(21,22,26,0.85)';
  ctx.clearRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const draw = (text: string, x0: number, x1: number, size: number): void => {
    ctx.font = `700 ${Math.round(size)}px "Barlow Semi Condensed", Archivo, sans-serif`;
    ctx.lineWidth = h * 0.06;
    ctx.strokeStyle = outline;
    ctx.strokeText(text, (x0 + x1) / 2, y + h * 0.54);
    ctx.fillStyle = fill;
    ctx.fillText(text, (x0 + x1) / 2, y + h * 0.54);
  };
  draw(String(livery.number), x, x + w * split, h * 0.86);
  draw(livery.code, x + w * split, x + w, h * 0.78);
  ctx.restore();
}

/** One car's markings canvas texture for its decal mesh (size from the node's extras). */
export function markingsTexture(
  livery: Pick<CarLivery, 'number' | 'code' | 'primary'>,
  size: readonly [number, number],
  split: number,
  anisotropy: number,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size[0];
  canvas.height = size[1];
  const ctx = canvas.getContext('2d');
  if (ctx) drawMarkings(ctx, livery, 0, 0, size[0], size[1], split);
  const t = new CanvasTexture(canvas);
  t.flipY = false;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/** Decal carrier material: transparent, pulled toward the camera so it never fights the paint. */
export function decalMaterial(map: Texture, clearcoat: boolean): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    map,
    transparent: true,
    roughness: 0.32,
    clearcoat: clearcoat ? 1 : 0,
    clearcoatRoughness: 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
}

/** Sidewall ticks in the compound's pattern and colour; the rubber stays rubber. */
export function compoundMaterial(
  base: MeshStandardMaterial,
  compound: CompoundLook,
): MeshStandardMaterial {
  const m = base.clone();
  const uniforms = compoundUniforms(compound);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMPOUND_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${COMPOUND_GLSL}`);
  };
  m.customProgramCacheKey = () => 'car-tyre';
  m.userData.compound = uniforms;
  return m;
}

const REV_COLOURS = ['#38d07a', '#e5484d', '#4f7dff'] as const;

/** The steering wheel's screen: a canvas redrawn when its values change, shown as emissive. */
export class Dashboard {
  shown: { gear: string; speed: string; revs: number } | null = null;
  readonly texture: CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 256;
    this.canvas.height = 160;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.flipY = false;
    this.draw(0, 0, 0);
  }

  /** Put the screen on a `display` material (UV1, docs/car-asset.md). */
  apply(material: Material): void {
    if (material instanceof MeshBasicMaterial) {
      material.map = this.texture;
      return;
    }
    const m = material as MeshStandardMaterial;
    this.texture.channel = 1;
    m.emissiveMap = this.texture;
    m.emissive.set(0xffffff);
    m.emissiveIntensity = 1.6;
    m.color.set('#050506');
    m.roughness = 0.25;
    m.metalness = 0;
    m.needsUpdate = true;
  }

  draw(gear: number, speedKmh: number, revLights: number): void {
    const g = gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
    const v = String(Math.max(0, Math.round(speedKmh)));
    const revs = Math.max(0, Math.min(16, Math.round(revLights)));
    const s = this.shown;
    if (s && s.gear === g && s.speed === v && s.revs === revs) return;
    this.shown = { gear: g, speed: v, revs };
    const c = this.ctx;
    if (!c) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.fillStyle = '#07080a';
    c.fillRect(0, 0, W, H);
    const seg = (W - 24) / 15;
    for (let i = 0; i < 15; i++) {
      const on = revs > 15 || i < revs;
      c.fillStyle = on
        ? revs > 15
          ? REV_COLOURS[2]
          : (REV_COLOURS[Math.floor(i / 5)] ?? REV_COLOURS[0])
        : '#1c1f24';
      c.fillRect(12 + i * seg + 1, 10, seg - 3, 16);
    }
    c.fillStyle = '#f2f0eb';
    c.textBaseline = 'alphabetic';
    c.textAlign = 'center';
    c.font = '700 96px "Barlow Semi Condensed", Archivo, sans-serif';
    c.fillText(g, W / 2, 132);
    c.textAlign = 'left';
    c.font = '600 40px "Barlow Semi Condensed", Archivo, sans-serif';
    c.fillText(v, 14, 132);
    c.fillStyle = '#7d7c78';
    c.font = '600 18px Archivo, sans-serif';
    c.fillText('KM/H', 14, 152);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
