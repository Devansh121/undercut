import { createRng } from '@undercut/core';
import { createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import raw from '../data/monza.json';
import { TrackDataError, validateTrackData } from '../src/data';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { LEFT, RIGHT, Track, createGround } from '../src/track';

type Json = Record<string, unknown>;
const clone = (): Json => JSON.parse(JSON.stringify(raw)) as Json;
const get = (o: Json, path: string): unknown =>
  path.split('.').reduce<unknown>((a, k) => (a as Json)[k], o);
const arr = (o: Json, path: string): unknown[] => get(o, path) as unknown[];

/** Named mutations of the Monza file, each a plausible way a file goes wrong. */
const MUTATIONS: Record<string, (d: Json) => void> = {
  'truncated centreline x': (d) => void arr(d, 'centreline.x').pop(),
  'truncated every centreline array': (d) => {
    for (const k of ['x', 'y', 'z', 'bank', 'halfWidthLeft', 'halfWidthRight'])
      arr(d, `centreline.${k}`).splice(50);
  },
  'pit path with two samples': (d) => {
    for (const k of ['x', 'y', 'z', 'halfWidthLeft', 'halfWidthRight'])
      arr(d, `pit.${k}`).splice(2);
  },
  'pit path with one sample': (d) => {
    for (const k of ['x', 'y', 'z', 'halfWidthLeft', 'halfWidthRight'])
      arr(d, `pit.${k}`).splice(1);
  },
  'mismatched pit lengths': (d) => void arr(d, 'pit.y').pop(),
  'all-zero centreline': (d) => {
    for (const k of ['x', 'z']) (d.centreline as Json)[k] = arr(d, `centreline.${k}`).map(() => 0);
  },
  'NaN in centreline x': (d) => void (arr(d, 'centreline.x')[100] = Number.NaN),
  'Infinity in centreline z': (d) => void (arr(d, 'centreline.z')[7] = Infinity),
  '-Infinity in bank': (d) => void (arr(d, 'centreline.bank')[7] = -Infinity),
  'NaN length': (d) => void (d.length = Number.NaN),
  'NaN in pit x': (d) => void (arr(d, 'pit.x')[3] = Number.NaN),
  'NaN in barrier offsets': (d) => void (arr(d, 'sides.left.barrier')[10] = Number.NaN),
  'duplicated centreline point': (d) => {
    arr(d, 'centreline.x')[201] = arr(d, 'centreline.x')[200];
    arr(d, 'centreline.z')[201] = arr(d, 'centreline.z')[200];
  },
  'duplicated pit point': (d) => {
    arr(d, 'pit.x')[11] = arr(d, 'pit.x')[10];
    arr(d, 'pit.z')[11] = arr(d, 'pit.z')[10];
  },
  'centreline point thrown 50 m sideways': (d) =>
    void ((arr(d, 'centreline.x')[300] as number) += 50),
  'negative half-width': (d) => void (arr(d, 'centreline.halfWidthLeft')[5] = -5),
  'negative pit half-width': (d) => void (arr(d, 'pit.halfWidthRight')[5] = -3),
  'barrier inside the track': (d) => void (arr(d, 'sides.right.barrier')[40] = 2.5),
  'reversed centreline (s runs backwards)': (d) => {
    for (const k of ['x', 'y', 'z', 'bank', 'halfWidthLeft', 'halfWidthRight'])
      arr(d, `centreline.${k}`).reverse();
  },
  'reversed sectors': (d) => void arr(d, 'timing.sectors').reverse(),
  'reversed pit path': (d) => {
    for (const k of ['x', 'y', 'z', 'halfWidthLeft', 'halfWidthRight'])
      arr(d, `pit.${k}`).reverse();
  },
  'length scaled tenfold': (d) => void ((d.length as number) *= 10),
  'sector beyond the lap': (d) => void (arr(d, 'timing.sectors')[2] = 9000),
  'negative speed trap': (d) => void ((d.timing as Json).speedTrap = -5),
  'DRS end beyond the lap': (d) => void ((arr(d, 'timing.drs')[0] as Json).end = 6000),
  'grid slot at the lap length': (d) => void ((arr(d, 'grid')[3] as Json).s = 5793),
  'grid slot off the track': (d) => void ((arr(d, 'grid')[3] as Json).d = 25),
  'corner apex beyond the lap': (d) => void ((arr(d, 'corners')[4] as Json).s = 7000),
  'pit entry beyond the lap': (d) => void ((d.pit as Json).entryS = 6000),
  'pit box beyond the pit lane': (d) => void ((arr(d, 'pit.boxes')[0] as Json).s = 900),
  'limit lines swapped': (d) => {
    const p = d.pit as Json;
    [p.limitStart, p.limitEnd] = [p.limitEnd, p.limitStart];
  },
  'garage wall reversed': (d) => void arr(d, 'pit.garageWall').reverse(),
  'kerb run past the end': (d) => void arr(d, 'sides.left.kerb').push([4000, 'flat']),
  'unknown kerb profile': (d) => void (arr(d, 'sides.left.kerb')[1] = [290, 'rumble']),
  'unknown barrier type': (d) => void (arr(d, 'sides.left.barrierType')[0] = [0, 'hay']),
  'kerb profile u not increasing': (d) => {
    const pts = (arr(d, 'kerbProfiles')[0] as Json).points as number[][];
    pts[2]![0] = 0.05;
  },
  'zero line width': (d) => void (d.lineWidth = 0),
  'wrong format version': (d) => void (d.version = 99),
  'missing pit': (d) => void delete d.pit,
  'string where a number belongs': (d) => void (arr(d, 'centreline.y')[3] = '180'),
};

/** Every accessor that a client might call returns finite numbers. */
function exercise(track: Track): string | null {
  const v = createVec3();
  const q = createPathPoint();
  const g = createGround();
  const surface = new TrackSurface(track);
  const out = createSurfaceSample();
  const hint = createSurfaceHint();
  const bad = (x: number, what: string): string | null => (Number.isFinite(x) ? null : what);
  for (let k = 0; k < 60; k++) {
    const s = (k * track.length) / 60;
    const checks: (string | null)[] = [];
    const fin = (vec: { x: number; y: number; z: number }, what: string): void => {
      checks.push(bad(vec.x, what), bad(vec.y, what), bad(vec.z, what));
    };
    fin(track.positionAt(s, v), 'positionAt');
    fin(track.tangentAt(s, v), 'tangentAt');
    fin(track.normalAt(s, v), 'normalAt');
    checks.push(bad(track.curvatureAt(s), 'curvatureAt'), bad(track.elevationAt(s), 'elevationAt'));
    checks.push(bad(track.gradeAt(s), 'gradeAt'), bad(track.bankAt(s), 'bankAt'));
    checks.push(
      bad(track.halfWidthAt(s, LEFT), 'halfWidthAt'),
      bad(track.halfWidthAt(s, RIGHT), 'halfWidthAt'),
    );
    for (const d of [-30, -4, 0, 4, 30]) {
      fin(track.pointAt(s, d, v), 'pointAt');
      track.project(v.x, v.z, { index: -1 }, q);
      checks.push(bad(q.s, 'project'), bad(q.d, 'project'));
      track.ground(s, d, g);
      checks.push(bad(g.height, 'ground'), bad(g.slopeD, 'ground'), bad(g.slopeS, 'ground'));
      surface.sample(v.x, v.z, hint, out);
      checks.push(bad(out.height, 'sample'), bad(out.normalY, 'sample'), bad(out.grip, 'sample'));
    }
    const sp = (k * track.pit.length) / 60;
    fin(track.pit.path.pointAt(sp, 1, v), 'pit.pointAt');
    fin(track.pit.path.normal(sp, v), 'pit.normal');
    const failed = checks.find((c) => c !== null);
    if (failed) return `${failed} at s ${s.toFixed(1)}`;
  }
  for (const pose of [...track.gridSlots, ...track.pit.boxes]) {
    for (const x of [pose.x, pose.y, pose.z, pose.yaw]) if (!Number.isFinite(x)) return 'pose';
  }
  return null;
}

/** Validation either rejects with a clear message, or the track builds and stays finite. */
function verdict(data: Json): string {
  try {
    validateTrackData(data);
  } catch (e) {
    if (!(e instanceof TrackDataError)) return `validator threw ${String(e)}`;
    if (e.problems.length === 0 || !e.problems.every((p) => /^track[.\w[\]]*: \S/.test(p))) {
      return `unclear problems: ${e.problems.join('; ')}`;
    }
    return 'rejected';
  }
  let track: Track;
  try {
    track = new Track(data as never);
  } catch (e) {
    return `Track threw: ${String(e)}`;
  }
  return exercise(track) ?? 'accepted';
}

describe('track data fuzzing', () => {
  it('the unmodified file builds and stays finite', () => {
    expect(verdict(clone())).toBe('accepted');
  });

  for (const [name, mutate] of Object.entries(MUTATIONS)) {
    it(`rejects or survives: ${name}`, () => {
      const d = clone();
      mutate(d);
      expect(['rejected', 'accepted']).toContain(verdict(d));
    });
  }

  it('rejects the files that used to crash or give NaN, and degenerate shapes, with clear messages', () => {
    for (const name of [
      'pit path with two samples',
      'all-zero centreline',
      'duplicated centreline point',
      'duplicated pit point',
      'reversed centreline (s runs backwards)',
      'barrier inside the track',
    ]) {
      const d = clone();
      MUTATIONS[name]!(d);
      expect(verdict(d), name).toBe('rejected');
    }
    const d = clone();
    MUTATIONS['pit path with two samples']!(d);
    expect(() => validateTrackData(d)).toThrow(
      /track\.pit\.x: expected at least 3 samples, found 2/,
    );
  });

  it('rejects or survives 300 random numeric mutations', () => {
    const rng = createRng(77);
    const paths = [
      'centreline.x',
      'centreline.y',
      'centreline.z',
      'centreline.bank',
      'centreline.halfWidthLeft',
      'centreline.halfWidthRight',
      'sides.left.split',
      'sides.right.barrier',
      'pit.x',
      'pit.z',
      'pit.halfWidthLeft',
    ];
    const values = (v: number): number[] => [
      Number.NaN,
      Infinity,
      -1e9,
      0,
      -5,
      1e9,
      -v,
      v + 1000,
      v + 0.5,
    ];
    const failures: string[] = [];
    for (let k = 0; k < 300; k++) {
      const d = clone();
      const path = paths[Math.floor(rng.next() * paths.length)]!;
      const a = arr(d, path) as number[];
      const i = Math.floor(rng.next() * a.length);
      const options = values(a[i]!);
      a[i] = options[Math.floor(rng.next() * options.length)]!;
      const result = verdict(d);
      if (result !== 'rejected' && result !== 'accepted')
        failures.push(`${path}[${i}] = ${a[i]}: ${result}`);
    }
    expect(failures).toEqual([]);
  });
});
