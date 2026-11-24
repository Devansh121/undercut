import {
  BufferAttribute,
  BufferGeometry,
  Color,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import worldProps from '../../data/world-props.json';
import type { AssetLoader } from '../assets/loader';
import type { Quality } from '../quality';
import type { PropLod } from './registry';

/** One LOD entry inside `packages/render/data/props.catalog.json`. */
export interface PropCatalogLod {
  file: string;
  maxDistance: number;
  triangleBudget?: number;
  triangles?: number;
  bytes?: number;
}

/** Named attachment marker inside a catalogue entry (e.g. `board-face`, `team-board`). */
export interface PropCatalogAttachment {
  name: string;
  position: readonly [number, number, number];
  size?: readonly [number, number];
  uv?: readonly [number, number, number, number];
  /** Material slot the marker belongs to (lamp emitters, window masks). */
  material?: string;
  /** Aim of a lamp, local frame. */
  direction?: readonly [number, number, number];
  /** A row of markers (stand seats): along `axis` from `position`, `count` at `spacing` m. */
  axis?: readonly [number, number, number];
  spacing?: number;
  count?: number;
}

/** One modular prop entry in `packages/render/data/props.catalog.json`. */
export interface PropCatalogEntry {
  id: string;
  pivot: readonly [number, number, number];
  tiles: boolean;
  moduleLength: number;
  tileAxis: string;
  lods: readonly PropCatalogLod[];
  bounds?: {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
  };
  attachments?: readonly PropCatalogAttachment[];
  materials?: readonly string[];
}

/** Schema of `packages/render/data/props.catalog.json`. */
export interface PropCatalog {
  version: number;
  units: string;
  up: string;
  front: string;
  pivot: string;
  props: readonly PropCatalogEntry[];
  totalBytes?: number;
}

/**
 * Prop ids from `props.catalog.json` that `CircuitWorld` places (packages/render/data/
 * world-props.json, also read by the budget check): only these are fetched on load.
 */
export const WORLD_CATALOG_PROP_IDS: readonly string[] = Object.freeze([...worldProps.ids]);

interface CircuitProps {
  ids?: readonly string[];
  nearTrees?: readonly string[];
}
const CIRCUIT_PROPS: Readonly<Record<string, CircuitProps>> = worldProps.circuits;

/**
 * The catalogue ids one circuit's world places on a preset: the common ones, the circuit's own,
 * and its near-tree models where the preset draws near trees as geometry.
 */
export function worldCatalogPropIds(
  circuit: string,
  quality: { world: { treeCloud: number } },
): string[] {
  const own = CIRCUIT_PROPS[circuit] ?? {};
  return [
    ...WORLD_CATALOG_PROP_IDS,
    ...(own.ids ?? []),
    ...(quality.world.treeCloud > 0 ? (own.nearTrees ?? []) : []),
  ];
}

/** Material names that receive per-instance colour tinting by default (team colours / crowd clothes). */
const DEFAULT_TINTABLE_SLOTS = new Set(['clothing', 'paint-band', 'seat', 'team-tint']);

/**
 * Mean sRGB values (0..255) for the 8 tiny procedural swatch textures embedded in the prop-kit
 * GLBs, used as a fallback when sampling textures without a 2D canvas (e.g. headless unit tests).
 */
const SWATCH_FALLBACK_SRGB: Record<string, readonly [number, number, number]> = {
  'dark-steel': [65, 69, 73],
  'paint-band': [80, 129, 165],
  rubber: [52, 53, 58],
  galvanised: [157, 163, 168],
  'galvanised-rail': [161, 167, 172],
  concrete: [156, 155, 149],
  clothing: [190, 194, 197],
  'dark-fabric': [44, 49, 59],
};

/** Runtime guard for a decoded `props.catalog.json` payload. */
export function isPropCatalog(x: unknown): x is PropCatalog {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.version !== 'number' || !Array.isArray(o.props)) return false;
  return o.props.every((p) => {
    if (!p || typeof p !== 'object') return false;
    const e = p as Record<string, unknown>;
    return typeof e.id === 'string' && Array.isArray(e.lods);
  });
}

/** Convert a catalogue file path (`assets/props/...`) to a path relative to `AssetLoader.base`. */
export function catalogAssetPath(file: string): string {
  return file.replace(/^assets\//, '');
}

/**
 * A circuit's near-tree models (world-props.json `circuits.<id>.nearTrees`): drawn only inside the
 * near-tree swap distance, where the cards take over, so their far level is never fetched.
 */
export function nearTreePropIds(circuit: string): ReadonlySet<string> {
  return new Set(CIRCUIT_PROPS[circuit]?.nearTrees ?? []);
}

/**
 * Pick the LODs to fetch for a given quality preset (drops `_high.glb` on mobile/lite, and
 * `_far.glb` when `withoutFar`).
 */
export function selectCatalogLods(
  entry: PropCatalogEntry,
  quality: Pick<Quality, 'name'>,
  withoutFar = false,
): PropCatalogLod[] {
  const sorted = [...entry.lods]
    .sort((a, b) => a.maxDistance - b.maxDistance)
    .filter((l) => !withoutFar || !/_far\.glb$/i.test(l.file));
  if (quality.name === 'mobile' || quality.name === 'lite') {
    const light = sorted.filter((l) => !/_high\.glb$/i.test(l.file));
    if (light.length > 0) return light;
  }
  return sorted;
}

interface SlotGeometry {
  name: string;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  color: [number, number, number];
  roughness: number;
  metalness: number;
}

interface BuiltPropLod {
  slots: SlotGeometry[];
  maxDistance: number;
}

let swatchCtx: CanvasRenderingContext2D | null | undefined;
const tmpColor = new Color();

/** Sample the mean linear RGB of a GLTF material (base colour × mean swatch texture colour). */
function sampleMaterialLinearColor(mat: Material): [number, number, number] {
  const std = mat as MeshStandardMaterial;
  const baseR = std.color ? std.color.r : 1;
  const baseG = std.color ? std.color.g : 1;
  const baseB = std.color ? std.color.b : 1;

  const map = std.map;
  if (map && map.image) {
    if (swatchCtx === undefined) {
      if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = 4;
        c.height = 4;
        swatchCtx = c.getContext('2d', { willReadFrequently: true });
      } else {
        swatchCtx = null;
      }
    }
    if (swatchCtx) {
      try {
        swatchCtx.clearRect(0, 0, 4, 4);
        swatchCtx.drawImage(map.image as CanvasImageSource, 0, 0, 4, 4);
        const data = swatchCtx.getImageData(0, 0, 4, 4).data;
        let r = 0;
        let g = 0;
        let b = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          tmpColor.setRGB(
            (data[i] as number) / 255,
            (data[i + 1] as number) / 255,
            (data[i + 2] as number) / 255,
            SRGBColorSpace,
          );
          r += tmpColor.r;
          g += tmpColor.g;
          b += tmpColor.b;
        }
        return [(r / n) * baseR, (g / n) * baseG, (b / n) * baseB];
      } catch {
        // Fall through to precomputed table.
      }
    }
    const fb = SWATCH_FALLBACK_SRGB[mat.name];
    if (fb) {
      tmpColor.setRGB(fb[0] / 255, fb[1] / 255, fb[2] / 255, SRGBColorSpace);
      return [tmpColor.r * baseR, tmpColor.g * baseG, tmpColor.b * baseB];
    }
  }
  return [baseR, baseG, baseB];
}

/**
 * Unified single-draw-call PBR material for collapsed prop-kit geometry: carries per-vertex linear
 * albedo (`color`), roughness/metalness/tintMask (`aPropPbr`), subtle world-space micro-grain, and
 * optional gentle idle sway for spectators.
 */
export function createPropKitMaterial(
  options: {
    swayTime?: { value: number };
    key?: string;
    /**
     * World-space colour and roughness grain (default on). Off for levels only drawn far away,
     * where the 7 cm grain is below a pixel and its two hashes a fragment are pure cost.
     */
    grain?: boolean;
  } = {},
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 1,
  });
  m.name = options.key ?? 'prop-kit-unified';
  const sway = options.swayTime;
  const grain = options.grain ?? true;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    if (sway) shader.uniforms.uCrowdTime = sway;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aPropPbr;
        varying vec2 vPropRM;
        varying vec3 vPropWorld;
        ${sway ? 'uniform float uCrowdTime;' : ''}`,
      )
      .replace(
        '#include <color_vertex>',
        `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
          vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR_ALPHA
          vColor *= color;
        #elif defined( USE_COLOR )
          vColor.rgb *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix( vColor.rgb, vColor.rgb * instanceColor.rgb, aPropPbr.z );
        #endif
        vPropRM = aPropPbr.xy;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${
          sway
            ? `#ifdef USE_INSTANCING
        {
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float ph = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
          float upper = smoothstep(0.15, 0.75, position.y);
          transformed.z += sin(uCrowdTime * (0.65 + ph) + ph * 40.0) * 0.035 * upper;
          transformed.x += sin(uCrowdTime * (0.45 + ph * 0.5) + ph * 17.0) * 0.025 * upper;
        }
        #endif`
            : ''
        }`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wpProp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wpProp = instanceMatrix * wpProp;
          #endif
          wpProp = modelMatrix * wpProp;
          vPropWorld = wpProp.xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPropRM;
        varying vec3 vPropWorld;
        // Arithmetic hash of the 7 cm cell (no sin: its range reduction on large world
        // coordinates made the grain the dearest part of every kit fragment).
        float propGrain(vec3 p) {
          vec3 q = fract(floor(p * 14.0) * vec3(0.1031, 0.1030, 0.0973));
          q += dot(q, q.yzx + 33.33);
          return fract((q.x + q.y) * q.z) - 0.5;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        grain
          ? `#include <color_fragment>
        {
          float g = propGrain(vPropWorld);
          diffuseColor.rgb *= 1.0 + g * 0.055 * (1.0 - vPropRM.y * 0.5);
        }`
          : '#include <color_fragment>',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(vPropRM.x${grain ? ' + propGrain(vPropWorld * 0.5) * 0.04' : ''}, 0.06, 1.0);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = clamp(vPropRM.y, 0.0, 1.0);`,
      );
  };
  m.customProgramCacheKey = () =>
    `prop-kit-unified-v1-${sway ? 'sway' : 'static'}${grain ? '' : '-smooth'}`;
  return m;
}

/**
 * Extract a GLTF scene into per-material-slot vertex arrays, bake each embedded swatch colour
 * into the slot metadata, and immediately dispose temporary GLTF geometries, materials and
 * duplicate textures so zero redundant textures stay resident on the GPU.
 */
export function mergeSceneToPropLod(
  root: Object3D,
  maxDistance: number,
  _anisotropy: number,
): BuiltPropLod | null {
  root.updateMatrixWorld(true);
  const byMat = new Map<Material, BufferGeometry[]>();
  const sourceGeos = new Set<BufferGeometry>();
  const sourceMats = new Set<Material>();

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const src = mesh.geometry;
    sourceGeos.add(src);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m) sourceMats.add(m);
    const groups =
      src.groups.length > 0
        ? src.groups
        : [
            {
              start: 0,
              count: src.index ? src.index.count : src.attributes.position!.count,
              materialIndex: 0,
            },
          ];

    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] ?? mats[0];
      if (!mat) continue;
      const g = extractGroupNonIndexed(src, grp.start, grp.count);
      if (!g) continue;
      g.applyMatrix4(mesh.matrixWorld);
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(g);
    }
  });

  if (byMat.size === 0) return null;

  const slots: SlotGeometry[] = [];
  for (const [mat, geos] of byMat) {
    let totalVerts = 0;
    for (const g of geos) totalVerts += g.getAttribute('position').count;
    const pos = new Float32Array(totalVerts * 3);
    const nor = new Float32Array(totalVerts * 3);
    const uv = new Float32Array(totalVerts * 2);
    let offset = 0;
    for (const g of geos) {
      const pAttr = g.getAttribute('position');
      const nAttr = g.getAttribute('normal');
      const uAttr = g.getAttribute('uv');
      const count = pAttr.count;
      for (let i = 0; i < count; i++) {
        const k3 = (offset + i) * 3;
        const k2 = (offset + i) * 2;
        pos[k3] = pAttr.getX(i);
        pos[k3 + 1] = pAttr.getY(i);
        pos[k3 + 2] = pAttr.getZ(i);
        if (nAttr) {
          nor[k3] = nAttr.getX(i);
          nor[k3 + 1] = nAttr.getY(i);
          nor[k3 + 2] = nAttr.getZ(i);
        } else {
          nor[k3] = 0;
          nor[k3 + 1] = 1;
          nor[k3 + 2] = 0;
        }
        if (uAttr) {
          uv[k2] = uAttr.getX(i);
          uv[k2 + 1] = uAttr.getY(i);
        }
      }
      offset += count;
      g.dispose();
    }
    const std = mat as MeshStandardMaterial;
    slots.push({
      name: mat.name,
      pos,
      nor,
      uv,
      color: sampleMaterialLinearColor(mat),
      roughness: typeof std.roughness === 'number' ? std.roughness : 0.7,
      metalness: typeof std.metalness === 'number' ? std.metalness : 0.0,
    });
  }

  // Release temporary GLTF GPU resources now that slot geometry + colours are extracted.
  for (const g of sourceGeos) g.dispose();
  const textures = new Set<Texture>();
  for (const m of sourceMats) {
    for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v);
    m.dispose();
  }
  for (const t of textures) t.dispose();

  return { slots, maxDistance };
}

function extractGroupNonIndexed(
  src: BufferGeometry,
  start: number,
  count: number,
): BufferGeometry | null {
  const posAttr = src.getAttribute('position');
  if (!posAttr || count <= 0) return null;
  const norAttr = src.getAttribute('normal');
  const uvAttr = src.getAttribute('uv');
  const idx = src.index;

  const pos = new Float32Array(count * 3);
  const nor = norAttr ? new Float32Array(count * 3) : null;
  const uv = uvAttr ? new Float32Array(count * 2) : null;

  for (let i = 0; i < count; i++) {
    const vi = idx ? idx.getX(start + i) : start + i;
    pos[i * 3] = posAttr.getX(vi);
    pos[i * 3 + 1] = posAttr.getY(vi);
    pos[i * 3 + 2] = posAttr.getZ(vi);
    if (nor && norAttr) {
      nor[i * 3] = norAttr.getX(vi);
      nor[i * 3 + 1] = norAttr.getY(vi);
      nor[i * 3 + 2] = norAttr.getZ(vi);
    }
    if (uv && uvAttr) {
      uv[i * 2] = uvAttr.getX(vi);
      uv[i * 2 + 1] = uvAttr.getY(vi);
    }
  }

  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  if (nor) out.setAttribute('normal', new BufferAttribute(nor, 3));
  else out.computeVertexNormals();
  if (uv) out.setAttribute('uv', new BufferAttribute(uv, 2));
  return out;
}

export interface PropLodOptions {
  /** Replace named material slots (e.g. `{ 'board-face': brandMat }`) for this prop kind. */
  materialOverrides?: Readonly<Record<string, Material>>;
  /** Optional multiplier applied to each LOD's `maxDistance`. */
  maxDistanceScale?: number;
  /** Optional per-LOD maximum distance caps (m, nearest first). */
  distanceCaps?: readonly number[];
  /** Override which material slots receive per-instance colour tinting. */
  tintSlots?: readonly string[];
  /** Override linear RGB colour for specific material slots before instance tinting. */
  slotColors?: Readonly<Record<string, readonly [number, number, number]>>;
  /** Optional replacement unified material for non-overridden slots (e.g. swaying crowd). */
  baseMaterial?: Material;
  /** Multiplier on every slot's colour (calibrating a model against what it stands in for). */
  colourScale?: number;
}

/**
 * Loaded modular prop kit backed by `packages/render/data/props.catalog.json`.
 * Each loaded prop ID exposes ready-to-register `PropLod[]` matching the ground-centre,
 * +Y up, +X front pivot contract. All non-overridden slots collapse into one shared PBR
 * material so every modelled prop draws in 1 draw call (or 2 with a custom board face) and
 * keeps zero duplicate embedded swatch textures on the GPU.
 */
export class PropKitAssets {
  readonly entries = new Map<string, PropCatalogEntry>();
  private readonly built = new Map<string, BuiltPropLod[]>();
  private readonly ownedGeometries: BufferGeometry[] = [];
  private sharedMaterial: MeshStandardMaterial | null = null;

  private constructor() {}

  private getSharedMaterial(): MeshStandardMaterial {
    if (!this.sharedMaterial) this.sharedMaterial = createPropKitMaterial();
    return this.sharedMaterial;
  }

  /** Build a kit directly from already-parsed scenes (for unit tests and offline tools). */
  static fromScenes(
    catalog: PropCatalog,
    scenes: ReadonlyMap<string, readonly { scene: Object3D; maxDistance: number }[]>,
    anisotropy = 4,
  ): PropKitAssets {
    const kit = new PropKitAssets();
    for (const entry of catalog.props) {
      kit.entries.set(entry.id, entry);
      const list = scenes.get(entry.id);
      if (!list) continue;
      const lods: BuiltPropLod[] = [];
      for (const item of list) {
        const merged = mergeSceneToPropLod(item.scene, item.maxDistance, anisotropy);
        if (merged) lods.push(merged);
      }
      if (lods.length > 0) kit.built.set(entry.id, lods);
    }
    return kit;
  }

  /** Fetch and decode the requested catalogue entries via `AssetLoader` and a single Draco decoder. */
  static async load(
    loader: AssetLoader,
    catalog: PropCatalog,
    quality: Quality,
    dracoPath: string,
    wantedIds: readonly string[] = WORLD_CATALOG_PROP_IDS,
    /** Ids loaded without their far level (`nearTreePropIds`). */
    withoutFar: ReadonlySet<string> = new Set(),
  ): Promise<PropKitAssets> {
    const kit = new PropKitAssets();
    const wanted = new Set(wantedIds);
    const targets = catalog.props.filter((p) => wanted.has(p.id));
    for (const entry of catalog.props) kit.entries.set(entry.id, entry);
    if (targets.length === 0) return kit;

    const draco = new DRACOLoader();
    draco.setDecoderPath(dracoPath);
    draco.setWorkerLimit(2);
    const gltf = new GLTFLoader().setDRACOLoader(draco);

    // Declare every file first so the loading progress bar reflects the full prop kit bytes.
    const plan: { entry: PropCatalogEntry; lods: PropCatalogLod[] }[] = targets.map((entry) => {
      const lods = selectCatalogLods(entry, quality, withoutFar.has(entry.id));
      for (const lod of lods) loader.expect(catalogAssetPath(lod.file), lod.bytes);
      return { entry, lods };
    });

    let failed = false;
    const jobs = plan.map(async ({ entry, lods }) => {
      const builtLods: BuiltPropLod[] = [];
      for (const lod of lods) {
        const rel = catalogAssetPath(lod.file);
        const buf = await loader.bytes(rel);
        if (failed) return;
        const result = await gltf.parseAsync(buf, loader.url('props/'));
        const merged = mergeSceneToPropLod(result.scene, lod.maxDistance, quality.anisotropy);
        if (merged) builtLods.push(merged);
      }
      if (builtLods.length > 0) kit.built.set(entry.id, builtLods);
    });

    const settled = await Promise.allSettled(
      jobs.map((p) =>
        p.catch((e: unknown) => {
          failed = true;
          throw e;
        }),
      ),
    );
    draco.dispose();

    const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected) {
      kit.dispose();
      throw rejected.reason;
    }
    return kit;
  }

  /** Whether a catalogue prop ID was loaded and is ready to register in `PropRegistry`. */
  has(id: string): boolean {
    return this.built.has(id);
  }

  /** Return `PropLod[]` for a catalogue ID, collapsing all non-overridden slots into 1 draw call. */
  lodsFor(id: string, options: PropLodOptions = {}): PropLod[] | null {
    const list = this.built.get(id);
    if (!list || list.length === 0) return null;
    const overrides = options.materialOverrides;
    const scale = options.maxDistanceScale ?? 1;
    const caps = options.distanceCaps;
    const tintSet = options.tintSlots ? new Set(options.tintSlots) : DEFAULT_TINTABLE_SLOTS;
    const slotColors = options.slotColors;
    const k = options.colourScale ?? 1;
    const baseMat = options.baseMaterial ?? this.getSharedMaterial();

    return list.map((lod, lodIdx) => {
      const unifiedSlots: SlotGeometry[] = [];
      const overrideSlots: { slot: SlotGeometry; mat: Material }[] = [];
      for (const s of lod.slots) {
        const ov = overrides?.[s.name];
        if (ov) overrideSlots.push({ slot: s, mat: ov });
        else unifiedSlots.push(s);
      }

      let totalVerts = 0;
      for (const s of unifiedSlots) totalVerts += s.pos.length / 3;
      for (const o of overrideSlots) totalVerts += o.slot.pos.length / 3;

      const pos = new Float32Array(totalVerts * 3);
      const nor = new Float32Array(totalVerts * 3);
      const uv = new Float32Array(totalVerts * 2);
      const col = new Float32Array(totalVerts * 3);
      const pbr = new Float32Array(totalVerts * 3);

      const materials: Material[] = [];
      const groups: { start: number; count: number; materialIndex: number }[] = [];
      let vOff = 0;

      const appendSlot = (s: SlotGeometry, tintMask: number): void => {
        const count = s.pos.length / 3;
        pos.set(s.pos, vOff * 3);
        nor.set(s.nor, vOff * 3);
        uv.set(s.uv, vOff * 2);
        const c = slotColors?.[s.name] ?? s.color;
        for (let i = 0; i < count; i++) {
          const k3 = (vOff + i) * 3;
          col[k3] = c[0] * k;
          col[k3 + 1] = c[1] * k;
          col[k3 + 2] = c[2] * k;
          pbr[k3] = s.roughness;
          pbr[k3 + 1] = s.metalness;
          pbr[k3 + 2] = tintMask;
        }
        vOff += count;
      };

      if (unifiedSlots.length > 0) {
        const matIdx = materials.length;
        materials.push(baseMat);
        const start = vOff;
        for (const s of unifiedSlots) {
          appendSlot(s, tintSet.has(s.name) ? 1 : 0);
        }
        groups.push({ start, count: vOff - start, materialIndex: matIdx });
      }

      for (const o of overrideSlots) {
        const matIdx = materials.length;
        materials.push(o.mat);
        const start = vOff;
        appendSlot(o.slot, 0);
        groups.push({ start, count: vOff - start, materialIndex: matIdx });
      }

      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new BufferAttribute(nor, 3));
      geometry.setAttribute('uv', new BufferAttribute(uv, 2));
      geometry.setAttribute('color', new BufferAttribute(col, 3));
      geometry.setAttribute('aPropPbr', new BufferAttribute(pbr, 3));
      for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex);
      geometry.computeBoundingSphere();
      this.ownedGeometries.push(geometry);

      let maxDistance = lod.maxDistance * scale;
      if (caps && caps.length > 0) {
        const capIdx = Math.max(0, Math.min(caps.length - 1, caps.length - list.length + lodIdx));
        const cap = caps[capIdx] as number;
        maxDistance = Math.min(maxDistance, cap * scale);
      }

      return {
        geometry,
        material: materials.length === 1 ? (materials[0] as Material) : materials,
        maxDistance,
      };
    });
  }

  /** Release every geometry and material owned by the prop kit. */
  dispose(): void {
    for (const g of this.ownedGeometries) g.dispose();
    this.ownedGeometries.length = 0;
    this.sharedMaterial?.dispose();
    this.sharedMaterial = null;
    this.built.clear();
  }
}
