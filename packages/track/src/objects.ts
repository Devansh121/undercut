import { SurfaceKind, type BreakableObject } from '@undercut/sim';
import { createPathPoint, createVec3 } from './path';
import type { Track } from './track';

/** Dressing contact policy: attached signage never replaces its solid supporting wall. */
export const DRESSING_CONTACT = {
  wallHoarding: 'solid',
  fence: 'solid',
  guardrail: 'solid',
  concrete: 'solid',
  tyres: 'solid',
  vergeBoard: 'breakable',
  distanceBoard: 'breakable',
  markerBoard: 'breakable',
  cone: 'breakable',
} as const;

export interface TracksideObject extends BreakableObject {
  readonly kind:
    'verge-board' | 'board-150' | 'board-100' | 'board-50' | 'board-drs' | 'board-drs-det';
  readonly contact: 'breakable';
  readonly s: number;
}

/** Quality-independent placement data consumed by both contact and dressing. */
const cache = new WeakMap<Track, readonly TracksideObject[]>();

export function tracksideObjects(track: Track): readonly TracksideObject[] {
  const cached = cache.get(track);
  if (cached) return cached;
  const out: TracksideObject[] = [];
  const p = createVec3(),
    t = createVec3(),
    ta = createVec3(),
    tb = createVec3();
  const q = createPathPoint();
  const wrap = (s: number) => ((s % track.length) + track.length) % track.length;
  const add = (kind: TracksideObject['kind'], s: number, side: 0 | 1, d: number, cant = 0) => {
    s = wrap(s);
    track.lap.pointAt(s, side === 0 ? d : -d, p);
    track.lap.tangent(s, t);
    const verge = kind === 'verge-board';
    const nx = side === 0 ? -t.z : t.z,
      nz = side === 0 ? t.x : -t.x;
    out.push({
      id: out.length,
      kind,
      contact: 'breakable',
      s,
      x: p.x,
      y: track.groundHeightAt(p.x, p.z),
      z: p.z,
      yaw: verge ? Math.atan2(-nz, nx) : Math.atan2(t.z, -t.x) + cant,
      halfWidth: verge ? 2.18 : kind === 'board-drs' ? 0.725 : 0.675,
      height: verge ? 0.88 : 2.2,
      halfDepth: verge ? 0.34 : 0.19,
      mass: verge ? 12 : 5,
    });
  };
  for (let s = 20; s < track.length - 20; s += 10) {
    for (const side of [0, 1] as const) {
      if (side === (track.pit.side === 'left' ? 0 : 1)) {
        const gap = (at: number) => Math.min(Math.abs(s - at), track.length - Math.abs(s - at));
        if (gap(track.pit.entryS) < 38 || gap(track.pit.exitS) < 38) continue;
      }
      const i = track.lap.sampleIndex(s);
      const width = track.halfWidth[side][i]!;
      const d = width + 2.7;
      if (track.outer[side][i] !== SurfaceKind.Grass || track.barrier[side][i]! - width < 6.8)
        continue;
      track.lap.tangent(wrap(s - 18), ta);
      track.lap.tangent(wrap(s + 18), tb);
      const turn = Math.atan2(tb.x * ta.z - tb.z * ta.x, tb.x * ta.x + tb.z * ta.z);
      if ((side === 0 ? turn : -turn) > 0.1) continue;
      track.lap.pointAt(s, side === 0 ? d : -d, p);
      track.project(p.x, p.z, { index: -1 }, q);
      const ds = Math.min(Math.abs(q.s - s), track.length - Math.abs(q.s - s));
      if (ds > 22 || Math.abs(q.d) < width + 2.2) continue;
      add('verge-board', s, side, d);
    }
  }
  let last = -999;
  for (const c of track.corners) {
    if (c.end - c.start > 450 || c.start - last < 220) continue;
    last = c.start;
    const side = c.direction === 'right' ? 0 : 1;
    for (const dist of [150, 100, 50] as const) {
      const s = wrap(c.start - dist);
      // Lightweight signs stand inside the solid barrier, reachable without crossing it.
      add(
        `board-${dist}`,
        s,
        side,
        Math.max(
          track.halfWidth[side][track.lap.sampleIndex(s)]! + 1,
          track.barrierAt(s, side) - 1.2,
        ),
        side === 0 ? -0.22 : 0.22,
      );
    }
  }
  for (const zone of track.drsZones) {
    for (const side of [0, 1] as const) {
      for (const [kind, s] of [
        ['board-drs', zone.activation],
        ['board-drs-det', zone.detection],
      ] as const)
        add(kind, s, side, track.barrierAt(s, side) - 1.2);
    }
  }
  cache.set(track, out);
  return out;
}
