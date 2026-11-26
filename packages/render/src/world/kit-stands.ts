import { BufferAttribute, BufferGeometry, type Material } from 'three';
import type { PropKitAssets } from '../props/catalog';
import type { PropRegistry } from '../props/registry';
import { hash01 } from './dressing';
import type { StandFrame } from './grandstands';

export interface KitSpectator {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  k: number;
  near?: boolean;
}

type Vec3 = readonly [number, number, number];

export class KitHullBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly pbr: number[] = [];
  private readonly idx: number[] = [];

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: Vec3, pbr: Vec3): void {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = d[0] - a[0],
      vy = d[1] - a[1],
      vz = d[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(colour[0], colour[1], colour[2]);
      this.pbr.push(pbr[0], pbr[1], pbr[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    colour: Vec3,
    pbr: Vec3,
  ): void {
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], colour, pbr); // +X
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], colour, pbr); // -X
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], colour, pbr); // +Y
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], colour, pbr); // -Y
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], colour, pbr); // +Z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], colour, pbr); // -Z
  }

  slopedSlab(
    xFront: number,
    yFront: number,
    xBack: number,
    yBack: number,
    thick: number,
    z0: number,
    z1: number,
    topColour: Vec3,
    topPbr: Vec3,
    bodyColour: Vec3,
    bodyPbr: Vec3,
  ): void {
    const f0 = yFront - thick,
      b0 = yBack - thick;
    this.quad(
      [xBack, yBack, z1],
      [xFront, yFront, z1],
      [xFront, yFront, z0],
      [xBack, yBack, z0],
      topColour,
      topPbr,
    );
    this.quad(
      [xBack, b0, z0],
      [xFront, f0, z0],
      [xFront, f0, z1],
      [xBack, b0, z1],
      bodyColour,
      bodyPbr,
    );
    this.quad(
      [xFront, f0, z1],
      [xFront, f0, z0],
      [xFront, yFront, z0],
      [xFront, yFront, z1],
      bodyColour,
      bodyPbr,
    );
    this.quad(
      [xBack, b0, z0],
      [xBack, b0, z1],
      [xBack, yBack, z1],
      [xBack, yBack, z0],
      bodyColour,
      bodyPbr,
    );
    this.quad(
      [xBack, b0, z1],
      [xFront, f0, z1],
      [xFront, yFront, z1],
      [xBack, yBack, z1],
      bodyColour,
      bodyPbr,
    );
    this.quad(
      [xFront, f0, z0],
      [xBack, b0, z0],
      [xBack, yBack, z0],
      [xFront, yFront, z0],
      bodyColour,
      bodyPbr,
    );
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aPropPbr', new BufferAttribute(new Float32Array(this.pbr), 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const CONCRETE_COL: Vec3 = [0.332, 0.328, 0.301];
const CONCRETE_PBR: Vec3 = [0.88, 0.02, 0];
const STEEL_COL: Vec3 = [0.337, 0.366, 0.392];
const STEEL_PBR: Vec3 = [0.42, 0.72, 0];
const DARK_STEEL_COL: Vec3 = [0.053, 0.06, 0.067];
const DARK_STEEL_PBR: Vec3 = [0.48, 0.65, 0];
const SEAT_COL: Vec3 = [0.85, 0.85, 0.85];
const SEAT_PBR: Vec3 = [0.65, 0.05, 1];
const PAINT_COL: Vec3 = [0.65, 0.68, 0.72];
const PAINT_PBR: Vec3 = [0.4, 0.08, 0];

/**
 * Low-triangle silhouette matching `grandstand` / `grandstand-roof` bounds and materials: used
 * beyond 320 m (skyline + bay reflections) and in the shadow pass so distant and shadowed stands
 * keep their exact silhouette without drawing sub-pixel seats and handrails.
 */
function standHullGeometry(roof: boolean): BufferGeometry {
  const b = new KitHullBuilder();
  b.box(4.6, 0, -5, 4.76, 1.64, 5, CONCRETE_COL, CONCRETE_PBR);
  b.slopedSlab(
    4.68,
    1.68,
    -4.65,
    5.95,
    0.45,
    -5,
    5,
    SEAT_COL,
    SEAT_PBR,
    CONCRETE_COL,
    CONCRETE_PBR,
  );
  b.box(-4.7, 5.5, -5, -4.6, 6.9, 5, STEEL_COL, STEEL_PBR);
  const colTop = roof ? 8.7 : 5.8;
  for (const z of [-4.7, 4.7]) {
    b.box(-4.74, 0, z - 0.14, -4.46, colTop, z + 0.14, DARK_STEEL_COL, DARK_STEEL_PBR);
  }
  if (roof) {
    b.slopedSlab(5.05, 9.28, -4.9, 8.58, 0.18, -5, 5, STEEL_COL, STEEL_PBR, STEEL_COL, STEEL_PBR);
    b.box(4.99, 9.01, -5, 5.11, 9.43, 5, PAINT_COL, PAINT_PBR);
  }
  return b.build();
}

/** Tile human-scale ten-row banks into the mapped footprint; rear banks step up by ten risers. */
/** Seat surface to the front of a bench, behind a seated figure's shins (row origin = seat). */
const BENCH_FRONT = 0.26;
/** Seat surface to the back of a bench: the seat pan's rear edge on the middle level. */
const BENCH_BACK = 0.16;
/** Seat surface above the tread's top, the dressing stand's row constant. */
const SEAT_HEIGHT = 0.42;

/**
 * Reshape the far level's seat band in each row (a block standing proud of the seat surface,
 * drawn for distance) into a solid bench whose top is the seat surface, in place. Mobile draws
 * the far level up close: on the band, seated figures sank to the hips with their legs over bare
 * treads; on the bench they sit on it, feet on the tread. Same vertices and triangles.
 * `rows` are the kit's `crowd-row-*` attachments, whose origins are seat surfaces.
 */
export function benchSeatRows(
  geometry: BufferGeometry,
  rows: readonly { name: string; position: readonly number[] }[],
): number {
  const seats = rows
    .filter((a) => a.name.startsWith('crowd-row-'))
    .map((a) => ({ x: a.position[0]!, y: a.position[1]! }));
  const pos = geometry.getAttribute('position');
  const col = geometry.getAttribute('color');
  if (!col || seats.length === 0) return 0;
  let moved = 0;
  for (let v = 0; v < pos.count; v++) {
    // The seat slot is white (slotColors), tinted per stand; no other slot is.
    if (col.getX(v) !== 1 || col.getY(v) !== 1 || col.getZ(v) !== 1) continue;
    const x = pos.getX(v),
      y = pos.getY(v);
    const row = seats.find((r) => Math.abs(x - r.x) < 0.3 && y > r.y - 0.3 && y < r.y + 0.3);
    if (!row) continue;
    pos.setX(v, x > row.x ? row.x + BENCH_FRONT : row.x - BENCH_BACK);
    // Down to the tread's top (inside the tread, never below it: a raised bank's columns stretch
    // only under 1.6 m), up to the seat surface.
    pos.setY(v, y > row.y ? row.y : row.y - SEAT_HEIGHT);
    moved++;
  }
  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  return moved;
}

export function placeKitStands(
  frames: readonly StandFrame[],
  kit: PropKitAssets | null | undefined,
  props: PropRegistry,
  /** Share of seats taken in a stand's row (0 = front), the same rule as the procedural stands. */
  occupancy: (frame: StandFrame, row: number) => number,
  shadows: boolean,
  spectator: (seat: KitSpectator) => void,
  /** Material for the far level (the kit's without its sub-pixel grain); owned by the caller. */
  farMaterial?: Material,
  /** Mobile preset: skip individual seat pans, hand over to the hull at 160 m, and batch wider. */
  mobile = false,
): { fallback: StandFrame[]; modules: number; crowd: number; geometries: BufferGeometry[] } {
  const result = {
    fallback: [] as StandFrame[],
    modules: 0,
    crowd: 0,
    geometries: [] as BufferGeometry[],
  };
  // One kind per kit model and bank height, shared by every stand: the stand's footprint fit is
  // a per-instance stretch, never baked into geometry (a copy per stand cost hundreds of MiB).
  const kinds = new Map<string, string>();
  const kindFor = (kitId: string, bank: number): string => {
    const key = `${kitId}-${bank}`;
    let id = kinds.get(key);
    if (id) return id;
    const rawLods = kit!.lodsFor(kitId, {
      maxDistanceScale: 2.7,
      // The middle level (4,900 to 5,100 triangles a module) only within 25 m, the modelled far
      // level (1,080 to 1,288) to 320 m, and the silhouette hull beyond to 3,240 m.
      distanceCaps: [8 / 2.7, 25 / 2.7, 1200],
      slotColors: { seat: [1, 1, 1] },
    })!;
    // On Mobile, drop the seat-pan middle level (4,880 to 5,088 tris) and draw the modelled far
    // level (1,080 to 1,288 tris: treads, risers, columns, handrails and roof framing intact) up
    // close, handing over to the hull at 160 m.
    const lods = mobile && rawLods.length > 1 ? [rawLods[rawLods.length - 1]!] : rawLods;
    for (const l of rawLods) if (!lods.includes(l)) l.geometry.dispose();
    const far = lods[lods.length - 1]!;
    if (mobile) benchSeatRows(far.geometry, kit!.entries.get(kitId)?.attachments ?? []);
    const skylineReach = far.maxDistance;
    far.maxDistance = Math.min(far.maxDistance, mobile ? 160 : 320);
    if (farMaterial && !Array.isArray(far.material)) far.material = farMaterial;
    const hull = standHullGeometry(kitId.endsWith('roof'));
    result.geometries.push(hull);
    lods.push({
      geometry: hull,
      material: farMaterial ?? far.material,
      maxDistance: skylineReach,
    });
    const rise = bank * 4.2;
    if (rise > 0)
      for (const lod of lods) {
        const positions = lod.geometry.getAttribute('position');
        // Extend the bottom columns and fascia down to the ground under a raised bank.
        for (let v = 0; v < positions.count; v++) {
          const y = positions.getY(v);
          if (y < 1.6) positions.setY(v, y - rise * (1 - Math.max(0, y) / 1.6));
        }
        lod.geometry.computeBoundingSphere();
      }
    id = `stand-kit-${key}`;
    // Shadows from the silhouette hull (60 to 84 triangles a module, against 1,080 to 1,288 for
    // the modelled far level), in the shadow pass only, to 100 m: the cascades draw every caster
    // once each.
    props.define({
      id,
      lods,
      // 40 m cells: a cell's level goes by its near edge, so 100 m cells drew a whole block of
      // banks at the middle level from the stand beside the grid. Larger cells for the far level
      // alone (a separate kind handed over per module) measured 0.7 to 1.5 ms dearer at Monza
      // on High: every cascade drew whole 200 m cells of shadow casters.
      gridCell: 40,
      // Batch distant hull cells, mid-range stand banks, and active shadow cells independently of
      // the fine 40 m cells selecting levels and shadow reach.
      farBatchCell: mobile ? 800 : 360,
      nearBatchCell: mobile ? 360 : 160,
      shadowBatchCell: 160,
      // The bay reflects the stands as it does the temporary ones (world/water.ts).
      reflect: 'skyline',
      castShadow: shadows,
      shadowMaxDistance: 100,
      shadowLevel: lods.length - 1,
    });
    kinds.set(key, id);
    return id;
  };
  for (const [i, frame] of frames.entries()) {
    if (!kit?.has('grandstand') || (frame.roof && !kit.has('grandstand-roof'))) {
      result.fallback.push(frame);
      continue;
    }
    const banks = Math.max(1, Math.round(frame.rows / 10));
    const n = Math.max(1, Math.round(frame.length / 10));
    const pitch = frame.length / n;
    const sx = frame.depth / (9.47 + (banks - 1) * 8.5);
    const sz = pitch / 10;
    const yaw = Math.atan2(frame.bz, -frame.bx);
    for (let bank = 0; bank < banks; bank++) {
      const kitId = frame.roof && bank === banks - 1 ? 'grandstand-roof' : 'grandstand';
      const entry = kit.entries.get(kitId)!;
      const id = kindFor(kitId, bank);
      const rise = bank * 4.2;
      for (let module = 0; module < n; module++) {
        const depth = (4.76 + bank * 8.5) * sx;
        const x = frame.ox + frame.ax * ((module + 0.5) * pitch) + frame.bx * depth;
        const z = frame.oz + frame.az * ((module + 0.5) * pitch) + frame.bz * depth;
        const y = frame.base + rise;
        const placement = { x, y, z, yaw, stretch: [sx, 1, sz] as const, s: frame.s };
        props.place(id, { ...placement, colour: frame.seat });
        result.modules++;
        for (const [row, marker] of (entry.attachments ?? [])
          .filter((a) => a.name.startsWith('crowd-row-'))
          .entries()) {
          for (let j = 0; j < (marker.count ?? 0); j++) {
            const k = i * 1000000 + bank * 100000 + module * 1000 + row * 30 + j;
            if (hash01(k, 77) > occupancy(frame, bank * 10 + row)) continue;
            const lx = marker.position[0] * sx;
            const lz = (marker.position[2] + j * (marker.spacing ?? 0.55)) * sz;
            spectator({
              x: x - frame.bx * lx + frame.ax * lz,
              y: y + marker.position[1],
              z: z - frame.bz * lx + frame.az * lz,
              yaw,
              s: frame.s,
              k,
              near: true,
            });
            result.crowd++;
          }
        }
      }
    }
  }
  return result;
}
