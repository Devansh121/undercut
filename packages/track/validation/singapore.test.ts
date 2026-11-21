/**
 * Validation of the committed Singapore Marina Bay track file. Reference values:
 * docs/track-data.md sections 2.3 and 4 (official length 4.927 km on the 2025 measurement,
 * 19 corners, anticlockwise, FIA reference width 9 m, elevation range 5.3 m, the two bridges)
 * and docs/physics-validation.md sections 4.5 to 4.7. A street circuit: concrete walls close to
 * the edge almost everywhere, a few escape roads, raced at night under floodlights.
 */
import { describe, expect, it } from 'vitest';
import raw from '../data/singapore.json';
import { BARRIER_TYPES } from '../src/data';
import { LEFT, RIGHT } from '../src/track';
import { describeCircuit } from './suite';

const { data, track } = describeCircuit({
  name: 'Singapore',
  raw,
  officialLength: 4927,
  direction: 'anticlockwise',
  startHeading: [340, 360],
  directions: 'LRLLRRLRLLRLLRLRLLL',
  names: [
    'Republic Boulevard',
    'Republic Boulevard',
    'Republic Boulevard',
    'Republic Boulevard',
    'Raffles Boulevard',
    'Raffles Boulevard',
    'Nicoll Highway',
    'Stamford Road',
    "Saint Andrew's Road",
    'Connaught Drive',
    'Connaught Drive',
    'Fullerton Road',
    'Esplanade Drive',
    'Esplanade',
    'Raffles Avenue',
    'Raffles Avenue',
    'Marina Promenade',
    'Marina Promenade',
    'Marina Promenade',
  ],
  cornerRule: { enter: 0.003333333, exit: 0.001666667, mergeGap: 20 },
  // The turn 13 hairpin, about 8.3 m on the centreline (OpenStreetMap turns 138 degrees in 13 m).
  maxCurvature: 1 / 7.5,
  maxCurvatureJump: 0.04,
  elevationRange: [5.3, 1.5],
  maxGrade: 0.04,
  width: [9.5, 15],
  maxBankDeg: 0.01,
  // Sector 1: 150 m before the start of turn 7, where the map's tick lands.
  sectors: (c) => [c.start(7) - 150, c.apex(14) - 140],
  speedTrap: (c) => c.apex(1) - 150,
  drs: (c) => [
    [c.apex(4), c.apex(5) + 48],
    [c.apex(13) - 102, c.apex(13) + 78],
    [c.apex(13) - 102, c.apex(14) + 100],
    [c.apex(17) + 105, c.end(19)],
  ],
  timingLine: { s: 4798.4, uncertainty: 10 },
  poleToBraking: 178,
  pit: { side: 'left', osmLength: 822.2 },
  // Turns 1 to 4; turn 8 beside turn 14; the hairpin's two legs by the waterfront; the final
  // corners under the grandstand beside the pit lane.
  closeRuns: [
    [240, 640],
    [1820, 1960],
    [3390, 3540],
    [2760, 3080],
    [4150, 4927],
  ],
});

const n = track.lap.count;
const step = track.length / n;
const corner = (k: number): number => data.corners[k - 1]!.s;
const CONCRETE = BARRIER_TYPES.indexOf('concrete');
const TYRES = BARRIER_TYPES.indexOf('tyres');

describe('Singapore: a street circuit at night', () => {
  it('is walled in concrete close to the edge almost everywhere', () => {
    let concrete = 0;
    let close = 0;
    for (const k of [LEFT, RIGHT] as const) {
      for (let i = 0; i < n; i++) {
        if (track.barrierType[k][i] === CONCRETE) concrete++;
        const kp = track.kerb[k][i]!;
        const edge = track.halfWidth[k][i]! + (kp >= 0 ? track.kerbProfiles[kp]!.width : 0);
        if (track.barrier[k][i]! - edge < 3) close++;
      }
    }
    expect(concrete / (2 * n)).toBeGreaterThan(0.85);
    expect(close / (2 * n)).toBeGreaterThan(0.75);
  });

  it('has escape roads at turns 1, 7, 13 and 14, ending in tyre walls', () => {
    for (const [k, side] of [
      [1, RIGHT],
      [7, RIGHT],
      [13, RIGHT],
      [14, LEFT],
    ] as const) {
      const i = track.lap.sampleIndex(corner(k) - 20);
      expect(track.barrier[side][i]!, `turn ${k}`).toBeGreaterThan(15);
      expect(track.barrierType[side][i], `turn ${k}`).toBe(TYRES);
    }
  });

  it('puts the two bridges back: each deck rises above its abutments', () => {
    const bridges = (data.source.dem as { bridges: { from: number; to: number; crown: number }[] })
      .bridges;
    expect(bridges).toHaveLength(2);
    for (const b of bridges) {
      const h = (s: number): number => track.lap.y[track.lap.sampleIndex(s)]!;
      const mid = b.from + track.forwardDistance(b.from, b.to) / 2;
      const ends = Math.max(h(b.from), h(b.to));
      // The 20 m grade smoothing flattens the short Fullerton Road deck's 1 m crown to about
      // 0.26 m; the 290 m Esplanade Drive deck keeps most of its 1.5 m.
      expect(h(mid) - ends).toBeGreaterThan(0.2);
    }
  });

  it('runs under floodlights, placed by rule because no mast is mapped', () => {
    const env = data.environment!;
    expect(env.lighting).toBe('floodlit');
    expect(env.floodlights!.mapped).toBe(false);
    expect(env.floodlights!.masts).toEqual([]);
    expect(env.floodlights!.rule!.spacing).toBeGreaterThan(env.floodlights!.rule!.stagger);
    // An evening race: the start is after sunset (about 19:00 local in October).
    expect(env.sessions.race).toBeGreaterThanOrEqual(19 * 3600);
  });

  it('has a main-straight DRS zone that runs through the start line', () => {
    const z = data.timing.drs[3]!;
    expect(z.activation).toBeGreaterThan(track.length - 400);
    expect(z.end).toBeLessThan(400);
    expect(track.drsZoneAt(0)).toBe(3);
    expect(track.drsZoneAt(data.timingLine.s)).toBe(3);
  });

  it('keeps d positive to the left on an anticlockwise lap: the pit lane is on the inside', () => {
    // On an anticlockwise lap the inside is on the left.
    expect(data.pit.side).toBe('left');
    let turnLeft = 0;
    for (let i = 0; i < n; i++) turnLeft += track.lap.curvature[i]! * step;
    expect(turnLeft).toBeGreaterThan(0);
  });
});
