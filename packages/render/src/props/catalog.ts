import {
  BufferAttribute,
  BufferGeometry,
  MeshStandardMaterial,
  Texture,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
 * Prop IDs from `props.catalog.json` that `CircuitWorld` consumes when present.
 * Keeping the list explicit ensures only props placed by the world are fetched on load.
 */
export const WORLD_CATALOG_PROP_IDS: readonly string[] = Object.freeze([
  'pit-wall',
  'crew-engineer-seated',
  'crew-mechanic-standing',
  'crowd-seated-0',
  'crowd-seated-1',
  'crowd-seated-2',
  'hoarding',
  'catch-fence',
  'braking-board',
  'zone-board',
  'marshal-post',
  'absorber-block',
  'screen-tower',
  'camera-tower',
]);

/** Material names that should receive per-instance colour tinting (team colours / crowd clothes). */
const TINTABLE_SLOTS = new Set(['clothing', 'paint-band', 'seat', 'team-tint']);

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

/** Pick the LODs to fetch for a given quality preset (drops `_high.glb` on mobile/lite). */
export function selectCatalogLods(
  entry: PropCatalogEntry,
  quality: Pick<Quality, 'name'>,
): PropCatalogLod[] {
  const sorted = [...entry.lods].sort((a, b) => a.maxDistance - b.maxDistance);
  if (quality.name === 'mobile' || quality.name === 'lite') {
    const light = sorted.filter((l) => !/_high\.glb$/i.test(l.file));
    if (light.length > 0) return light;
  }
  return sorted;
}

interface BuiltPropLod {
  geometry: BufferGeometry;
  materials: Material[];
  maxDistance: number;
}

/**
 * Flatten a GLTF scene into a single multi-group `BufferGeometry` + `Material[]` so it can be
 * drawn in one `InstancedMesh` per chunk inside `PropRegistry`.
 */
export function mergeSceneToPropLod(
  root: Object3D,
  maxDistance: number,
  anisotropy: number,
): BuiltPropLod | null {
  root.updateMatrixWorld(true);
  const byMat = new Map<Material, BufferGeometry[]>();

  root.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const src = mesh.geometry;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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

  const materials: Material[] = [];
  const allPos: number[] = [];
  const allNor: number[] = [];
  const allUv: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let vertexOffset = 0;

  const hasTintable = [...byMat.keys()].some((m) => TINTABLE_SLOTS.has(m.name));

  for (const [mat, geos] of byMat) {
    const matIdx = materials.length;
    preparePropMaterial(mat, anisotropy, hasTintable && !TINTABLE_SLOTS.has(mat.name));
    materials.push(mat);
    const start = vertexOffset;
    for (const g of geos) {
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        allPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        if (nor) allNor.push(nor.getX(i), nor.getY(i), nor.getZ(i));
        else allNor.push(0, 1, 0);
        if (uv) allUv.push(uv.getX(i), uv.getY(i));
        else allUv.push(0, 0);
      }
      vertexOffset += count;
      g.dispose();
    }
    groups.push({ start, count: vertexOffset - start, materialIndex: matIdx });
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(new Float32Array(allPos), 3));
  merged.setAttribute('normal', new BufferAttribute(new Float32Array(allNor), 3));
  merged.setAttribute('uv', new BufferAttribute(new Float32Array(allUv), 2));
  for (const grp of groups) merged.addGroup(grp.start, grp.count, grp.materialIndex);
  merged.computeBoundingSphere();

  return { geometry: merged, materials, maxDistance };
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

function preparePropMaterial(mat: Material, anisotropy: number, ignoreInstanceTint: boolean): void {
  if (mat instanceof MeshStandardMaterial) {
    if (mat.map) mat.map.anisotropy = Math.min(4, anisotropy);
    if (mat.normalMap) mat.normalMap.anisotropy = Math.min(4, anisotropy);
    if (mat.roughnessMap) mat.roughnessMap.anisotropy = Math.min(4, anisotropy);
  }
  if (ignoreInstanceTint) {
    // Keep non-clothing parts (skin, steel, concrete, rubber) natural when InstancedMesh uses
    // per-instance team/crowd colour tinting on the same prop.
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, renderer) {
      prev.call(this, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR_ALPHA )
          diffuseColor *= vColor;
        #elif defined( USE_COLOR )
          diffuseColor.rgb *= vColor;
        #endif`,
      );
    };
    mat.customProgramCacheKey = () => 'prop-no-instance-tint';
  }
}

export interface PropLodOptions {
  /** Replace named material slots (e.g. `{ 'board-face': brandMat }`) for this prop kind. */
  materialOverrides?: Readonly<Record<string, Material>>;
  /** Optional multiplier applied to each LOD's `maxDistance`. */
  maxDistanceScale?: number;
}

/**
 * Loaded modular prop kit backed by `packages/render/data/props.catalog.json`.
 * Each loaded prop ID exposes ready-to-register `PropLod[]` matching the ground-centre,
 * +Y up, +X front pivot contract so `CircuitWorld` swaps stand-ins for modelled GLBs via data.
 */
export class PropKitAssets {
  readonly entries = new Map<string, PropCatalogEntry>();
  private readonly built = new Map<string, BuiltPropLod[]>();

  private constructor() {}

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
      const lods = selectCatalogLods(entry, quality);
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

  /** Return `PropLod[]` for a catalogue ID, applying optional material overrides per slot name. */
  lodsFor(id: string, options: PropLodOptions = {}): PropLod[] | null {
    const list = this.built.get(id);
    if (!list || list.length === 0) return null;
    const overrides = options.materialOverrides;
    const scale = options.maxDistanceScale ?? 1;
    return list.map((lod) => {
      const mats = overrides ? lod.materials.map((m) => overrides[m.name] ?? m) : lod.materials;
      return {
        geometry: lod.geometry,
        material: mats.length === 1 ? (mats[0] as Material) : mats,
        maxDistance: lod.maxDistance * scale,
      };
    });
  }

  /** Release every geometry, material and embedded texture owned by the prop kit. */
  dispose(): void {
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    for (const list of this.built.values()) {
      for (const lod of list) {
        lod.geometry.dispose();
        for (const m of lod.materials) materials.add(m);
      }
    }
    for (const m of materials) {
      for (const v of Object.values(m)) if (v instanceof Texture) textures.add(v);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    this.built.clear();
  }
}
