import { Color, MeshStandardMaterial, type Material } from 'three';
import type { Track } from '@undercut/track';
import type { LocalLight } from '../lighting/light-pool';
import type { PropCatalogEntry, PropKitAssets, PropLodOptions } from '../props/catalog';
import type { PropRegistry, Reflected } from '../props/registry';
import { footprintOnTrack } from './corridor';
import { hash01, inRing, type MappedFeature } from './dressing';
import type { LapIndex } from './lap-index';
import type { StandRun, StreetCircuit } from './theme';

/**
 * A street circuit's own furniture, from the kit (theme.ts `StreetCircuit`):
 * - the concrete blocks along every concrete barrier run of the track (the barrier polylines the
 *   track draws and collides with), the debris fence on top, terminal posts where a run ends;
 * - floodlight masts by the track file's lighting rule (`environment.floodlights.rule`), each
 *   mast's lamp bank one local light for the pooled lights at night;
 * - temporary scaffold stands on the authored runs, a spectator on the stand's seat rows, and a
 *   lighting truss over the fence in front of each.
 * Everything faces the track: local +X inward, +Z along the barrier.
 */
export interface StreetOptions {
  track: Track;
  lap: LapIndex;
  props: PropRegistry;
  kit: PropKitAssets;
  street: StreetCircuit;
  /** Mapped footprints a stand may not stand on (buildings, water). */
  obstacles: readonly MappedFeature[];
  heightAt: (x: number, z: number) => number;
  night: boolean;
  mobile: boolean;
  castShadows: boolean;
  /** Material for the kit block's board panel (the brand hoarding material), if any. */
  boardMaterial: Material | null;
  /** Owned by the world (released with it). */
  materials: Material[];
  /** Places one spectator (the world's crowd kinds); `k` picks variant and clothes. */
  spectator: (p: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    s: number;
    k: number;
    near?: boolean;
  }) => void;
  /** Fraction of seats taken. */
  crowd: number;
}

export interface StreetResult {
  counts: Record<string, number>;
  /** The floodlight banks, one local light each (world frame). */
  lights: LocalLight[];
}

/** Light of one mast's lamp bank: warm white, candela, reach (m). Set by eye under NIGHT_FLOODLIT. */
export const MAST_LIGHT = { colour: '#fff0d8', intensity: 900, distance: 70 };
/**
 * Where a bank's point light stands: ahead of the lamps (toward the track) and below them, m.
 * At the lamps themselves their own housing, centimetres away, would take the inverse-square
 * peak and bloom out of all proportion.
 */
const LIGHT_AHEAD = 1.5;
const LIGHT_DROP = 0.5;
/** One local light per this length of lighting truss, m, and its light. */
const TRUSS_LIGHT_EVERY = 12;
export const TRUSS_LIGHT = { colour: '#fff4e4', intensity: 500, distance: 45 };
/** The kit mast's lamps stand this high on the model, m (attachments `lamp-*`). */
const MAST_LAMP_FALLBACK = 13.15;
/** Clear ground between the back of the wall and a stand's front, m. */
const STAND_GAP = 2.2;
/** Width of the block (the debris fence stands on it), m. */
const BLOCK_WIDTH = 0.8;

const DEFAULT_RULE = { spacing: 40, stagger: 20, setback: 1, height: 10 };

function attachments(entry: PropCatalogEntry | undefined, prefix: string) {
  return (entry?.attachments ?? []).filter((a) => a.name.startsWith(prefix));
}

/** Emissive lamp material: lit at night (into the bloom), a pale lens by day. */
export function lampMaterial(night: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(0.82, 0.83, 0.8),
    emissive: new Color('#fff3df'),
    emissiveIntensity: night ? 1.2 : 0,
    roughness: 0.25,
    metalness: 0,
  });
  m.name = 'street-lamp';
  return m;
}

/** Window mask of the marina backdrops: warm lit windows at night, dark glass by day. */
export function windowMaterial(night: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: night ? new Color(0.16, 0.13, 0.09) : new Color(0.035, 0.045, 0.055),
    emissive: new Color('#ffd9a0'),
    emissiveIntensity: night ? 2.4 : 0,
    roughness: night ? 0.6 : 0.08,
    metalness: 0,
  });
  m.name = 'backdrop-windows';
  return m;
}

export function placeStreetCircuit(o: StreetOptions): StreetResult {
  const { track, lap, props, kit, street, heightAt } = o;
  const L = track.length;
  const wrap = (s: number): number => ((s % L) + L) % L;
  const counts: Record<string, number> = {};
  const lights: LocalLight[] = [];
  const scale = o.mobile ? 0.55 : 1;

  const lamps = lampMaterial(o.night);
  o.materials.push(lamps);
  const define = (
    id: string,
    kitId: string,
    options: PropLodOptions & {
      chunk?: number | undefined;
      shadow?: number;
      cast?: boolean;
      reflect?: Reflected;
    } = {},
  ): boolean => {
    const lods = kit.lodsFor(kitId, { maxDistanceScale: scale, ...options });
    if (!lods) return false;
    props.define({
      id,
      chunkLength: options.chunk,
      castShadow: (options.cast ?? true) && o.castShadows,
      shadowMaxDistance: options.shadow ?? 120,
      receiveShadow: true,
      lods,
      reflect: options.reflect,
    });
    return true;
  };

  // 1. Walls: blocks every 4 m along each concrete run, the fence on top, terminals at the ends.
  const blockEntry = kit.entries.get(street.block);
  const pitch = blockEntry?.moduleLength || 4;
  const fenceAt = blockEntry?.attachments?.find((a) => a.name === 'fence')?.position ?? [
    -0.12, 1.15, 0,
  ];
  const hasBlock = define('street-block', street.block, {
    chunk: o.mobile ? undefined : 60,
    reflect: 'scenery',
    ...(o.boardMaterial ? { materialOverrides: { 'board-face': o.boardMaterial } } : {}),
  });
  const hasFence = define('street-fence', street.fence, {
    chunk: o.mobile ? undefined : 60,
    reflect: 'scenery',
  });
  const hasEnd = define('street-fence-end', street.fenceEnd, { chunk: o.mobile ? undefined : 60 });
  // The block's face 3 cm proud of the barrier line, over the track's own concrete.
  const inset = (blockEntry?.bounds?.max[0] ?? 0.4) - 0.03;
  let blocks = 0;
  let fences = 0;
  let ends = 0;
  for (const bar of track.barriers) {
    if (bar.type !== 'concrete' || bar.side === 'pit') continue;
    const pts = bar.points;
    const m = pts.length / 3;
    if (m < 2) continue;
    // Arc length along the run.
    const arc = new Float64Array(m);
    for (let k = 1; k < m; k++)
      arc[k] =
        (arc[k - 1] as number) +
        Math.hypot(
          (pts[3 * k] as number) - (pts[3 * k - 3] as number),
          (pts[3 * k + 2] as number) - (pts[3 * k - 1] as number),
        );
    const total = arc[m - 1] as number;
    const count = Math.floor(total / pitch);
    if (count < 1) continue;
    // Spread the leftover evenly so the modules meet the run's ends.
    const step = total / count;
    let seg = 0;
    const at = (a: number) => {
      while (seg + 1 < m - 1 && (arc[seg + 1] as number) < a) seg++;
      while (seg > 0 && (arc[seg] as number) > a) seg--;
      const a0 = arc[seg] as number;
      const a1 = arc[seg + 1] as number;
      const t = a1 > a0 ? (a - a0) / (a1 - a0) : 0;
      const i = 3 * seg;
      const x = (pts[i] as number) + ((pts[i + 3] as number) - (pts[i] as number)) * t;
      const y = (pts[i + 1] as number) + ((pts[i + 4] as number) - (pts[i + 1] as number)) * t;
      const z = (pts[i + 2] as number) + ((pts[i + 5] as number) - (pts[i + 2] as number)) * t;
      const dl =
        Math.hypot(
          (pts[i + 3] as number) - (pts[i] as number),
          (pts[i + 5] as number) - (pts[i + 2] as number),
        ) || 1;
      const tx = ((pts[i + 3] as number) - (pts[i] as number)) / dl;
      const tz = ((pts[i + 5] as number) - (pts[i + 2] as number)) / dl;
      // Inward (toward the track): right of travel for the left barrier, left for the right.
      const ix = bar.side === 'left' ? -tz : tz;
      const iz = bar.side === 'left' ? tx : -tx;
      const sv = (bar.s[seg] as number) + ((bar.s[seg + 1] as number) - (bar.s[seg] as number)) * t;
      return { x, y, z, ix, iz, yaw: Math.atan2(-iz, ix), s: wrap(sv) };
    };
    for (let k = 0; k < count; k++) {
      const p = at((k + 0.5) * step);
      const bx = p.x - p.ix * inset;
      const bz = p.z - p.iz * inset;
      if (hasBlock) {
        props.place('street-block', { x: bx, y: p.y, z: bz, yaw: p.yaw, s: p.s });
        blocks++;
      }
      if (hasFence) {
        props.place('street-fence', {
          x: bx + p.ix * fenceAt[0],
          y: p.y + fenceAt[1],
          z: bz + p.iz * fenceAt[0],
          yaw: p.yaw,
          s: p.s,
        });
        fences++;
      }
    }
    if (hasEnd && !bar.closed) {
      for (const a of [0, total]) {
        const p = at(a);
        const bx = p.x - p.ix * inset;
        const bz = p.z - p.iz * inset;
        props.place('street-fence-end', {
          x: bx + p.ix * fenceAt[0],
          y: p.y + fenceAt[1],
          z: bz + p.iz * fenceAt[0],
          yaw: p.yaw,
          s: p.s,
        });
        ends++;
      }
    }
  }
  counts.streetBlocks = blocks;
  counts.debrisFences = fences;
  counts.fenceEnds = ends;

  // A point beside the lap: `back` metres behind the barrier at s, with the inward yaw.
  const tmp = { x: 0, y: 0, z: 0 };
  const behind = (s: number, side: 0 | 1, back: number) => {
    const sign = side === 0 ? 1 : -1;
    const bar = track.barrierAt(s, side);
    track.lap.pointAt(s, sign * (bar + back), tmp);
    const x = tmp.x;
    const z = tmp.z;
    track.lap.pointAt(s, sign * bar, tmp);
    const dx = tmp.x - x;
    const dz = tmp.z - z;
    const dl = Math.hypot(dx, dz) || 1;
    const ix = dx / dl;
    const iz = dz / dl;
    // Folded across a tight bend: the point is nearer another part of the lap than intended.
    const hit = lap.nearest(x, z);
    const folded = hit.dist < bar + back * 0.5;
    return { x, z, y: heightAt(x, z), ix, iz, yaw: Math.atan2(-iz, ix), folded, bar };
  };
  const pitSide: 0 | 1 = track.pit.side === 'left' ? 0 : 1;
  const inPitReach = (s: number): boolean => {
    const a = track.pit.entryS - 40;
    const b = track.pit.exitS + 40;
    return a <= b ? s >= a && s <= b : s >= a || s <= b;
  };

  // 2. Floodlight masts by the lighting rule, the lamp bank of each a pooled light at night.
  const rule = track.environment?.floodlights?.rule ?? DEFAULT_RULE;
  const mastEntry = kit.entries.get(street.mast);
  const mastLamps = attachments(mastEntry, 'lamp-');
  const lampY =
    mastLamps.length > 0
      ? mastLamps.reduce((a, l) => a + l.position[1], 0) / mastLamps.length
      : MAST_LAMP_FALLBACK;
  const lampX =
    mastLamps.length > 0
      ? mastLamps.reduce((a, l) => a + l.position[0], 0) / mastLamps.length
      : 0.4;
  const mastScale = rule.height / lampY;
  const hasMast = define('floodlight-mast', street.mast, {
    materialOverrides: { 'floodlight-emitter': lamps },
    shadow: 160,
    reflect: 'scenery',
  });
  let masts = 0;
  if (hasMast) {
    for (const side of [0, 1] as const) {
      const offset = side === 1 ? rule.stagger : 0;
      for (let s = offset; s < L; s += rule.spacing) {
        if (side === pitSide && inPitReach(s)) continue;
        const b = behind(s, side, BLOCK_WIDTH + rule.setback + 0.4);
        if (b.folded) continue;
        props.place('floodlight-mast', { x: b.x, y: b.y, z: b.z, yaw: b.yaw, s, scale: mastScale });
        lights.push({
          x: b.x + b.ix * (lampX * mastScale + LIGHT_AHEAD),
          y: b.y + lampY * mastScale - LIGHT_DROP,
          z: b.z + b.iz * (lampX * mastScale + LIGHT_AHEAD),
          ...MAST_LIGHT,
        });
        masts++;
      }
    }
  }
  counts.floodlightMasts = masts;

  // 3. Temporary stands with their crowd, and a lighting truss over the fence in front.
  const standEntry = kit.entries.get(street.stand);
  const standPitch = standEntry?.moduleLength || 8;
  const front = standEntry?.bounds?.max[0] ?? 3.21;
  const rear = -(standEntry?.bounds?.min[0] ?? -3.62);
  const rows = (standEntry?.attachments ?? []).filter((a) => a.name.startsWith('crowd-row-'));
  const hasStand = define('temporary-stand', street.stand, { shadow: 200, reflect: 'skyline' });
  const trussEntry = kit.entries.get(street.truss);
  const trussPitch = trussEntry?.moduleLength || 4;
  const trussLamps = attachments(trussEntry, 'lamp-');
  const hasTruss = define('lighting-truss', street.truss, {
    materialOverrides: { 'floodlight-emitter': lamps },
    chunk: o.mobile ? undefined : 60,
    cast: false,
    reflect: 'scenery',
  });
  const blocked = (x: number, z: number): boolean => {
    for (const f of o.obstacles) if (inRing(f.p, x, z)) return true;
    return false;
  };
  let standModules = 0;
  let seats = 0;
  let spectators = 0;
  let trusses = 0;
  let standCount = 0;
  const fenceTop = fenceAt[1] + (kit.entries.get(street.fence)?.bounds?.max[1] ?? 4.2);
  const runSpan = (r: StandRun): number => wrap(r.s1 - r.s0);
  for (const run of street.stands) {
    const side: 0 | 1 = run.side === 'left' ? 0 : 1;
    const span = runSpan(run);
    let placedHere = 0;
    if (hasStand) {
      for (let u = standPitch / 2; u <= span - standPitch / 2; u += standPitch) {
        const s = wrap(run.s0 + u);
        const b = behind(s, side, BLOCK_WIDTH + STAND_GAP + front);
        if (b.folded) continue;
        // The footprint's four corners clear of buildings and water.
        const ax = -b.iz;
        const az = b.ix;
        const corners = [
          [front, standPitch / 2],
          [front, -standPitch / 2],
          [-rear, standPitch / 2],
          [-rear, -standPitch / 2],
        ] as const;
        if (
          corners.some(([cx, cz]) => blocked(b.x + b.ix * cx + ax * cz, b.z + b.iz * cx + az * cz))
        )
          continue;
        props.place('temporary-stand', { x: b.x, y: b.y, z: b.z, yaw: b.yaw, s });
        standModules++;
        placedHere++;
        for (const r of rows) {
          const n = r.count ?? 12;
          const sp = r.spacing ?? 0.55;
          for (let j = 0; j < n; j++) {
            const k = seats++;
            if (hash01(k, 71) > o.crowd) continue;
            const lx = r.position[0];
            const lz = r.position[2] + j * sp + sp * 0.5;
            o.spectator({
              x: b.x + b.ix * lx + ax * lz,
              y: b.y + r.position[1],
              z: b.z + b.iz * lx + az * lz,
              yaw: b.yaw,
              s,
              k,
              near: true,
            });
            spectators++;
          }
        }
      }
    }
    if (placedHere > 0) standCount++;
    // The truss on the fence top, over the stand's whole run.
    if (hasTruss && placedHere > 0) {
      let sinceLight = TRUSS_LIGHT_EVERY;
      for (let u = trussPitch / 2; u <= span - trussPitch / 2; u += trussPitch) {
        const s = wrap(run.s0 + u);
        // On the fence line: behind the barrier by the block's inset and the fence's offset on it.
        const b = behind(s, side, inset - fenceAt[0]);
        if (b.folded) continue;
        props.place('lighting-truss', { x: b.x, y: b.y + fenceTop, z: b.z, yaw: b.yaw, s });
        trusses++;
        sinceLight += trussPitch;
        if (sinceLight >= TRUSS_LIGHT_EVERY && trussLamps.length > 0) {
          sinceLight = 0;
          const lamp = trussLamps[0] as { position: readonly [number, number, number] };
          lights.push({
            x: b.x + b.ix * (lamp.position[0] + LIGHT_AHEAD),
            y: b.y + fenceTop + lamp.position[1] - LIGHT_DROP,
            z: b.z + b.iz * (lamp.position[0] + LIGHT_AHEAD),
            ...TRUSS_LIGHT,
          });
        }
      }
    }
  }
  counts.tempStands = standCount;
  counts.tempStandModules = standModules;
  counts.crowd = spectators;
  counts.lightingTrusses = trusses;
  counts.localLights = lights.length;
  return { counts, lights };
}

/** A kit backdrop standing in for one mapped building. */
export interface Backdrop {
  /** The mapped building it replaces. */
  feature: string;
  kitId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  s: number;
}

/**
 * The mapped buildings near the track small and low enough for one of the kit's backdrops: the
 * first backdrop whose height the building's (mapped, or from its footprint) fits, laid along the
 * footprint's longest side with its front (+X) to the track and scaled to the footprint's area.
 */
export function pickBackdrops(
  features: readonly MappedFeature[],
  lap: LapIndex,
  heightAt: (x: number, z: number) => number,
  street: StreetCircuit,
  kit: PropKitAssets,
  heightOf: (area: number, tags: Record<string, string>) => number,
): Backdrop[] {
  const out: Backdrop[] = [];
  const hit = { index: 0, s: 0, d: 0, dist: 0 };
  for (const f of features) {
    const p = f.p;
    let m = p.length / 2;
    if (m >= 2 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) m--;
    if (m < 3) continue;
    let area = 0;
    let cx = 0;
    let cz = 0;
    let longest = 0;
    let ex = 1;
    let ez = 0;
    let ymin = Infinity;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const x0 = p[2 * i] as number;
      const z0 = p[2 * i + 1] as number;
      const x1 = p[2 * j] as number;
      const z1 = p[2 * j + 1] as number;
      area += x0 * z1 - x1 * z0;
      cx += x0;
      cz += z0;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len > longest) {
        longest = len;
        ex = (x1 - x0) / len;
        ez = (z1 - z0) / len;
      }
      ymin = Math.min(ymin, heightAt(x0, z0));
    }
    area = Math.abs(area) / 2;
    cx /= m;
    cz /= m;
    if (area < 60 || area > 1500) continue;
    if (footprintOnTrack(p, lap)) continue;
    lap.nearest(cx, cz, hit);
    if (hit.dist - lap.barrierAt(hit.index, hit.d) > street.backdropReach) continue;
    const h = heightOf(area, f.t ?? {});
    const pick = street.backdrops.find((b) => h <= b.maxHeight && kit.has(b.id));
    if (!pick) continue;
    const b = kit.entries.get(pick.id)?.bounds;
    const w = b ? b.max[0] - b.min[0] : 12;
    const d = b ? b.max[2] - b.min[2] : 18;
    // Front (+X) across the longest side, turned to whichever side is nearer the track.
    let nx = ez;
    let nz = -ex;
    const dist = hit.dist;
    if (lap.nearest(cx + nx * 10, cz + nz * 10).dist > dist) {
      nx = -nx;
      nz = -nz;
    }
    out.push({
      feature: f.id,
      kitId: pick.id,
      x: cx,
      y: (Number.isFinite(ymin) ? ymin : 0) - 0.2,
      z: cz,
      yaw: Math.atan2(-nz, nx),
      scale: Math.min(1.5, Math.max(0.7, Math.sqrt(area / (w * d)))),
      s: hit.s,
    });
  }
  return out;
}
