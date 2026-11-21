/**
 * Validation of the committed Spa-Francorchamps track file. Reference values: docs/track-data.md
 * sections 2.2 and 4 (official length 7.004 km, 19 corners, clockwise, FIA reference width 10 m,
 * elevation range 102.2 m, lowest point at turn 15, highest at turn 7, the climb from the bottom
 * of Eau Rouge) and docs/physics-validation.md sections 4.6 and 4.7.
 */
import { SurfaceKind } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import raw from '../data/spa.json';
import { BARRIER_TYPES } from '../src/data';
import { LEFT, RIGHT } from '../src/track';
import { describeCircuit } from './suite';

const { data, track } = describeCircuit({
  name: 'Spa',
  raw,
  officialLength: 7004,
  direction: 'clockwise',
  startHeading: [320, 340],
  directions: 'RLRLRLRRLLLRLRRLLRL',
  names: [
    'La Source',
    'Eau Rouge',
    'Raidillon',
    'Raidillon',
    'Les Combes',
    'Les Combes',
    'Malmedy',
    'Bruxelles',
    "Speaker's Corner",
    'Pouhon',
    'Pouhon',
    'Les Fagnes',
    'Les Fagnes',
    'Campus',
    'Stavelot',
    'Blanchimont',
    'Blanchimont',
    'Bus Stop',
    'Bus Stop',
  ],
  cornerRule: { enter: 0.003333333, exit: 0.001666667, mergeGap: 30, minTurn: 15 },
  // La Source, about 11 m on the centreline.
  maxCurvature: 1 / 9,
  maxCurvatureJump: 0.02,
  elevationRange: [102.2, 3],
  // Raidillon is published at 17 %; the filtered surface model is shallower (below).
  maxGrade: 0.18,
  width: [10, 18],
  maxBankDeg: 3,
  // Sector 2: 48 m before the start of turn 15, where the map's tick lands (the corner is long).
  sectors: (c) => [c.apex(5) - 145, c.start(15) - 48],
  speedTrap: (c) => c.apex(4) + 30,
  drs: (c) => [
    [c.apex(2) - 240, c.apex(4) + 305],
    [c.apex(18) - 160, c.apex(19) + 30],
  ],
  timingLine: { s: 6875.4, uncertainty: 15 },
  poleToBraking: 165,
  pit: { side: 'right', osmLength: 720.5 },
  // The start straight beside the run down from La Source; the two legs of Bruxelles.
  closeRuns: [
    [60, 520],
    [2700, 3220],
  ],
});

const L = track.length;
const n = track.lap.count;
const step = L / n;
const datum = data.origin.datum;
const corner = (k: number): number => data.corners[k - 1]!.s;
const heightAt = (s: number): number => track.lap.y[track.lap.sampleIndex(s)]! + datum;
const lowestBetween = (a: number, b: number): number => {
  let lo = Infinity;
  for (let s = a; s <= b; s += step) lo = Math.min(lo, heightAt(s));
  return lo;
};

describe('Spa: elevation', () => {
  const y = Array.from(track.lap.y);
  const lo = y.indexOf(Math.min(...y)) * step;
  const hi = y.indexOf(Math.max(...y)) * step;
  // Bottom of Eau Rouge, top of the climb after Raidillon (the operator's 1490 m label), top
  // of Les Combes.
  const bottom = lowestBetween(corner(2) - 100, corner(3));
  const topOfRaidillon = heightAt(corner(4) + 320);
  const top =
    Math.max(...y.slice(Math.round(corner(4) / step), Math.round(corner(8) / step))) + datum;

  it('has its lowest point at turn 15 and its highest at turn 7, as published', () => {
    expect(Math.abs(track.lapDelta(lo, corner(15)))).toBeLessThan(150);
    expect(Math.abs(track.lapDelta(hi, corner(7)))).toBeLessThan(150);
  });

  it('climbs 79 m from the bottom of Eau Rouge to Les Combes (published 79 m, residual within 3 m)', () => {
    expect(Math.abs(top - bottom - 79)).toBeLessThan(3);
  });

  it('climbs between the two published figures from Eau Rouge to the top of Raidillon (40 and 55 m)', () => {
    const rise = topOfRaidillon - bottom;
    expect(rise).toBeGreaterThan(40 - 3);
    expect(rise).toBeLessThan(55 + 3);
  });

  it('is steepest on Raidillon, and compresses at the bottom of Eau Rouge before cresting', () => {
    let steepest = 0;
    let where = 0;
    for (let i = 0; i < n; i++)
      if (Math.abs(track.lap.grade[i]!) > steepest) {
        steepest = Math.abs(track.lap.grade[i]!);
        where = i * step;
      }
    expect(where).toBeGreaterThan(corner(2));
    expect(where).toBeLessThan(corner(4));
    expect(steepest).toBeGreaterThan(0.12);
    // Vertical curvature from the grade: a sag (positive) at the bottom, a crest (negative)
    // where the climb flattens onto Kemmel.
    const vc = (s: number): number => {
      const i = track.lap.sampleIndex(s);
      return (track.lap.grade[(i + 5) % n]! - track.lap.grade[(i + n - 5) % n]!) / (10 * step);
    };
    let sag = 0;
    for (let s = corner(2) - 60; s <= corner(3); s += step) sag = Math.max(sag, vc(s));
    let crest = 0;
    for (let s = corner(4); s <= corner(4) + 400; s += step) crest = Math.min(crest, vc(s));
    expect(sag).toBeGreaterThan(1 / 1000);
    expect(crest).toBeLessThan(-1 / 1000);
  });
});

describe('Spa: run-off, barriers and the lap', () => {
  it('has mapped gravel and every barrier type except fences, which are read as guard rails', () => {
    let gravel = 0;
    for (let i = 0; i < n; i++)
      for (const k of [LEFT, RIGHT] as const)
        if (track.outer[k][i] === SurfaceKind.Gravel) gravel++;
    expect(gravel * step).toBeGreaterThan(1500);
    const types = new Set(track.barriers.map((b) => b.type));
    expect([...types].sort()).toEqual(BARRIER_TYPES.filter((t) => t !== 'fence').sort());
  });

  it('has a main-straight DRS zone that runs through the start line', () => {
    const z = data.timing.drs[1]!;
    expect(z.activation).toBeGreaterThan(L - 400);
    expect(z.end).toBeLessThan(400);
    expect(track.drsZoneAt(0)).toBe(1);
    expect(track.drsZoneAt(L - 1)).toBe(1);
    // The timing line and the grid are inside it.
    expect(track.drsZoneAt(data.timingLine.s)).toBe(1);
  });
});
