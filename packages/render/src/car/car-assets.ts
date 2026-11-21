import type { Material, Mesh } from 'three';
import { MeshPhysicalMaterial, MeshStandardMaterial, Texture, type Object3D } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AssetLoader } from '../assets/loader';
import type { CarLod, Quality } from '../quality';

/** Files of the car asset (docs/car-asset.md), relative to the assets folder. */
export const CAR_FILES: Readonly<Record<CarLod, string>> = Object.freeze({
  high: 'car/car_high.glb',
  mobile: 'car/car_mobile.glb',
  far: 'car/car_far.glb',
});
export const liveryMaskFile = (pattern: string): string => `car/livery/${pattern}.png`;

/** A team's look on the car: livery mask pattern, colours (sRGB hex), race number, code. */
export interface CarLivery {
  pattern: string;
  primary: string;
  secondary: string;
  accent: string;
  number: number;
  code: string;
}

/** One loaded level of detail: the asset's `car` node and everything it owns on the GPU. */
export interface CarTemplate {
  lod: CarLod;
  root: Object3D;
}

/**
 * The car's levels of detail and livery masks for one session. The GLB bytes and mask images are
 * cached by the asset loader for the page; the three.js objects are made per session and
 * released by `dispose`.
 */
export class CarAssets {
  readonly templates = new Map<CarLod, CarTemplate>();
  readonly masks = new Map<string, Texture>();
  readonly maskImages = new Map<string, ImageBitmap>();

  private constructor() {}

  static async load(
    loader: AssetLoader,
    quality: Quality,
    patterns: readonly string[],
    dracoPath: string,
  ): Promise<CarAssets> {
    const out = new CarAssets();
    const lods = new Set<CarLod>([...quality.carLods, quality.playerLod]);
    const draco = sharedDraco(dracoPath);
    const gltf = new GLTFLoader().setDRACOLoader(draco);
    const parse = async (lod: CarLod): Promise<void> => {
      const buf = await loader.bytes(CAR_FILES[lod]);
      const result = await gltf.parseAsync(buf, loader.url('car/'));
      const root = result.scene.getObjectByName('car');
      if (!root) throw new Error(`${CAR_FILES[lod]} has no 'car' node`);
      root.removeFromParent();
      prepare(root, quality);
      out.templates.set(lod, { lod, root });
    };
    const mask = async (pattern: string): Promise<void> => {
      const img = await loader.image(liveryMaskFile(pattern), 'image/png');
      out.maskImages.set(pattern, img);
      const t = new Texture(img);
      t.flipY = false;
      t.needsUpdate = true;
      t.anisotropy = Math.min(4, quality.anisotropy);
      out.masks.set(pattern, t);
    };
    for (const lod of lods) loader.expect(CAR_FILES[lod], undefined);
    await Promise.all([...[...lods].map(parse), ...[...new Set(patterns)].map(mask)]);
    return out;
  }

  template(lod: CarLod): CarTemplate {
    const t =
      this.templates.get(lod) ?? this.templates.get('mobile') ?? [...this.templates.values()][0];
    if (!t) throw new Error('no car level of detail loaded');
    return t;
  }

  dispose(): void {
    const materials = new Set<Material>();
    const textures = new Set<Texture>();
    for (const { root } of this.templates.values()) {
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
          materials.add(m);
      });
    }
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof Texture) textures.add(value);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    for (const t of this.masks.values()) t.dispose();
  }
}

let draco: DRACOLoader | null = null;
/** One Draco decoder (its workers) for the page; the decoder files are served locally. */
function sharedDraco(path: string): DRACOLoader {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath(path);
    draco.setWorkerLimit(2);
  }
  return draco;
}

/** Per-preset material settings on a freshly parsed level of detail. */
function prepare(root: Object3D, quality: Quality): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m instanceof MeshPhysicalMaterial && !quality.clearcoat) m.clearcoat = 0;
      if (m instanceof MeshStandardMaterial) {
        for (const t of [
          m.map,
          m.normalMap,
          m.roughnessMap,
          m.metalnessMap,
          m.aoMap,
          m.emissiveMap,
        ]) {
          if (t) t.anisotropy = quality.anisotropy;
        }
        if (m.name === 'mirror_glass') {
          // Mirrors show the sky, softly: a plausible reflection without a second scene render.
          m.metalness = 1;
          m.roughness = 0.18;
          m.color.set('#8c949c');
        }
        if (m.name === 'decal') mesh.castShadow = false;
      }
    }
  });
}
