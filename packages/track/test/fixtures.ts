import { TRACK_FORMAT, TRACK_FORMAT_VERSION, type Run, type TrackData } from '../src/data';
import type { Track } from '../src/track';

/** Largest |dh/du| over all kerb profiles of a track. */
export function steepestKerbSlope(track: Track): number {
  let max = 0;
  for (const p of track.kerbProfiles) {
    for (let k = 1; k < p.u.length; k++) {
      max = Math.max(max, Math.abs((p.h[k]! - p.h[k - 1]!) / (p.u[k]! - p.u[k - 1]!)));
    }
  }
  return max;
}

/**
 * A clockwise stadium: a straight heading east along z = -radius, a right-hand semicircle, a
 * straight heading west along z = +radius and another semicircle. Sampled evenly by arc length.
 */
export function stadium(
  straight: number,
  radius: number,
  step: number,
): { x: number[]; z: number[]; length: number } {
  const length = 2 * straight + 2 * Math.PI * radius;
  const n = Math.round(length / step);
  const x: number[] = [];
  const z: number[] = [];
  for (let k = 0; k < n; k++) {
    const u = (k * length) / n;
    if (u < straight) {
      x.push(-straight / 2 + u);
      z.push(-radius);
    } else if (u < straight + Math.PI * radius) {
      const phi = (u - straight) / radius;
      x.push(straight / 2 + radius * Math.sin(phi));
      z.push(-radius * Math.cos(phi));
    } else if (u < 2 * straight + Math.PI * radius) {
      x.push(straight / 2 - (u - straight - Math.PI * radius));
      z.push(radius);
    } else {
      const phi = (u - 2 * straight - Math.PI * radius) / radius;
      x.push(-straight / 2 - radius * Math.sin(phi));
      z.push(radius * Math.cos(phi));
    }
  }
  return { x, z, length };
}

export interface SyntheticOptions {
  straight?: number;
  radius?: number;
  step?: number;
  /** Bank angle (rad) everywhere. */
  bank?: number;
  /** Height as a function of s. */
  height?: (s: number) => number;
}

/** A complete, valid TrackData on a stadium, for unit tests. */
export function syntheticTrackData(options: SyntheticOptions = {}): TrackData {
  const straight = options.straight ?? 400;
  const radius = options.radius ?? 60;
  const step = options.step ?? 2;
  const { x, z, length } = stadium(straight, radius, step);
  const n = x.length;
  const ds = length / n;
  const height = options.height ?? (() => 0);
  const y = x.map((_, i) => height(i * ds));
  const fill = (v: number): number[] => new Array<number>(n).fill(v);
  const idx = (s: number): number => Math.round(s / ds);
  // Kerb on the inside (right) of the first bend; gravel beyond 12 m on the outside of both bends.
  const bend1 = straight;
  const bend2 = 2 * straight + Math.PI * radius;
  const kerbRight: Run<string | null>[] = [
    [0, null],
    [idx(bend1 + 40), 'flat'],
    [idx(bend1 + 120), null],
  ];
  const outerLeft: Run<'grass' | 'gravel'>[] = [
    [0, 'grass'],
    [idx(bend1), 'gravel'],
    [idx(bend1 + Math.PI * radius), 'grass'],
    [idx(bend2), 'gravel'],
  ];
  const pitLen = straight - 40;
  const m = Math.round(pitLen / 2) + 1;
  const px: number[] = [];
  const pz: number[] = [];
  for (let k = 0; k < m; k++) {
    px.push(-straight / 2 + 20 + (k * pitLen) / (m - 1));
    pz.push(-radius + 20);
  }
  return {
    format: TRACK_FORMAT,
    version: TRACK_FORMAT_VERSION,
    id: 'stadium',
    name: 'Stadium',
    country: 'Nowhere',
    direction: 'clockwise',
    length,
    sampleCount: n,
    origin: { lat: 45, lon: 9, datum: 100 },
    source: { pipelineVersion: 'test', scale: 1, licence: 'test', attribution: ['test data'] },
    centreline: {
      x,
      y,
      z,
      bank: fill(options.bank ?? 0),
      halfWidthLeft: fill(5),
      halfWidthRight: fill(5),
    },
    lineWidth: 0.2,
    kerbProfiles: [
      {
        name: 'flat',
        points: [
          [0, 0],
          [0.1, 0.04],
          [1.4, 0.05],
          [1.5, 0],
        ],
        high: null,
      },
      {
        name: 'sausage',
        points: [
          [0, 0],
          [0.2, 0.12],
          [0.4, 0],
        ],
        high: [0, 0.4],
      },
    ],
    sides: {
      left: {
        kerb: [[0, null]],
        inner: [[0, 'grass']],
        outer: outerLeft,
        split: fill(12),
        barrier: fill(25),
        barrierType: [
          [0, 'armco'],
          [idx(bend1), 'tyres'],
          [idx(bend1 + Math.PI * radius), 'armco'],
        ],
      },
      right: {
        kerb: kerbRight,
        inner: [
          [0, 'asphalt'],
          [idx(straight - 40), 'grass'],
        ],
        outer: [[0, 'grass']],
        split: fill(14),
        barrier: fill(14),
        barrierType: [[0, 'concrete']],
      },
    },
    corners: [
      {
        number: 1,
        name: 'East',
        direction: 'right',
        s: bend1 + (Math.PI * radius) / 2,
        start: bend1,
        end: bend1 + Math.PI * radius,
      },
      {
        number: 2,
        name: 'West',
        direction: 'right',
        s: bend2 + (Math.PI * radius) / 2,
        start: bend2,
        end: bend2 + Math.PI * radius,
      },
    ],
    timing: {
      sectors: [0, straight + 50, 2 * straight],
      speedTrap: straight - 50,
      drs: [{ detection: bend2 + 50, activation: 20, end: straight - 30 }],
    },
    grid: Array.from({ length: 6 }, (_, k) => ({
      s: (length - 5 - 8 * k) % length,
      d: k % 2 === 0 ? -2.5 : 2.5,
    })),
    pit: {
      side: 'right',
      entryS: 20,
      exitS: straight - 20,
      length: pitLen,
      speedLimit: 80 / 3.6,
      limitStart: 30,
      limitEnd: pitLen - 30,
      x: px,
      y: px.map(() => 0),
      z: pz,
      halfWidthLeft: px.map(() => 3),
      halfWidthRight: px.map(() => 6),
      boxes: [
        { s: 100, d: -4 },
        { s: 120, d: -4 },
      ],
      garageWall: [40, pitLen - 40],
    },
  };
}
