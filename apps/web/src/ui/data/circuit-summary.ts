/**
 * What the menus show about a circuit, computed at build time from the track file (the Vite
 * plugin in apps/web/vite.config.ts runs this over packages/track/data/*.json) so the menus never
 * download a whole track to draw a card. Pure: plain data in, plain data out.
 */

/** The fields of a track file the summary reads (format undercut-track, version 2 or later). */
export interface TrackFileLike {
  id: string;
  name: string;
  country: string;
  direction: string;
  length: number;
  centreline: { x: number[]; z: number[] };
  corners: readonly { number: number; s: number }[];
  timing: { sectors: readonly number[]; drs: readonly unknown[] };
  timingLine?: { s: number } | number;
  environment?: { lighting?: string; airTemperature?: number } | null;
}

export interface CircuitSummary {
  id: string;
  name: string;
  country: string;
  direction: 'clockwise' | 'anticlockwise';
  /** m */
  length: number;
  corners: number;
  drsZones: number;
  raceLaps: number;
  /** Air temperature from the track file, K, or null when the file has none. */
  airTemperature: number | null;
  /** Time-of-day presets the renderer has for this circuit, first is the default. */
  timesOfDay: string[];
  /**
   * The AI drivers have a racing line for this circuit (packages/ai/data): race modes need one.
   * Without it the circuit offers Time Trial only.
   */
  raceReady: boolean;
  /**
   * There is a driving line for the player's car (an AI line built at its trim): braking help
   * works here.
   */
  brakingHelp: boolean;
  plan: CircuitPlan;
}

export interface CircuitPlan {
  width: number;
  height: number;
  /** Closed SVG path of the centreline, north up. */
  path: string;
  /** Sector boundaries along the path as fractions of the lap from the timing line. */
  sectorPaths: string[];
  /** Start line as a short segment across the track. */
  startLine: [number, number, number, number];
  /** Corner number labels, placed outside the line. */
  labels: { n: number; x: number; y: number }[];
}

/** Sky presets per circuit; a circuit not listed gets one from its lighting. */
const TIMES: Readonly<Record<string, readonly string[]>> = {
  monza: ['monza-afternoon', 'overcast-day'],
  spa: ['overcast-day'],
  // Raced at night under its floodlights (the world's lamp banks light it); a day session too.
  singapore: ['night-floodlit', 'overcast-day'],
};

export function timesOfDayFor(id: string, lighting: string | undefined): string[] {
  const listed = TIMES[id];
  if (listed) return [...listed];
  // The floodlit night preset is not built yet; every other circuit gets the day preset.
  void lighting;
  return ['overcast-day'];
}

const round1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/**
 * Fit the centreline into `width` x `height` (north up: +X right, +Z down), keeping the aspect
 * ratio, every `stride`-th sample.
 */
export function buildPlan(
  t: TrackFileLike,
  width: number,
  height: number,
  padding: number,
  timingLine: number,
  stride = 8,
): CircuitPlan {
  const xs = t.centreline.x;
  const zs = t.centreline.z;
  const n = Math.min(xs.length, zs.length);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i] as number;
    const z = zs[i] as number;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const scale = Math.min(
    (width - 2 * padding) / (maxX - minX),
    (height - 2 * padding) / (maxZ - minZ),
  );
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxZ - minZ) * scale) / 2;
  const px = (i: number): [number, number] => [
    ox + ((xs[i] as number) - minX) * scale,
    oy + ((zs[i] as number) - minZ) * scale,
  ];
  const step = t.length / n;
  const indexAt = (s: number): number => {
    const w = ((s % t.length) + t.length) % t.length;
    return Math.min(n - 1, Math.round(w / step));
  };
  const parts: string[] = [];
  for (let i = 0; i < n; i += stride) {
    const [x, y] = px(i);
    parts.push(`${i === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`);
  }
  // Sectors from the timing line: the file's sector lines after it, in lap order.
  const starts = [timingLine, ...t.timing.sectors.slice(1)]
    .map((s) => (((s - timingLine) % t.length) + t.length) % t.length)
    .sort((a, b) => a - b)
    .map((d) => timingLine + d);
  const sectorPaths = starts.map((s0, k) => {
    const s1 = k + 1 < starts.length ? (starts[k + 1] as number) : timingLine + t.length;
    const pts: string[] = [];
    const a = s0;
    const count = Math.max(2, Math.ceil((s1 - a) / (step * stride)));
    for (let j = 0; j <= count; j++) {
      const [x, y] = px(indexAt(a + ((s1 - a) * j) / count));
      pts.push(`${j === 0 ? 'M' : 'L'}${round1(x)} ${round1(y)}`);
    }
    return pts.join('');
  });
  // Start line across the track at the timing line.
  const i0 = indexAt(timingLine);
  const i1 = (i0 + 1) % n;
  const [sx, sy] = px(i0);
  const [tx, ty] = px(i1);
  const len = Math.hypot(tx - sx, ty - sy) || 1;
  const nx = -(ty - sy) / len;
  const ny = (tx - sx) / len;
  const half = 6;
  // Corner labels: offset from the line toward the outside of the plan (away from its centre).
  const cx = width / 2;
  const cy = height / 2;
  const labels: CircuitPlan['labels'] = [];
  for (const c of t.corners) {
    const [x, y] = px(indexAt(c.s));
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const lx = Number(round1(x + (dx / d) * 9));
    const ly = Number(round1(y + (dy / d) * 9));
    // Corners closer together than a label is wide (a chicane) share the first one's number.
    if (labels.some((l) => Math.hypot(l.x - lx, l.y - ly) < 10)) continue;
    labels.push({ n: c.number, x: lx, y: ly });
  }
  return {
    width,
    height,
    path: `${parts.join('')}Z`,
    sectorPaths,
    startLine: [
      Number(round1(sx - nx * half)),
      Number(round1(sy - ny * half)),
      Number(round1(sx + nx * half)),
      Number(round1(sy + ny * half)),
    ],
    labels,
  };
}

/** The menus' view of one track file. `raceLaps` and `timingLine` come from the race rules. */
export function summarizeTrack(
  t: TrackFileLike,
  raceLaps: number,
  timingLine: number,
  raceReady = false,
  brakingHelp = false,
): CircuitSummary {
  const corners = new Set(t.corners.map((c) => c.number)).size;
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    direction:
      t.direction === 'anticlockwise' || t.direction === 'counterclockwise'
        ? 'anticlockwise'
        : 'clockwise',
    length: t.length,
    corners,
    drsZones: t.timing.drs.length,
    raceLaps,
    airTemperature:
      typeof t.environment?.airTemperature === 'number' ? t.environment.airTemperature : null,
    timesOfDay: timesOfDayFor(t.id, t.environment?.lighting),
    raceReady,
    brakingHelp,
    plan: buildPlan(t, 208, 150, 14, timingLine),
  };
}
