/// <reference types="node" />
import { writeFileSync } from 'node:fs';
import { createRng } from '@undercut/core';
import {
  addCar,
  bodyCorners,
  checkCarInvariants,
  createCarParams,
  createSurfaceSample,
  createWorld,
  invariantLimits,
  stepWorld,
  SurfaceKind,
} from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { Track, createGround } from '../src/track';
import { PROBE_BODY, PROBE_PITCH, PROBE_ROLL, REVIEW_SIM_CASES, reviewRun } from './review-cases';

/**
 * The run-off ground at Monza's chicanes, in world space.
 *
 * Beyond the track edge the ground is the edge height minus VERGE_FALL per metre, keyed on the
 * projected (s, d). On the inside of a tight bend the lines of constant s converge on the centre
 * of curvature, so the centreline grade is squeezed by 1 / (1 - k d): at the first chicane
 * (R 12 m at s 656, left barrier at d 11.6) a 3 % centreline grade becomes a 26 % ramp at d 10.8.
 * Flat-out runs that leave the track there are thrown off it (review of PR 19).
 */
const MAX_RUNOFF_GRADE = 0.12;

interface GradePoint {
  s: number;
  d: number;
  grad: number;
  curv: number;
  normalErr: number;
}

/** World-space gradient, second difference and normal mismatch on a grid inside the barriers. */
function surveyGround(track: Track): GradePoint[] {
  const surf = new TrackSurface(track);
  const p = createVec3();
  const a = createSurfaceSample();
  const H = (x: number, z: number): number => {
    surf.sample(x, z, { index: -1 }, a);
    return a.kind === SurfaceKind.Kerb ||
      a.kind === SurfaceKind.OutOfBounds ||
      a.kind === SurfaceKind.PitLane
      ? Number.NaN
      : a.height;
  };
  const e = 0.25;
  const rows: GradePoint[] = [];
  for (let s = 0; s < track.lap.length; s += 1) {
    const bl = track.barrierAt(s, 0);
    const br = track.barrierAt(s, 1);
    for (let d = -br + 0.3; d < bl - 0.3; d += 0.5) {
      track.lap.pointAt(s, d, p);
      const h0 = H(p.x, p.z);
      const nx = a.normalX / a.normalY;
      const nz = a.normalZ / a.normalY;
      const hx1 = H(p.x + e, p.z);
      const hx0 = H(p.x - e, p.z);
      const hz1 = H(p.x, p.z + e);
      const hz0 = H(p.x, p.z - e);
      if ([h0, hx1, hx0, hz1, hz0].some(Number.isNaN)) continue;
      const gx = (hx1 - hx0) / (2 * e);
      const gz = (hz1 - hz0) / (2 * e);
      const cxx = (hx1 - 2 * h0 + hx0) / (e * e);
      const czz = (hz1 - 2 * h0 + hz0) / (e * e);
      rows.push({
        s,
        d,
        grad: Math.hypot(gx, gz),
        curv: Math.max(Math.abs(cxx), Math.abs(czz)),
        // The normal (nx, 1, nz) / len has dh/dx = -nx / ny.
        normalErr: Math.hypot(gx + nx, gz + nz),
      });
    }
  }
  return rows;
}

describe('run-off ground at Monza in world space', () => {
  const track = Track.fromJSON(monza);
  const rows = surveyGround(track);

  it('reports the ground normal that matches the height field (within 7 % of grade)', () => {
    const worst = rows.reduce((m, r) => Math.max(m, r.normalErr), 0);
    expect(worst).toBeLessThan(0.07);
  });

  // Open: the first chicane's inside run-off reaches 26 % (s 655-660, d 10.8) and 21 %
  // (s 621, d -9.6). Everywhere else stays under 10 %. Turns red once the ground model is fixed;
  // then make it a plain `it`.
  it.fails(
    `keeps the ground off the kerbs under ${MAX_RUNOFF_GRADE * 100} % grade inside the barriers`,
    () => {
      const steep = rows.filter((r) => r.grad > MAX_RUNOFF_GRADE).map((r) => `s ${r.s} d ${r.d}`);
      expect(steep).toEqual([]);
    },
  );
});

// Diagnostics for the open review cases of PR 19, run on demand:
//   UNDERCUT_DIAG=<out.txt> [UNDERCUT_TRACE=<seed>] npx vitest run --project physics <this file>
const diag = process.env.UNDERCUT_DIAG ? describe : describe.skip;

diag('run-off diagnostics (on demand)', () => {
  const track = Track.fromJSON(monza);
  it('logs the ground under the body corners before each failure', () => {
    const rows: string[] = [];
    for (const [seed, s0, mode] of REVIEW_SIM_CASES) {
      if (seed === 97513) continue;
      const rng = createRng(seed);
      const surface = new TrackSurface(track);
      const world = createWorld({ step: 1 / 240, seed, surface });
      let d0 = 0;
      let angle = 0;
      if (mode === 'right') angle = -0.85;
      if (mode === 'scrapeL' || mode === 'scrapeR') {
        const side = mode === 'scrapeL' ? 0 : 1;
        d0 = (side === 0 ? 1 : -1) * (track.barrierAt(s0, side) - 2);
        angle = side === 0 ? 0.06 : -0.06;
      }
      const p = createVec3();
      const t = createVec3();
      track.lap.pointAt(s0, d0, p);
      track.lap.tangent(s0, t);
      const car = addCar(world, createCarParams('low'), {
        x: p.x,
        z: p.z,
        yaw: Math.atan2(-t.z, t.x) + angle,
        speed: 83.333,
        fuel: 20,
      });
      const st = car.state;
      const limits = invariantLimits(st.model);
      const corners = new Float64Array(8);
      const q = createPathPoint();
      const g = createGround();
      type Rec = {
        k: number;
        x: number[];
        z: number[];
        s: number[];
        d: number[];
        h: number[];
        m: number[];
        kind: number[];
        bar: number[];
        y: number;
        vy: number;
        pitch: number;
        roll: number;
        v: number;
      };
      const hist: Rec[] = [];
      let fail = -1;
      let why = '';
      let steer = 0;
      for (let k = 0; k < 240 * 18 && fail < 0; k++) {
        if (k % 240 === 0) steer = mode === 'right' ? rng.range(-0.5, 0.5) : 0;
        car.input.throttle = 1;
        car.input.steer = steer;
        car.input.brake = 0;
        car.input.gearShift = st.engineSpeed > 1200 && st.gear < 8 ? 1 : 0;
        stepWorld(world);
        bodyCorners(st, corners);
        const r: Rec = {
          k,
          x: [],
          z: [],
          s: [],
          d: [],
          h: [],
          m: [],
          kind: [],
          bar: [],
          y: st.y,
          vy: st.vy,
          pitch: st.pitch,
          roll: st.roll,
          v: Math.abs(st.vx),
        };
        for (let c = 0; c < 4; c++) {
          const x = corners[2 * c]!,
            z = corners[2 * c + 1]!;
          track.project(x, z, { index: -1 }, q);
          track.ground(q.s, q.d, g);
          r.x.push(x);
          r.z.push(z);
          r.s.push(q.s);
          r.d.push(q.d);
          r.h.push(g.height);
          r.m.push(1 - g.curvature * g.d);
          r.kind.push(g.kind);
          r.bar.push(track.barrierAt(q.s, q.d >= 0 ? 0 : 1) - Math.abs(q.d));
        }
        hist.push(r);
        if (hist.length > 240) hist.shift();
        const w = checkCarInvariants(st, limits);
        const ss = createSurfaceSample();
        surface.sample(st.x, st.z, { index: -1 }, ss);
        if (w) why = w;
        else if (Math.abs(st.pitch) > PROBE_PITCH) why = `pitch ${st.pitch.toFixed(3)}`;
        else if (Math.abs(st.roll) > PROBE_ROLL) why = `roll ${st.roll.toFixed(3)}`;
        else if (st.y - ss.height > PROBE_BODY) why = `body ${(st.y - ss.height).toFixed(3)}`;
        if (why) fail = k;
      }
      // Per corner: ground along the corner's path over the last second. World grade between
      // successive ticks, and the grade change per metre (profile curvature), largest values.
      let maxGrade = 0,
        maxCurv = 0,
        minM = 9,
        kerbTicks = 0,
        minBar = 99,
        sAt = 0,
        dAt = 0,
        foldJump = 0;
      for (let c = 0; c < 4; c++) {
        let prevG = NaN;
        for (let i = 1; i < hist.length; i++) {
          const a = hist[i - 1]!,
            b = hist[i]!;
          const dist = Math.hypot(b.x[c]! - a.x[c]!, b.z[c]! - a.z[c]!);
          if (dist < 1e-3) continue;
          const dh = b.h[c]! - a.h[c]!;
          const gr = dh / dist;
          if (Math.abs(gr) > Math.abs(maxGrade)) {
            maxGrade = gr;
            sAt = b.s[c]!;
            dAt = b.d[c]!;
          }
          if (Math.abs(b.s[c]! - a.s[c]!) > 3 * dist + 0.5)
            foldJump = Math.max(foldJump, Math.abs(b.s[c]! - a.s[c]!));
          if (!Number.isNaN(prevG)) maxCurv = Math.max(maxCurv, Math.abs(gr - prevG) / dist);
          prevG = gr;
          minM = Math.min(minM, b.m[c]!);
          if (b.kind[c] === 2) kerbTicks++;
          minBar = Math.min(minBar, b.bar[c]!);
        }
      }
      if (String(seed) === process.env.UNDERCUT_TRACE) {
        const T: string[] = [];
        for (let i = 0; i < hist.length; i += 4) {
          const r = hist[i]!;
          T.push(
            `k ${r.k} y ${r.y.toFixed(3)} vy ${r.vy.toFixed(2)} pitch ${r.pitch.toFixed(3)} roll ${r.roll.toFixed(3)} | ` +
              [0, 1, 2, 3]
                .map(
                  (c) =>
                    `c${c} s ${r.s[c]!.toFixed(1)} d ${r.d[c]!.toFixed(2)} h ${r.h[c]!.toFixed(3)} m ${r.m[c]!.toFixed(2)} kd${r.kind[c]}`,
                )
                .join(' | '),
          );
        }
        writeFileSync(process.env.UNDERCUT_DIAG! + '.trace', T.join('\n') + '\n');
      }
      const last = hist[hist.length - 1]!;
      let vyMax = 0;
      for (let i = 1; i < hist.length; i++)
        vyMax = Math.max(vyMax, (hist[i]!.y - hist[i - 1]!.y) * 240);
      const kinds = [...new Set(hist.flatMap((r) => r.kind))].join('/');
      rows.push(
        `${seed} ${String(s0).padStart(4)} ${mode.padEnd(7)} fail@${fail} ${why.padEnd(28)} s=${last.s[0]!.toFixed(0)} d=${last.d[0]!.toFixed(1)} v=${last.v.toFixed(1)} ` +
          `maxGrade=${(maxGrade * 100).toFixed(1)}% @(s ${sAt.toFixed(0)}, d ${dAt.toFixed(1)}) profCurv=${maxCurv.toFixed(3)}/m minM=${minM.toFixed(3)} ` +
          `foldJump=${foldJump.toFixed(1)} kerbTicks=${kerbTicks} kinds=${kinds} minBarGap=${minBar.toFixed(2)} climbMax=${vyMax.toFixed(2)}`,
      );
    }
    writeFileSync(`${process.env.UNDERCUT_DIAG!}.profile`, rows.join('\n') + '\n');
  }, 600000);
  it('A/B: flat elevation, no high kerb band, both', () => {
    const flatY = structuredClone(monza);
    flatY.centreline.y = flatY.centreline.y.map(() => 0);
    const noHigh = structuredClone(monza);
    for (const p of noHigh.kerbProfiles)
      if (p.name === 'chicane') {
        p.points = [
          [0, 0],
          [0.12, 0.035],
          [1.4, 0.05],
          [2.05, 0.05],
          [2.2, 0],
        ];
        p.high = null;
      }
    const both = structuredClone(flatY);
    both.kerbProfiles = noHigh.kerbProfiles;
    const variants = { base: monza, flatY, noHigh, both } as const;
    const tracks = Object.fromEntries(
      Object.entries(variants).map(([k, v]) => [k, Track.fromJSON(v as typeof monza)]),
    );
    const L: string[] = [];
    for (const [seed, s, mode] of REVIEW_SIM_CASES) {
      if (seed === 97513) continue;
      const cells = Object.entries(tracks).map(([k, t]) => {
        const r = reviewRun(t, seed, s, mode);
        return `${k}: ${(r.failure ?? 'ok').slice(0, 44).padEnd(44)} maxBody ${r.maxBodyAboveGround.toFixed(2)}`;
      });
      L.push(`${seed} ${s} ${mode} | ${cells.join(' | ')}`);
    }
    writeFileSync(`${process.env.UNDERCUT_DIAG!}.ab`, L.join('\n') + '\n');
  }, 900000);
  it('writes the steepest run-off points', () => {
    const rows = surveyGround(track);
    const top = (key: keyof GradePoint): string[] =>
      [...rows]
        .sort((u, v) => v[key] - u[key])
        .slice(0, 12)
        .map(
          (r) =>
            `s ${r.s} d ${r.d.toFixed(1)} grad ${(r.grad * 100).toFixed(1)}% curv ${r.curv.toFixed(3)}/m normalErr ${(r.normalErr * 100).toFixed(1)}%`,
        );
    writeFileSync(
      `${process.env.UNDERCUT_DIAG!}.survey`,
      [
        '-- by gradient',
        ...top('grad'),
        '-- by curvature',
        ...top('curv'),
        '-- by normal error',
        ...top('normalErr'),
      ].join('\n') + '\n',
    );
  });
});
