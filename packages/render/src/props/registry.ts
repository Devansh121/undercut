import {
  createDebrisPose,
  debrisPose,
  settledHit,
  type BreakableObject,
  type BreakableHit,
  type CarPose,
} from '@undercut/sim';
import {
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  Euler,
  SRGBColorSpace,
  Sphere,
  Texture,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';

/**
 * Trackside dressing hook (stands, trees, boards, fences, marshal posts): a registry of prop kinds
 * drawn instanced, chunked by lap sector so whole chunks are frustum-culled, and switched between
 * levels of detail per chunk by camera distance. The dressing slice registers kinds and places
 * instances; it never touches the render loop. See docs/render.md.
 */
export interface PropLod {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** Drawn while the chunk's near edge is nearer than this, m (the last level: up to it, then culled). */
  maxDistance: number;
  /** Shadow depth material (alpha-tested cards whose uv the vertex shader changes). */
  depthMaterial?: Material;
}

export interface PropKind {
  id: string;
  /** Nearest first. */
  lods: PropLod[];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /**
   * Maximum distance (m, to the chunk's near edge) at which this kind casts shadows into the
   * sun shadow cascades. Beyond this distance `castShadow` is cleared per chunk so distant
   * scenery skips the shadow passes while staying visible in the main pass.
   */
  shadowMaxDistance?: number;
  /**
   * Chunk by a square world grid of this cell size (m) instead of by lap distance: for scenery
   * spread over the land around the circuit (woods), where lap chunks would be long and thin.
   */
  gridCell?: number;
  /**
   * Lap chunk length for this kind, m (default the registry's): short chunks for small props
   * along the barriers, so only those really near the eye switch to their top level.
   */
  chunkLength?: number | undefined;
}

/** World placement: position of the prop's origin (m), yaw about +Y (rad), uniform scale. */
export interface PropPlacement {
  /** Shared lightweight contact footprint; absent for solid supporting structures. */
  breakable?: BreakableObject;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  scale?: number;
  /** Lap distance of the place, m; decides the chunk. */
  s: number;
  /** Per-instance colour multiplier (linear), e.g. leaf tint. */
  colour?: readonly [number, number, number];
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
  radius: number;
  meshes: InstancedMesh[];
}

/**
 * A car's body footprint for keeping debris out of it, m: from the centre to the nose and the
 * tail and to each side (`bodyCorners` in the sim, generous for every trim), and the height
 * under which a board can meet it.
 */
const CAR_NOSE = 3.4;
const CAR_TAIL = 2.6;
const CAR_HALF_WIDTH = 1;
const DEBRIS_CLEAR_HEIGHT = 0.9;
/** Room kept between a board's origin and a car's body, m. */
const DEBRIS_CLEARANCE = 0.4;

const m = new Matrix4();
const q = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Group placements by a square world grid: cell key → placement indices (pure; tested). */
export function bucketByGrid(
  placements: readonly Pick<PropPlacement, 'x' | 'z'>[],
  cell: number,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  placements.forEach((p, i) => {
    const k = Math.floor(p.x / cell) * 65536 + Math.floor(p.z / cell);
    let list = out.get(k);
    if (!list) out.set(k, (list = []));
    list.push(i);
  });
  return out;
}

const tint = new Color();

export class PropRegistry {
  readonly group = new Group();
  private readonly kinds = new Map<string, PropKind>();
  private readonly placements = new Map<string, PropPlacement[]>();
  private readonly chunks = new Map<string, Chunk[]>();
  private built = false;
  private readonly breakableObjects = new Map<number, BreakableObject>();
  private readonly breakableInstances = new Map<number, { mesh: InstancedMesh; index: number }[]>();
  private readonly broken = new Set<number>();
  private readonly consumed = new Uint32Array(64);
  private readonly debris = new Map<number, BreakableHit>();
  private readonly debrisEuler = new Euler();
  private readonly debrisPose = createDebrisPose();
  /** Per object, the local bounds of all its meshes (x and y, m): what rests on the ground. */
  private readonly debrisBounds = new Map<number, readonly [number, number, number, number]>();
  /** Cars seen this frame (x, z, yaw, repeated), for keeping low debris out of their bodies. */
  private readonly cars: number[] = [];
  /** Per moving board, how far it has been pushed out of cars so far (x, z), m. */
  private readonly debrisPush = new Map<number, [number, number]>();
  /** A board not pushed yet works on this zeroed pair; it gets its own on its first push. */
  private readonly noPush: [number, number] = [0, 0];

  /**
   * The shadow pass's depth material for props without their own: owned here and released with
   * the registry. Left to three.js, the shadow map's own depth material (which lives as long as
   * the renderer) would compile and keep an instanced variant for every kind of prop.
   */
  readonly shadowDepth = new MeshDepthMaterial();

  /**
   * `register` receives the registry's group when it builds: the view hooks every prop material
   * into the cascaded shadows there, so a prop cannot be added unregistered.
   */
  constructor(
    private readonly lapLength: number,
    private readonly chunkLength = 200,
    private readonly register: (root: Object3D) => void = () => undefined,
    private readonly groundHeight?: (x: number, z: number) => number,
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

    for (const list of this.placements.values())
      for (const p of list) if (p.breakable) this.breakableObjects.set(p.breakable.id, p.breakable);
    for (const [id, kind] of this.kinds) {
      const list = this.placements.get(id) ?? [];
      const chunks: Chunk[] = [];
      const buckets = kind.gridCell
        ? bucketByGrid(list, kind.gridCell)
        : bucketBySector(list, this.lapLength, kind.chunkLength ?? this.chunkLength);
      for (const indices of buckets.values()) {
        const centre = new Vector3();
        for (const i of indices) {
          const p = list[i] as PropPlacement;
          centre.add(pos.set(p.x, p.y, p.z));
        }
        centre.multiplyScalar(1 / indices.length);
        let radius = 0;
        let maxScale = 1;
        for (const i of indices) {
          const p = list[i] as PropPlacement;
          radius = Math.max(radius, centre.distanceTo(pos.set(p.x, p.y, p.z)));
          if (p.scale !== undefined && p.scale > maxScale) maxScale = p.scale;
        }
        // How far any level's geometry reaches from the prop's origin (its bounding sphere is
        // not centred on the origin: towers and boards reach up), scaled.
        let reach = 0;
        for (const lod of kind.lods) {
          lod.geometry.computeBoundingSphere();
          const gs = lod.geometry.boundingSphere;
          if (gs) reach = Math.max(reach, gs.center.length() + gs.radius);
        }
        reach *= maxScale;
        if (list.some((p) => p.breakable)) reach += 40;
        const meshes = kind.lods.map((lod) => {
          const im = new InstancedMesh(lod.geometry, lod.material, indices.length);
          indices.forEach((i, k) => {
            const p = list[i] as PropPlacement;
            if (p.breakable) {
              const refs = this.breakableInstances.get(p.breakable.id) ?? [];
              refs.push({ mesh: im, index: k });
              this.breakableInstances.set(p.breakable.id, refs);
            }
            q.setFromAxisAngle(UP, p.yaw ?? 0);
            const s = p.scale ?? 1;
            im.setMatrixAt(k, m.compose(pos.set(p.x, p.y, p.z), q, scl.set(s, s, s)));
            if (p.colour) im.setColorAt(k, tint.setRGB(p.colour[0], p.colour[1], p.colour[2]));
          });
          im.customDepthMaterial = lod.depthMaterial ?? this.shadowDepth;
          im.castShadow = kind.castShadow ?? true;
          im.receiveShadow = kind.receiveShadow ?? true;
          // Chunk bounds for frustum culling: every instance's whole geometry inside.
          im.boundingSphere = new Sphere(centre.clone(), reach + radius);
          im.visible = false;
          im.matrixAutoUpdate = false;
          im.name = `prop:${id}`;
          this.group.add(im);
          return im;
        });
        chunks.push({ centre, radius: radius + reach, meshes });
      }
      this.chunks.set(id, chunks);
    }
    this.register(this.group);
  }

  /** Per frame: pick each chunk's level and shadow state by its near edge's distance from the camera. */
  update(eye: Vector3): void {
    for (const [id, chunks] of this.chunks) {
      const kind = this.kinds.get(id) as PropKind;
      const casts = kind.castShadow ?? true;
      const shadowMax = kind.shadowMaxDistance ?? Infinity;
      for (const c of chunks) {
        // Level and shadow by the distance to the chunk's near edge, so a prop beside the eye is
        // never drawn at a reduced level because its chunk's centre is far away.
        const near = Math.max(0, c.centre.distanceTo(eye) - c.radius);
        const lod = chunkLod(near, kind.lods);
        const castNow = casts && near < shadowMax;
        for (let i = 0; i < c.meshes.length; i++) {
          const im = c.meshes[i] as InstancedMesh;
          const active = i === lod;
          im.visible = active;
          im.castShadow = active && castNow;
        }
      }
    }
  }

  /** Local, AI and remote cars carry the same canonical hit events; never infer hits from frames. */
  observeCar(pose: CarPose, time: number): void {
    this.cars.push(pose.x, pose.z, pose.yaw);
    const hits = pose.breakableHits;
    if (!hits) return;
    for (let k = 0; k < hits.length; k += 4) {
      const id = hits[k]!;
      const o = this.breakableObjects.get(id);
      if (!o || this.broken.has(id)) continue;
      this.broken.add(id);
      const hit = { object: o, time: time - hits[k + 1]!, vx: hits[k + 2]!, vz: hits[k + 3]! };
      this.debris.set(id, hit);
      if (this.debris.size > 32) {
        const first = this.debris.keys().next().value!;
        const oldest = this.debris.get(first)!;
        this.writeDebris(first, oldest, oldest.time + 6);
        this.debris.delete(first);
        this.debrisPush.delete(first);
      }
    }
    if (pose.brokenObjects)
      for (let i = 0; i < this.consumed.length; i++)
        this.consumed[i] = this.consumed[i]! | pose.brokenObjects[i]!;
  }

  /** Animate existing instances, including frame and posts: no extra meshes or draw calls. */
  updateDebris(time: number): void {
    // Consume flags only after every car's events: the player may carry an opponent's flag.
    // A rebuilt view also keeps older panels gone after their four-event history expired.
    for (const id of this.breakableObjects.keys()) {
      if (this.broken.has(id) || !(this.consumed[id >>> 5]! & (1 << (id & 31)))) continue;
      this.broken.add(id);
      this.writeDebris(id, null, time);
    }
    for (const [id, hit] of this.debris) {
      this.writeDebris(id, hit, time);
      if (time - hit.time >= 6) {
        // Settled: its pose, push included, is written for good.
        this.debris.delete(id);
        this.debrisPush.delete(id);
      }
    }
    this.cars.length = 0;
  }

  /**
   * A board still low enough to meet a car's body is kept out of it: one ahead of a car's centre
   * rides on its nose (a slow car pushes it along), any other leaves by the nearer side or the
   * tail. The push accumulates per board, so it never springs back once the car has gone.
   */
  private pushOutOfCars(
    id: number,
    x: number,
    z: number,
    lift: number,
    push: [number, number],
  ): void {
    if (lift >= DEBRIS_CLEAR_HEIGHT) return;
    const cars = this.cars;
    for (let k = 0; k < cars.length; k += 3) {
      const c = Math.cos(cars[k + 2]!),
        sn = Math.sin(cars[k + 2]!);
      const dx = x + push[0] - cars[k]!,
        dz = z + push[1] - cars[k + 1]!;
      // Car frame: forward (cos yaw, −sin yaw), left (−sin yaw, −cos yaw).
      const fwd = dx * c - dz * sn;
      const left = -dx * sn - dz * c;
      const r = DEBRIS_CLEARANCE;
      if (fwd <= -CAR_TAIL - r || fwd >= CAR_NOSE + r || Math.abs(left) >= CAR_HALF_WIDTH + r)
        continue;
      let along = 0,
        across = 0;
      if (fwd >= 0) along = CAR_NOSE + r - fwd;
      else {
        const side = CAR_HALF_WIDTH + r - Math.abs(left);
        const tail = fwd + CAR_TAIL + r;
        if (side < tail) across = Math.sign(left || 1) * side;
        else along = -tail;
      }
      push[0] += along * c - across * sn;
      push[1] += -along * sn - across * c;
    }
    if (push === this.noPush && (push[0] !== 0 || push[1] !== 0)) {
      this.debrisPush.set(id, [push[0], push[1]]);
      push[0] = 0;
      push[1] = 0;
    }
  }

  /**
   * Pose an object's instances as debris: replaying `hit`, or knocked flat where it stood when
   * only its broken flag is known. The lowest point of its real geometry meets the ground.
   */
  private writeDebris(id: number, hit: BreakableHit | null, time: number): void {
    const o = this.breakableObjects.get(id);
    const refs = this.breakableInstances.get(id);
    if (!o || !refs) return;
    const pose = debrisPose(hit ?? settledHit(o), time, this.debrisPose);
    let push = this.debrisPush.get(id) ?? this.noPush;
    if (hit && time - hit.time < 6) {
      this.pushOutOfCars(id, pose.x, pose.z, pose.lift, push);
      push = this.debrisPush.get(id) ?? this.noPush;
    }
    pose.x += push[0];
    pose.z += push[1];
    const [minX, maxX, minY, maxY] = this.boundsOf(id, refs);
    // Rolled about its width (local z), a local point (x, y) rises to x·sin + y·cos.
    const sr = Math.sin(pose.roll),
      cr = Math.cos(pose.roll);
    const lowest = (sr >= 0 ? minX : maxX) * sr + (cr >= 0 ? minY : maxY) * cr;
    const ground = this.groundHeight ? this.groundHeight(pose.x, pose.z) : o.y;
    this.debrisEuler.set(0, pose.yaw, pose.roll, 'YXZ');
    q.setFromEuler(this.debrisEuler);
    m.compose(pos.set(pose.x, ground + pose.lift - lowest, pose.z), q, scl.setScalar(1));
    for (const ref of refs) {
      ref.mesh.setMatrixAt(ref.index, m);
      ref.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private boundsOf(
    id: number,
    refs: readonly { mesh: InstancedMesh }[],
  ): readonly [number, number, number, number] {
    let b = this.debrisBounds.get(id);
    if (!b) {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (const { mesh } of refs) {
        const g = mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const box = g.boundingBox!;
        minX = Math.min(minX, box.min.x);
        maxX = Math.max(maxX, box.max.x);
        minY = Math.min(minY, box.min.y);
        maxY = Math.max(maxY, box.max.y);
      }
      b = [minX, maxX, minY, maxY];
      this.debrisBounds.set(id, b);
    }
    return b;
  }

  /** Boards holding a push out of a car's body (moving boards only). */
  get pushedDebrisCount(): number {
    return this.debrisPush.size;
  }

  get movingDebrisCount(): number {
    return this.debris.size;
  }

  /** Instances placed of one kind (0 when the kind is unknown). */
  count(kindId: string): number {
    return this.placements.get(kindId)?.length ?? 0;
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
    this.shadowDepth.dispose();
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
