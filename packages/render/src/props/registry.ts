import {
  CanvasTexture,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Sphere,
  Texture,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';

/**
 * Trackside dressing hook (stands, trees, boards, fences, marshal posts): a registry of prop kinds
 * drawn instanced, chunked by lap sector so whole chunks are frustum-culled, and switched between
 * levels of detail per chunk by camera distance. The dressing slice registers kinds and places
 * instances; it never touches the render loop. See docs/render.md.
 */
export interface PropLod {
  geometry: BufferGeometry;
  material: Material;
  /** Drawn while the chunk centre is nearer than this, m (the last level: up to it, then culled). */
  maxDistance: number;
}

export interface PropKind {
  id: string;
  /** Nearest first. */
  lods: PropLod[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/** World placement: position of the prop's origin (m), yaw about +Y (rad), uniform scale. */
export interface PropPlacement {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  scale?: number;
  /** Lap distance of the place, m; decides the chunk. */
  s: number;
}

/** Chunk index of lap distance `s` for chunks of `length` metres. */
export function sectorOf(s: number, lapLength: number, length: number): number {
  const wrapped = ((s % lapLength) + lapLength) % lapLength;
  return Math.floor(wrapped / length);
}

/** Group placements by chunk: chunk index → placement indices (pure; tested). */
export function bucketBySector(
  placements: readonly Pick<PropPlacement, 's'>[],
  lapLength: number,
  length: number,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  placements.forEach((p, i) => {
    const k = sectorOf(p.s, lapLength, length);
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push(i);
  });
  return out;
}

/** Level of detail for a chunk at `dist` (−1: culled). */
export function chunkLod(dist: number, lods: readonly Pick<PropLod, 'maxDistance'>[]): number {
  for (let i = 0; i < lods.length; i++) if (dist < (lods[i] as PropLod).maxDistance) return i;
  return -1;
}

interface Chunk {
  centre: Vector3;
  meshes: InstancedMesh[];
}

const m = new Matrix4();
const q = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const UP = new Vector3(0, 1, 0);

export class PropRegistry {
  readonly group = new Group();
  private readonly kinds = new Map<string, PropKind>();
  private readonly placements = new Map<string, PropPlacement[]>();
  private readonly chunks = new Map<string, Chunk[]>();
  private built = false;

  constructor(
    private readonly lapLength: number,
    private readonly chunkLength = 200,
  ) {
    this.group.name = 'props';
  }

  define(kind: PropKind): void {
    if (this.built) throw new Error('define prop kinds before build()');
    this.kinds.set(kind.id, kind);
    this.placements.set(kind.id, []);
  }

  place(kindId: string, p: PropPlacement): void {
    const list = this.placements.get(kindId);
    if (!list) throw new Error(`unknown prop kind ${kindId}`);
    if (this.built) throw new Error('place props before build()');
    list.push(p);
  }

  /** Make the instanced meshes: one per kind, chunk and level. */
  build(): void {
    this.built = true;
    for (const [id, kind] of this.kinds) {
      const list = this.placements.get(id) ?? [];
      const chunks: Chunk[] = [];
      for (const indices of bucketBySector(list, this.lapLength, this.chunkLength).values()) {
        const centre = new Vector3();
        for (const i of indices) {
          const p = list[i] as PropPlacement;
          centre.add(pos.set(p.x, p.y, p.z));
        }
        centre.multiplyScalar(1 / indices.length);
        let radius = 0;
        for (const i of indices) {
          const p = list[i] as PropPlacement;
          radius = Math.max(radius, centre.distanceTo(pos.set(p.x, p.y, p.z)));
        }
        const meshes = kind.lods.map((lod) => {
          const im = new InstancedMesh(lod.geometry, lod.material, indices.length);
          indices.forEach((i, k) => {
            const p = list[i] as PropPlacement;
            q.setFromAxisAngle(UP, p.yaw ?? 0);
            const s = p.scale ?? 1;
            im.setMatrixAt(k, m.compose(pos.set(p.x, p.y, p.z), q, scl.set(s, s, s)));
          });
          im.castShadow = kind.castShadow ?? true;
          im.receiveShadow = kind.receiveShadow ?? true;
          // Culling on the chunk's bounds (geometry radius added generously).
          lod.geometry.computeBoundingSphere();
          const r = (lod.geometry.boundingSphere?.radius ?? 1) * 2 + radius;
          im.boundingSphere = new Sphere(centre.clone(), r);
          im.visible = false;
          im.name = `prop:${id}`;
          this.group.add(im);
          return im;
        });
        chunks.push({ centre, meshes });
      }
      this.chunks.set(id, chunks);
    }
  }

  /** Per frame: pick each chunk's level by its distance from the camera. */
  update(eye: Vector3): void {
    for (const [id, chunks] of this.chunks) {
      const kind = this.kinds.get(id) as PropKind;
      for (const c of chunks) {
        const lod = chunkLod(c.centre.distanceTo(eye), kind.lods);
        c.meshes.forEach((im, i) => (im.visible = i === lod));
      }
    }
  }

  get instanceCount(): number {
    let n = 0;
    for (const list of this.placements.values()) n += list.length;
    return n;
  }

  /** Releases the instanced meshes; kinds' geometries and materials belong to the caller. */
  dispose(): void {
    for (const chunks of this.chunks.values())
      for (const c of chunks) for (const im of c.meshes) im.dispose();
    this.chunks.clear();
    this.group.removeFromParent();
  }
}

/**
 * Material for advertising boards, signage and decals from generated artwork (a canvas or an
 * image): sRGB colour, a printed-vinyl roughness, mipmaps and anisotropy, optional emission for
 * lit panels at night. The caller owns the texture.
 */
export function boardMaterial(
  art: Texture | HTMLCanvasElement,
  options: { anisotropy?: number; roughness?: number; emissive?: number; decal?: boolean } = {},
): MeshStandardMaterial {
  const texture = art instanceof Texture ? art : new CanvasTexture(art);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = options.anisotropy ?? 8;
  const mat = new MeshStandardMaterial({
    map: texture,
    roughness: options.roughness ?? 0.55,
    metalness: 0,
    emissiveMap: options.emissive ? texture : null,
    emissive: options.emissive ? 0xffffff : 0x000000,
    emissiveIntensity: options.emissive ?? 0,
    transparent: options.decal ?? false,
    depthWrite: !(options.decal ?? false),
    polygonOffset: options.decal ?? false,
    polygonOffsetFactor: options.decal ? -2 : 0,
    polygonOffsetUnits: options.decal ? -2 : 0,
  });
  return mat;
}
