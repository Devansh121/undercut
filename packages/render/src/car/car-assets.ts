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
/** Each team has its own livery mask (docs/car-asset.md). */
export const liveryMaskFile = (team: string): string => `car/livery/${team}.png`;

/** A driver's look on the car: team (its livery mask), colours (sRGB hex), race number, code. */
export interface CarLivery {
  team: string;
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
    teams: readonly string[],
    dracoPath: string,
  ): Promise<CarAssets> {
    const out = new CarAssets();
    const lods = new Set<CarLod>([...quality.carLods, quality.playerLod]);
    // One decoder for every level, disposed when the loads finish or fail: it holds workers.
    const draco = new DRACOLoader();
    draco.setDecoderPath(dracoPath);
    draco.setWorkerLimit(2);
    const gltf = new GLTFLoader().setDRACOLoader(draco);
    // Once anything fails, files that arrive later are not decoded: no worker starts after the
    // load has given up.
    let failed = false;
    const parse = async (lod: CarLod): Promise<void> => {
      const buf = await loader.bytes(CAR_FILES[lod]);
      if (failed) return;
      const result = await gltf.parseAsync(buf, loader.url('car/'));
      const root = result.scene.getObjectByName('car');
      if (!root) throw new Error(`${CAR_FILES[lod]} has no 'car' node`);
      root.removeFromParent();
      prepare(root, quality);
      out.templates.set(lod, { lod, root });
    };
    const mask = async (team: string): Promise<void> => {
      const img = await loader.image(liveryMaskFile(team), 'image/png');
      out.maskImages.set(team, img);
      const t = new Texture(img);
      t.flipY = false;
      t.needsUpdate = true;
      t.anisotropy = Math.min(4, quality.anisotropy);
      out.masks.set(team, t);
    };
    for (const lod of lods) loader.expect(CAR_FILES[lod], undefined);
    const jobs = [...[...lods].map(parse), ...[...new Set(teams)].map(mask)].map((p) =>
      p.catch((e: unknown) => {
        failed = true;
        throw e;
      }),
    );
    // Wait for every sibling to settle before releasing anything, so nothing finishes (or starts
    // decoding) after the decoder and the half-built assets are gone.
    const settled = await Promise.allSettled(jobs);
    draco.dispose();
    const rejected = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (rejected) {
      out.dispose();
      throw rejected.reason;
    }
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

/** Per-preset material settings on a freshly parsed level of detail. */
function prepare(root: Object3D, quality: Quality): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    // The suspension links are thin and under the floor: their shadow does not read, and a
    // morph-target caster would need its own shadow-depth shader variants.
    mesh.castShadow = !(o.name === 'suspension_links' || o.parent?.name === 'suspension_links');
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
