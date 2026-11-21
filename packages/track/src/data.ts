/**
 * The committed track file format (`packages/track/data/<id>.json`), written by
 * tools/track-pipeline and checked here before anything is built from it.
 *
 * Arrays under `centreline` have one entry per sample; sample i sits at s = i * length / sampleCount.
 * Lateral zone tables are run-length encoded as `[firstSample, value]` pairs: a value holds from
 * its sample to the next pair's sample (and the last one to the end of the lap). Offsets are
 * metres from the centreline, measured outward on that side.
 */

export const TRACK_FORMAT = 'undercut-track';
export const TRACK_FORMAT_VERSION = 1;

export type Side = 'left' | 'right';
export type RunoffKind = 'asphalt' | 'grass' | 'gravel';
export type BarrierType = 'armco' | 'concrete' | 'tyres' | 'fence';
export const RUNOFF_KINDS: readonly RunoffKind[] = ['asphalt', 'grass', 'gravel'];
export const BARRIER_TYPES: readonly BarrierType[] = ['armco', 'concrete', 'tyres', 'fence'];

export type Run<T> = readonly [number, T];

export interface KerbProfileData {
  name: string;
  /** Cross-section `[u, h]` from the kerb's inner edge outward; the last u is the kerb width. */
  points: readonly (readonly [number, number])[];
  /** Range of u that is a raised (sausage) kerb with lower grip, or null. */
  high: readonly [number, number] | null;
}

export interface SideData {
  kerb: readonly Run<string | null>[];
  /** Surface between the kerb (or the white line) and `split`. */
  inner: readonly Run<RunoffKind>[];
  /** Surface between `split` and `barrier`. */
  outer: readonly Run<RunoffKind>[];
  split: readonly number[];
  barrier: readonly number[];
  barrierType: readonly Run<BarrierType>[];
}

export interface CornerData {
  number: number;
  name: string;
  direction: Side;
  /** Apex: the curvature peak. */
  s: number;
  start: number;
  end: number;
}

export interface DrsZoneData {
  detection: number;
  activation: number;
  end: number;
}

export interface TrackPoint {
  s: number;
  d: number;
}

export interface PitData {
  side: Side;
  /** Lap s where the pit lane leaves the track, and where it rejoins. */
  entryS: number;
  exitS: number;
  /** Length of the pit-lane path; s_pit runs from 0 at the entry to this at the exit. */
  length: number;
  /** Pit-lane speed limit in m/s. */
  speedLimit: number;
  limitStart: number;
  limitEnd: number;
  x: readonly number[];
  y: readonly number[];
  z: readonly number[];
  halfWidthLeft: readonly number[];
  halfWidthRight: readonly number[];
  /** Box stop positions in the pit frame. */
  boxes: readonly TrackPoint[];
  /** s_pit range of the garage-side wall. */
  garageWall: readonly [number, number];
}

export interface TrackData {
  format: typeof TRACK_FORMAT;
  version: typeof TRACK_FORMAT_VERSION;
  id: string;
  name: string;
  country: string;
  direction: 'clockwise' | 'anticlockwise';
  /** Official lap length; s runs over [0, length). */
  length: number;
  sampleCount: number;
  /** WGS84 origin of the world frame and the height (EGM2008) of world y = 0. */
  origin: { lat: number; lon: number; datum: number };
  /** Provenance: sources, fetch records, scale factor, licence and attribution. */
  source: {
    pipelineVersion: string;
    scale: number;
    licence: string;
    attribution: readonly string[];
    [key: string]: unknown;
  };
  centreline: {
    x: readonly number[];
    y: readonly number[];
    z: readonly number[];
    /** Crossfall angle in radians; positive raises the left edge. */
    bank: readonly number[];
    halfWidthLeft: readonly number[];
    halfWidthRight: readonly number[];
  };
  /** Width of the white line inside each track edge. */
  lineWidth: number;
  kerbProfiles: readonly KerbProfileData[];
  sides: { left: SideData; right: SideData };
  corners: readonly CornerData[];
  timing: { sectors: readonly number[]; speedTrap: number; drs: readonly DrsZoneData[] };
  grid: readonly TrackPoint[];
  pit: PitData;
}

export class TrackDataError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid track data:\n  ${problems.slice(0, 20).join('\n  ')}`);
    this.name = 'TrackDataError';
    this.problems = problems;
  }
}

type Obj = Record<string, unknown>;

class Checker {
  readonly problems: string[] = [];

  fail(path: string, msg: string): void {
    this.problems.push(`${path}: ${msg}`);
  }

  obj(v: unknown, path: string, keys: readonly string[], extra = false): Obj | null {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      this.fail(path, 'expected an object');
      return null;
    }
    const o = v as Obj;
    for (const k of keys) if (!(k in o)) this.fail(`${path}.${k}`, 'missing');
    if (!extra)
      for (const k of Object.keys(o))
        if (!keys.includes(k)) this.fail(`${path}.${k}`, 'unknown key');
    return o;
  }

  num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(path, 'expected a finite number');
      return Number.NaN;
    }
    if (v < min || v > max) this.fail(path, `${v} is outside [${min}, ${max}]`);
    return v;
  }

  int(v: unknown, path: string, min: number, max: number): number {
    const n = this.num(v, path, min, max);
    if (Number.isFinite(n) && !Number.isInteger(n)) this.fail(path, 'expected an integer');
    return n;
  }

  str(v: unknown, path: string): string {
    if (typeof v !== 'string' || v.length === 0) {
      this.fail(path, 'expected a non-empty string');
      return '';
    }
    return v;
  }

  oneOf<T extends string>(v: unknown, path: string, options: readonly T[]): T {
    if (typeof v !== 'string' || !options.includes(v as T)) {
      this.fail(path, `expected one of ${options.join(', ')}`);
    }
    return v as T;
  }

  numbers(v: unknown, path: string, length: number, min = -Infinity, max = Infinity): void {
    if (!Array.isArray(v)) {
      this.fail(path, 'expected an array');
      return;
    }
    if (v.length !== length) this.fail(path, `expected ${length} entries, found ${v.length}`);
    for (let i = 0; i < v.length; i++) {
      const x: unknown = v[i];
      if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) {
        this.fail(`${path}[${i}]`, `expected a finite number in [${min}, ${max}]`);
        return;
      }
    }
  }

  runs<T>(v: unknown, path: string, n: number, valid: (x: unknown) => x is T): void {
    if (!Array.isArray(v) || v.length === 0) {
      this.fail(path, 'expected a non-empty array of runs');
      return;
    }
    let last = -1;
    v.forEach((r: unknown, i) => {
      if (!Array.isArray(r) || r.length !== 2) {
        this.fail(`${path}[${i}]`, 'expected [firstSample, value]');
        return;
      }
      const first: unknown = r[0];
      if (typeof first !== 'number' || !Number.isInteger(first) || first <= last || first >= n) {
        this.fail(`${path}[${i}]`, 'run starts must be increasing integer sample indices');
      } else {
        last = first;
      }
      if (i === 0 && first !== 0) this.fail(`${path}[0]`, 'the first run must start at sample 0');
      if (!valid(r[1])) this.fail(`${path}[${i}]`, `invalid value ${JSON.stringify(r[1])}`);
    });
  }
}

const isRunoff = (x: unknown): x is RunoffKind => RUNOFF_KINDS.includes(x as RunoffKind);
const isBarrier = (x: unknown): x is BarrierType => BARRIER_TYPES.includes(x as BarrierType);

/**
 * Checks that `raw` is a complete, internally consistent track file and returns it typed.
 * Throws `TrackDataError` listing every problem found. Unknown keys are rejected, except inside
 * `source`, which carries free-form provenance.
 */
export function validateTrackData(raw: unknown): TrackData {
  const c = new Checker();
  const top = c.obj(raw, 'track', [
    'format',
    'version',
    'id',
    'name',
    'country',
    'direction',
    'length',
    'sampleCount',
    'origin',
    'source',
    'centreline',
    'lineWidth',
    'kerbProfiles',
    'sides',
    'corners',
    'timing',
    'grid',
    'pit',
  ]);
  if (!top) throw new TrackDataError(c.problems);
  if (top.format !== TRACK_FORMAT) c.fail('track.format', `expected "${TRACK_FORMAT}"`);
  if (top.version !== TRACK_FORMAT_VERSION) {
    c.fail('track.version', `expected ${TRACK_FORMAT_VERSION}, found ${String(top.version)}`);
  }
  c.str(top.id, 'track.id');
  c.str(top.name, 'track.name');
  c.str(top.country, 'track.country');
  c.oneOf(top.direction, 'track.direction', ['clockwise', 'anticlockwise']);
  const L = c.num(top.length, 'track.length', 500, 30000);
  const n = c.int(top.sampleCount, 'track.sampleCount', 100, 100000);
  if (!Number.isFinite(L) || !Number.isFinite(n)) throw new TrackDataError(c.problems);
  const inLap = (v: unknown, path: string): number => c.num(v, path, 0, L);

  const origin = c.obj(top.origin, 'track.origin', ['lat', 'lon', 'datum']);
  if (origin) {
    c.num(origin.lat, 'track.origin.lat', -90, 90);
    c.num(origin.lon, 'track.origin.lon', -180, 180);
    c.num(origin.datum, 'track.origin.datum', -500, 9000);
  }
  const source = c.obj(
    top.source,
    'track.source',
    ['pipelineVersion', 'scale', 'licence', 'attribution'],
    true,
  );
  if (source) {
    c.str(source.pipelineVersion, 'track.source.pipelineVersion');
    c.num(source.scale, 'track.source.scale', 0.99, 1.01);
    c.str(source.licence, 'track.source.licence');
    if (!Array.isArray(source.attribution) || source.attribution.length === 0) {
      c.fail('track.source.attribution', 'expected a non-empty array of strings');
    } else {
      source.attribution.forEach((a: unknown, i) => c.str(a, `track.source.attribution[${i}]`));
    }
  }

  const cl = c.obj(top.centreline, 'track.centreline', [
    'x',
    'y',
    'z',
    'bank',
    'halfWidthLeft',
    'halfWidthRight',
  ]);
  if (cl) {
    for (const k of ['x', 'z'] as const)
      c.numbers(cl[k], `track.centreline.${k}`, n, -20000, 20000);
    c.numbers(cl.y, 'track.centreline.y', n, -2000, 2000);
    c.numbers(cl.bank, 'track.centreline.bank', n, -0.35, 0.35);
    c.numbers(cl.halfWidthLeft, 'track.centreline.halfWidthLeft', n, 2, 30);
    c.numbers(cl.halfWidthRight, 'track.centreline.halfWidthRight', n, 2, 30);
  }
  c.num(top.lineWidth, 'track.lineWidth', 0.05, 0.5);

  const profileNames: string[] = [];
  if (!Array.isArray(top.kerbProfiles) || top.kerbProfiles.length === 0) {
    c.fail('track.kerbProfiles', 'expected a non-empty array');
  } else {
    top.kerbProfiles.forEach((p: unknown, i) => {
      const path = `track.kerbProfiles[${i}]`;
      const o = c.obj(p, path, ['name', 'points', 'high']);
      if (!o) return;
      profileNames.push(c.str(o.name, `${path}.name`));
      const pts = o.points;
      if (!Array.isArray(pts) || pts.length < 2) {
        c.fail(`${path}.points`, 'expected at least two [u, h] points');
        return;
      }
      let lastU = -Infinity;
      pts.forEach((q: unknown, j) => {
        if (!Array.isArray(q) || q.length !== 2) {
          c.fail(`${path}.points[${j}]`, 'expected [u, h]');
          return;
        }
        const u = c.num(q[0], `${path}.points[${j}][0]`, 0, 5);
        c.num(q[1], `${path}.points[${j}][1]`, -0.1, 0.3);
        if (u <= lastU) c.fail(`${path}.points[${j}]`, 'u must increase');
        lastU = u;
      });
      const first = pts[0] as unknown[];
      const last = pts[pts.length - 1] as unknown[];
      if (first[0] !== 0 || first[1] !== 0 || last[1] !== 0) {
        c.fail(
          `${path}.points`,
          'a kerb must start at [0, 0] and end at height 0 so the ground stays continuous',
        );
      }
      if (o.high !== null) {
        if (!Array.isArray(o.high) || o.high.length !== 2)
          c.fail(`${path}.high`, 'expected [u0, u1] or null');
        else {
          c.num(o.high[0], `${path}.high[0]`, 0, lastU);
          c.num(o.high[1], `${path}.high[1]`, 0, lastU);
        }
      }
    });
  }

  const sides = c.obj(top.sides, 'track.sides', ['left', 'right']);
  if (sides) {
    for (const side of ['left', 'right'] as const) {
      const path = `track.sides.${side}`;
      const s = c.obj(sides[side], path, [
        'kerb',
        'inner',
        'outer',
        'split',
        'barrier',
        'barrierType',
      ]);
      if (!s) continue;
      c.runs(
        s.kerb,
        `${path}.kerb`,
        n,
        (x): x is string | null => x === null || profileNames.includes(x as string),
      );
      c.runs(s.inner, `${path}.inner`, n, isRunoff);
      c.runs(s.outer, `${path}.outer`, n, isRunoff);
      c.numbers(s.split, `${path}.split`, n, 2, 500);
      c.numbers(s.barrier, `${path}.barrier`, n, 2, 500);
      c.runs(s.barrierType, `${path}.barrierType`, n, isBarrier);
    }
  }

  if (!Array.isArray(top.corners) || top.corners.length === 0)
    c.fail('track.corners', 'expected a non-empty array');
  else {
    top.corners.forEach((v: unknown, i) => {
      const path = `track.corners[${i}]`;
      const o = c.obj(v, path, ['number', 'name', 'direction', 's', 'start', 'end']);
      if (!o) return;
      if (o.number !== i + 1)
        c.fail(`${path}.number`, `expected ${i + 1}: corners are numbered in lap order`);
      c.str(o.name, `${path}.name`);
      c.oneOf(o.direction, `${path}.direction`, ['left', 'right']);
      inLap(o.s, `${path}.s`);
      inLap(o.start, `${path}.start`);
      inLap(o.end, `${path}.end`);
    });
  }

  const timing = c.obj(top.timing, 'track.timing', ['sectors', 'speedTrap', 'drs']);
  if (timing) {
    if (!Array.isArray(timing.sectors) || timing.sectors.length < 2 || timing.sectors[0] !== 0) {
      c.fail('track.timing.sectors', 'expected sector start positions beginning with 0');
    } else {
      timing.sectors.forEach((v: unknown, i) => {
        inLap(v, `track.timing.sectors[${i}]`);
        if (i > 0 && (v as number) <= (timing.sectors as number[])[i - 1]!) {
          c.fail(`track.timing.sectors[${i}]`, 'sector starts must increase');
        }
      });
    }
    inLap(timing.speedTrap, 'track.timing.speedTrap');
    if (!Array.isArray(timing.drs)) c.fail('track.timing.drs', 'expected an array');
    else {
      timing.drs.forEach((v: unknown, i) => {
        const o = c.obj(v, `track.timing.drs[${i}]`, ['detection', 'activation', 'end']);
        if (!o) return;
        for (const k of ['detection', 'activation', 'end'])
          inLap(o[k], `track.timing.drs[${i}].${k}`);
      });
    }
  }

  if (!Array.isArray(top.grid) || top.grid.length === 0)
    c.fail('track.grid', 'expected a non-empty array');
  else {
    top.grid.forEach((v: unknown, i) => {
      const o = c.obj(v, `track.grid[${i}]`, ['s', 'd']);
      if (!o) return;
      inLap(o.s, `track.grid[${i}].s`);
      c.num(o.d, `track.grid[${i}].d`, -30, 30);
    });
  }

  const pit = c.obj(top.pit, 'track.pit', [
    'side',
    'entryS',
    'exitS',
    'length',
    'speedLimit',
    'limitStart',
    'limitEnd',
    'x',
    'y',
    'z',
    'halfWidthLeft',
    'halfWidthRight',
    'boxes',
    'garageWall',
  ]);
  if (pit) {
    c.oneOf(pit.side, 'track.pit.side', ['left', 'right']);
    inLap(pit.entryS, 'track.pit.entryS');
    inLap(pit.exitS, 'track.pit.exitS');
    const pl = c.num(pit.length, 'track.pit.length', 50, 5000);
    c.num(pit.speedLimit, 'track.pit.speedLimit', 5, 50);
    const ls = c.num(pit.limitStart, 'track.pit.limitStart', 0, pl);
    const le = c.num(pit.limitEnd, 'track.pit.limitEnd', 0, pl);
    if (ls >= le) c.fail('track.pit.limitStart', 'the speed limit must start before it ends');
    const m = Array.isArray(pit.x) ? pit.x.length : 0;
    if (m < 2) c.fail('track.pit.x', 'expected at least two samples');
    for (const k of ['x', 'z'] as const) c.numbers(pit[k], `track.pit.${k}`, m, -20000, 20000);
    c.numbers(pit.y, 'track.pit.y', m, -2000, 2000);
    c.numbers(pit.halfWidthLeft, 'track.pit.halfWidthLeft', m, 1, 30);
    c.numbers(pit.halfWidthRight, 'track.pit.halfWidthRight', m, 1, 30);
    if (!Array.isArray(pit.boxes)) c.fail('track.pit.boxes', 'expected an array');
    else {
      pit.boxes.forEach((v: unknown, i) => {
        const o = c.obj(v, `track.pit.boxes[${i}]`, ['s', 'd']);
        if (!o) return;
        c.num(o.s, `track.pit.boxes[${i}].s`, 0, pl);
        c.num(o.d, `track.pit.boxes[${i}].d`, -30, 30);
      });
    }
    if (!Array.isArray(pit.garageWall) || pit.garageWall.length !== 2) {
      c.fail('track.pit.garageWall', 'expected [s0, s1]');
    } else {
      c.num(pit.garageWall[0], 'track.pit.garageWall[0]', 0, pl);
      c.num(pit.garageWall[1], 'track.pit.garageWall[1]', 0, pl);
    }
  }

  if (c.problems.length > 0) throw new TrackDataError(c.problems);
  return raw as TrackData;
}
