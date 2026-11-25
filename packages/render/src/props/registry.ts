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
  InstancedBufferAttribute,
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
   * Cast shadows with this level's geometry (index into `lods`, a cheap one) at every distance,
   * instead of with the level on show: a shadow-only copy of the chunk, sharing its instances and
   * drawn on `SHADOW_CASTER_LAYER`, which only the sun's shadow cameras see. For big props whose
   * shadow pass would otherwise draw their detailed levels once per cascade.
   */
  shadowLevel?: number;
  /**
   * Chunk by a square world grid of this cell size (m) instead of by lap distance: for scenery
   * spread over the land around the circuit (woods), where lap chunks would be long and thin.
   */
  gridCell?: number;
  /** Batch the last visual level across cells this wide, keeping fine LOD/shadow decisions. */
  farBatchCell?: number | undefined;
  /** Batch nearer visual levels (before the last) across cells this wide, for static non-shadow-direct kinds. */
  nearBatchCell?: number | undefined;
  /** Batch shadow-only proxy instances across cells this wide, keeping fine-cell shadow reach. */
  shadowBatchCell?: number | undefined;
  /**
   * Lap chunk length for this kind, m (default the registry's): short chunks for small props
   * along the barriers, so only those really near the eye switch to their top level.
   */
  chunkLength?: number | undefined;
  /**
   * Drawn in the water's planar reflection (world/water.ts): 'skyline' on every preset that
   * reflects, 'scenery' only where the preset reflects the circuit too. Absent: not reflected.
   */
  reflect?: Reflected | undefined;
}

/** What the water's reflection draws (world/water.ts, `userData.reflect`). */
export type Reflected = 'skyline' | 'scenery';

/**
 * World placement: position of the prop's origin (m), yaw about +Y (rad), pitch about the prop's
 * own +X axis (rad, applied before yaw: positive tips local +Z down), uniform scale and an
 * optional per-axis stretch in the prop's own frame (applied before pitch and yaw).
 */
export interface PropPlacement {
  /** Shared lightweight contact footprint; absent for solid supporting structures. */
  breakable?: BreakableObject;
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
  scale?: number;
  stretch?: readonly [number, number, number];
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
  /** Shadow-only copy at the kind's `shadowLevel`, on `SHADOW_CASTER_LAYER`. */
  shadow?: InstancedMesh;
  lod: number;
  casting: boolean;
  /** Safe camera travel before a level or shadow boundary can be crossed. */
  margin: number;
  levelBatches?: (LevelBatch | undefined)[];
  shadowBatch?: ShadowBatch;
}

interface LevelBatch {
  mesh: InstancedMesh;
  chunks: Chunk[];
  level: number;
  dirty: boolean;
}

interface ShadowBatch {
  mesh: InstancedMesh;
  chunks: Chunk[];
  level: number;
  dirty: boolean;
}

interface KindState {
  kind: PropKind;
  chunks: Chunk[];
  casts: boolean;
  shadowMax: number;
  minMargin: number;
  deferredTravel: number;
}

/**
 * Object layer drawn only by the sun's shadow cameras (they enable it; no view camera does):
 * shadow-only proxies of props (`PropKind.shadowLevel`).
 */
export const SHADOW_CASTER_LAYER = 3;

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
const qPitch = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

/** Instance matrix of a placement: translate · yaw · pitch · scale (pure; tested). */
export function placementMatrix(p: PropPlacement, out = new Matrix4()): Matrix4 {
  q.setFromAxisAngle(UP, p.yaw ?? 0);
  if (p.pitch) q.multiply(qPitch.setFromAxisAngle(RIGHT, p.pitch));
  const s = p.scale ?? 1;
  const k = p.stretch ?? ([1, 1, 1] as const);
  return out.compose(pos.set(p.x, p.y, p.z), q, scl.set(s * k[0], s * k[1], s * k[2]));
}

/** Largest axis scale of a placement. */
function placementReach(p: PropPlacement): number {
  const k = p.stretch ?? ([1, 1, 1] as const);
  return (p.scale ?? 1) * Math.max(k[0], k[1], k[2]);
}

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
  private readonly kindStates: KindState[] = [];
  private readonly levelBatches: LevelBatch[] = [];
  private readonly shadowBatches: ShadowBatch[] = [];
  private readonly lastEye = new Vector3();
  private hasLastEye = false;
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
    this.group.matrixAutoUpdate = false;
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
      const hasBreakables = list.some((p) => p.breakable);
      const shadowMax = kind.shadowMaxDistance ?? Infinity;
      const farCannotCast =
        kind.castShadow === false ||
        kind.shadowLevel !== undefined ||
        (kind.lods.length > 1 && shadowMax <= kind.lods[kind.lods.length - 2]!.maxDistance);
      if (kind.farBatchCell && (!farCannotCast || hasBreakables))
        throw new Error('Far batches need static props whose far level does not cast shadows');
      if (
        kind.nearBatchCell &&
        ((kind.castShadow !== false && kind.shadowLevel === undefined) || hasBreakables)
      )
        throw new Error('Near batches need static props with independent shadows');
      if (kind.shadowBatchCell && (kind.shadowLevel === undefined || hasBreakables))
        throw new Error('Shadow batches need static props with a shadowLevel');
      const batchCellFor = (level: number): number | undefined =>
        level === kind.lods.length - 1 ? kind.farBatchCell : kind.nearBatchCell;
      const chunks: Chunk[] = [];
      const casts = kind.castShadow ?? true;
      const useShadowProxy = kind.shadowLevel !== undefined && casts;
      const useShadowBatch = useShadowProxy && Boolean(kind.shadowBatchCell);
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
          maxScale = Math.max(maxScale, placementReach(p));
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
        if (hasBreakables) reach += 40;
        const meshes = kind.lods.map((lod, level) => {
          const im = new InstancedMesh(lod.geometry, lod.material, indices.length);
          indices.forEach((i, k) => {
            const p = list[i] as PropPlacement;
            if (p.breakable) {
              const refs = this.breakableInstances.get(p.breakable.id) ?? [];
              refs.push({ mesh: im, index: k });
              this.breakableInstances.set(p.breakable.id, refs);
            }
            im.setMatrixAt(k, placementMatrix(p, m));
            if (p.colour) im.setColorAt(k, tint.setRGB(p.colour[0], p.colour[1], p.colour[2]));
          });
          im.customDepthMaterial = lod.depthMaterial ?? this.shadowDepth;
          im.castShadow = casts && !useShadowProxy;
          im.receiveShadow = kind.receiveShadow ?? true;
          // Chunk bounds for frustum culling: every instance's whole geometry inside.
          im.boundingSphere = new Sphere(centre.clone(), reach + radius);
          im.visible = false;
          im.matrixAutoUpdate = false;
          im.name = `prop:${id}`;
          if (kind.reflect) im.userData.reflect = kind.reflect;
          if (!batchCellFor(level)) this.group.add(im);
          return im;
        });
        let shadow: InstancedMesh | undefined;
        if (useShadowProxy && !useShadowBatch) {
          const level = kind.shadowLevel!;
          const source = meshes[level]!;
          const lod = kind.lods[level]!;
          shadow = new InstancedMesh(lod.geometry, lod.material, indices.length);
          // The level's own instances, uploaded once for both.
          shadow.instanceMatrix = source.instanceMatrix;
          shadow.customDepthMaterial = source.customDepthMaterial;
          shadow.castShadow = true;
          shadow.receiveShadow = false;
          shadow.layers.set(SHADOW_CASTER_LAYER);
          shadow.boundingSphere = source.boundingSphere;
          shadow.visible = false;
          shadow.matrixAutoUpdate = false;
          shadow.name = `prop-shadow:${id}`;
          this.group.add(shadow);
        }
        chunks.push({
          centre,
          radius: radius + reach,
          meshes,
          lod: -2,
          casting: false,
          margin: 0,
          ...(shadow && { shadow }),
        });
      }
      if (chunks.length > 0) {
        const centres = chunks.map((c) => c.centre);
        for (let level = 0; level < kind.lods.length; level++) {
          const cell = batchCellFor(level);
          if (!cell) continue;
          const batchBuckets = bucketByGrid(centres, cell);
          const lod = kind.lods[level]!;
          for (const indices of batchBuckets.values()) {
            const members = indices.map((i) => chunks[i]!);
            const capacity = members.reduce((n, c) => n + c.meshes[level]!.count, 0);
            const mesh = new InstancedMesh(lod.geometry, lod.material, capacity);
            mesh.castShadow = false;
            mesh.receiveShadow = kind.receiveShadow ?? true;
            mesh.matrixAutoUpdate = false;
            mesh.visible = false;
            mesh.name = `prop:${id}`;
            if (kind.reflect) mesh.userData.reflect = kind.reflect;
            const bounds = new Sphere().makeEmpty();
            for (const c of members) bounds.union(c.meshes[level]!.boundingSphere!);
            mesh.boundingSphere = bounds;
            if (members.some((c) => c.meshes[level]!.instanceColor))
              mesh.instanceColor = new InstancedBufferAttribute(
                new Float32Array(capacity * 3).fill(1),
                3,
              );
            // Seed all slots so a zero-active batch can still warm its level during loading.
            let offset = 0;
            for (const c of members) {
              const source = c.meshes[level]!;
              mesh.instanceMatrix.array.set(source.instanceMatrix.array, offset * 16);
              if (source.instanceColor)
                mesh.instanceColor!.array.set(source.instanceColor.array, offset * 3);
              offset += source.count;
            }
            const batch: LevelBatch = { mesh, chunks: members, level, dirty: true };
            for (const c of members) {
              c.levelBatches ??= new Array<LevelBatch | undefined>(kind.lods.length);
              c.levelBatches[level] = batch;
            }
            this.levelBatches.push(batch);
            this.group.add(mesh);
          }
        }
      }
      if (useShadowBatch && chunks.length > 0) {
        const shadowBuckets = bucketByGrid(
          chunks.map((c) => c.centre),
          kind.shadowBatchCell!,
        );
        const level = kind.shadowLevel!;
        const lod = kind.lods[level]!;
        for (const indices of shadowBuckets.values()) {
          const members = indices.map((i) => chunks[i]!);
          const capacity = members.reduce((n, c) => n + c.meshes[level]!.count, 0);
          const mesh = new InstancedMesh(lod.geometry, lod.material, capacity);
          mesh.customDepthMaterial = lod.depthMaterial ?? this.shadowDepth;
          mesh.castShadow = true;
          mesh.receiveShadow = false;
          mesh.layers.set(SHADOW_CASTER_LAYER);
          mesh.matrixAutoUpdate = false;
          mesh.visible = false;
          mesh.name = `prop-shadow:${id}`;
          const bounds = new Sphere().makeEmpty();
          for (const c of members) bounds.union(c.meshes[level]!.boundingSphere!);
          mesh.boundingSphere = bounds;
          let offset = 0;
          for (const c of members) {
            const source = c.meshes[level]!;
            mesh.instanceMatrix.array.set(source.instanceMatrix.array, offset * 16);
            offset += source.count;
          }
          const shadowBatch: ShadowBatch = { mesh, chunks: members, level, dirty: true };
          for (const c of members) c.shadowBatch = shadowBatch;
          this.shadowBatches.push(shadowBatch);
          this.group.add(mesh);
        }
      }
      this.chunks.set(id, chunks);
      this.kindStates.push({
        kind,
        chunks,
        casts,
        shadowMax: kind.shadowMaxDistance ?? Infinity,
        minMargin: 0,
        deferredTravel: 0,
      });
    }
    this.group.updateMatrixWorld(true);
    // Every child is a static InstancedMesh at identity; Three.js passes force=true every frame
    // whenever Scene.matrixAutoUpdate is true, so skip the child walk when our world transform
    // is unchanged.
    const lastWorld = this.group.matrixWorld.clone();
    const nextWorld = new Matrix4();
    const updateWorld = Group.prototype.updateMatrixWorld;
    this.group.updateMatrixWorld = () => {
      if (this.group.matrixAutoUpdate) this.group.updateMatrix();
      if (this.group.parent)
        nextWorld.multiplyMatrices(this.group.parent.matrixWorld, this.group.matrix);
      else nextWorld.copy(this.group.matrix);
      if (!this.group.matrixWorldNeedsUpdate && nextWorld.equals(lastWorld)) return;
      lastWorld.copy(nextWorld);
      updateWorld.call(this.group, true);
    };
    this.register(this.group);
  }

  /** Per frame: pick each chunk's level and shadow state by its near edge's distance from the camera. */
  update(eye: Vector3): void {
    let movement: number;
    if (!this.hasLastEye) {
      this.hasLastEye = true;
      this.lastEye.copy(eye);
      movement = Infinity;
    } else {
      movement = eye.distanceTo(this.lastEye);
      if (movement === 0) return;
      this.lastEye.copy(eye);
    }
    let anyLevelDirty = false;
    let anyShadowDirty = false;
    for (let k = 0; k < this.kindStates.length; k++) {
      const state = this.kindStates[k]!;
      // Distance is 1-Lipschitz: if no chunk in this kind can cross a threshold, skip the whole kind.
      if (state.minMargin > movement) {
        state.minMargin -= movement;
        state.deferredTravel += movement;
        continue;
      }
      const step = movement + state.deferredTravel;
      state.deferredTravel = 0;
      const { kind, chunks, casts, shadowMax } = state;
      const lods = kind.lods;
      let kindMinMargin = Infinity;
      for (let ci = 0; ci < chunks.length; ci++) {
        const c = chunks[ci]!;
        if (c.margin > step) {
          c.margin -= step;
          if (c.margin < kindMinMargin) kindMinMargin = c.margin;
          continue;
        }
        // Level and shadow by the distance to the chunk's near edge, so a prop beside the eye is
        // never drawn at a reduced level because its chunk's centre is far away.
        const near = Math.max(0, c.centre.distanceTo(eye) - c.radius);
        let margin = Infinity;
        for (let i = 0; i < lods.length; i++) {
          const d = Math.abs(near - lods[i]!.maxDistance);
          if (d < margin) margin = d;
        }
        if (casts) {
          const d = Math.abs(near - shadowMax);
          if (d < margin) margin = d;
        }
        c.margin = margin;
        if (margin < kindMinMargin) kindMinMargin = margin;
        const lod = chunkLod(near, lods);
        const castNow = casts && near < shadowMax;
        if (lod === c.lod && castNow === c.casting) continue;
        if (c.levelBatches && c.lod !== lod) {
          const prev = c.lod >= 0 ? c.levelBatches[c.lod] : undefined;
          if (prev) {
            prev.dirty = true;
            anyLevelDirty = true;
          }
          const next = lod >= 0 ? c.levelBatches[lod] : undefined;
          if (next) {
            next.dirty = true;
            anyLevelDirty = true;
          }
        }
        if (c.shadowBatch && (c.casting && c.lod >= 0) !== (castNow && lod >= 0)) {
          c.shadowBatch.dirty = true;
          anyShadowDirty = true;
        }
        c.lod = lod;
        c.casting = castNow;
        const proxy = c.shadow;
        const hasShadowProxy = Boolean(proxy || c.shadowBatch);
        for (let i = 0; i < c.meshes.length; i++) {
          const im = c.meshes[i] as InstancedMesh;
          const active = i === lod;
          im.visible = active && !c.levelBatches?.[i];
          im.castShadow = active && castNow && !hasShadowProxy;
        }
        // Casts while a level is on show and within the shadow reach, like the level would.
        if (proxy) proxy.visible = castNow && lod >= 0;
      }
      state.minMargin = kindMinMargin;
    }
    if (anyLevelDirty || movement === Infinity) {
      for (const batch of this.levelBatches) {
        if (!batch.dirty) continue;
        let offset = 0;
        for (const c of batch.chunks) {
          if (c.lod !== batch.level) continue;
          const source = c.meshes[batch.level]!;
          if (offset === 0) batch.mesh.boundingSphere!.copy(source.boundingSphere!);
          else batch.mesh.boundingSphere!.union(source.boundingSphere!);
          batch.mesh.instanceMatrix.array.set(source.instanceMatrix.array, offset * 16);
          if (source.instanceColor)
            batch.mesh.instanceColor!.array.set(source.instanceColor.array, offset * 3);
          else batch.mesh.instanceColor?.array.fill(1, offset * 3, (offset + source.count) * 3);
          offset += source.count;
        }
        batch.mesh.count = offset;
        batch.mesh.visible = offset > 0;
        if (offset > 0) {
          batch.mesh.instanceMatrix.clearUpdateRanges();
          batch.mesh.instanceMatrix.addUpdateRange(0, offset * 16);
          batch.mesh.instanceMatrix.needsUpdate = true;
          if (batch.mesh.instanceColor) {
            batch.mesh.instanceColor.clearUpdateRanges();
            batch.mesh.instanceColor.addUpdateRange(0, offset * 3);
            batch.mesh.instanceColor.needsUpdate = true;
          }
        }
        batch.dirty = false;
      }
    }
    if (anyShadowDirty || movement === Infinity) {
      for (const batch of this.shadowBatches) {
        if (!batch.dirty) continue;
        let offset = 0;
        for (const c of batch.chunks) {
          if (!c.casting || c.lod < 0) continue;
          const source = c.meshes[batch.level]!;
          if (offset === 0) batch.mesh.boundingSphere!.copy(source.boundingSphere!);
          else batch.mesh.boundingSphere!.union(source.boundingSphere!);
          batch.mesh.instanceMatrix.array.set(source.instanceMatrix.array, offset * 16);
          offset += source.count;
        }
        batch.mesh.count = offset;
        batch.mesh.visible = offset > 0;
        if (offset > 0) {
          batch.mesh.instanceMatrix.clearUpdateRanges();
          batch.mesh.instanceMatrix.addUpdateRange(0, offset * 16);
          batch.mesh.instanceMatrix.needsUpdate = true;
        }
        batch.dirty = false;
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
    for (const b of this.levelBatches) b.mesh.dispose();
    this.levelBatches.length = 0;
    for (const b of this.shadowBatches) b.mesh.dispose();
    this.shadowBatches.length = 0;
    for (const chunks of this.chunks.values())
      for (const c of chunks) {
        for (const im of c.meshes) im.dispose();
        c.shadow?.dispose();
      }
    this.chunks.clear();
    this.kindStates.length = 0;
    this.hasLastEye = false;
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
