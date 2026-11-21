import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../src/events';
import { createCarParams, type ControlInput } from '@undercut/sim';
import { MONZA } from '../../ai/validation/lib/index';
import { InputController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { aiSession, runRace, runSession } from './lib/runner';

// Physics job: the real sim and AI drivers at Monza. Short on purpose (a small field, three
// laps); the twenty-car race, full distance and the weekend run in the nightly soak. No lap
// times or speeds are asserted: the car's physics are being recalibrated separately.

const pitStages = (events: readonly RaceEvent[], car: number) =>
  events
    .filter((e) => e.type === 'pit' && e.car === car)
    .map((e) => (e.type === 'pit' ? e.stage : ''));

describe('a three-lap race at Monza with AI drivers', () => {
  const run = runRace({ cars: 4, laps: 3, seed: 5, pitLap: (car) => (car === 1 ? 2 : null) });
  const r = run.result;

  it('starts from the grid, runs the distance and classifies every car', () => {
    expect(r.entries).toHaveLength(4);
    expect(r.entries.every((e) => e.status === 'finished' && e.laps === 3)).toBe(true);
    const totals = r.entries.map((e) => e.totalTime!);
    for (let k = 1; k < totals.length; k++) expect(totals[k]!).toBeGreaterThan(totals[k - 1]!);
    expect(r.entries.map((e) => e.points)).toEqual([25, 18, 15, 12]);
    expect(
      run.events
        .filter((e) => e.type === 'lights')
        .map((e) => (e.type === 'lights' ? e.count : -1)),
    ).toEqual([1, 2, 3, 4, 5, 0]);
  });

  it('has no stuck, off-track or wrong-way car by the watchdog, and no penalties', () => {
    expect(r.anomalies).toEqual([]);
    expect(run.events.filter((e) => e.type === 'penalty')).toEqual([]);
    expect(run.cars.every((c) => c.allOffTicks === 0)).toBe(true);
  });

  it('the AI makes its pit stop: in at the limit, stops in its box, out again', () => {
    expect(pitStages(run.events, 1)).toEqual([
      'entry',
      'stop',
      'serviceStart',
      'serviceEnd',
      'release',
      'exit',
    ]);
    const e = r.entries.find((x) => x.car === 1)!;
    expect(e.pitStops).toBe(1);
    expect(e.compounds).toEqual(['medium', 'hard']);
    expect(run.events.some((x) => x.type === 'pit' && x.stage === 'speeding')).toBe(false);
  });

  it('is deterministic: the same seed gives the same events and result', () => {
    const again = runRace({ cars: 4, laps: 3, seed: 5, pitLap: (car) => (car === 1 ? 2 : null) });
    expect(again.result).toEqual(r);
    expect(again.events).toEqual(run.events);
  });
});

describe('a race session snapshot over the real sim', () => {
  it('restores mid-race into a fresh session that runs on to a clean finish', () => {
    const a = aiSession({ kind: 'race', laps: 2 }, { cars: 3, seed: 8 });
    while (a.control.timer(a.control.order[0]!).lap < 2) a.tick();
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as ReturnType<RaceSession['snapshot']>;
    const b = aiSession({ kind: 'race', laps: 2 }, { cars: 3, seed: 8 });
    b.restore(snap);
    expect(JSON.parse(JSON.stringify(b.snapshot()))).toEqual(snap);
    const run = runSession(b);
    expect(run.result.entries.every((e) => e.status === 'finished' && e.laps === 2)).toBe(true);
    expect(run.result.anomalies).toEqual([]);
  });
});

describe('qualifying from the pit lane at Monza', () => {
  it('releases the cars, runs out-laps and flying laps, and classifies by best lap', () => {
    const run = runSession(aiSession({ kind: 'qualifying', duration: 240 }, { cars: 3, seed: 3 }));
    const r = run.result;
    expect(r.anomalies).toEqual([]);
    expect(r.entries.every((e) => e.bestLap !== null)).toBe(true);
    const bests = r.entries.map((e) => e.bestLap!);
    for (let k = 1; k < bests.length; k++) expect(bests[k]!).toBeGreaterThanOrEqual(bests[k - 1]!);
    for (let car = 0; car < 3; car++)
      expect(pitStages(run.events, car).slice(0, 2)).toEqual(['release', 'exit']);
  });
});

describe('the assisted pit lane for a player', () => {
  it('drives a car with no input out of the garage, and in to its box when asked', () => {
    const track = MONZA.track();
    const params = createCarParams(MONZA.trim);
    let throttle = 0;
    const session = new RaceSession({
      track,
      session: { kind: 'practice', duration: 600, releaseInterval: 2 },
      seed: 1,
      params,
      cars: [
        {
          entrant: { id: 'p', name: 'Player', code: 'PLY', team: 0 },
          controller: new InputController(
            (_ctx, out: ControlInput) => {
              out.steer = 0;
              out.throttle = throttle;
              out.brake = 0;
              out.gearShift = 0;
              out.drs = false;
              out.overtake = false;
              out.pitLimiter = false;
            },
            { params, assistedPitLane: true },
          ),
        },
      ],
    });
    const events = session.run(60, () => undefined);
    const stages = events
      .filter((e) => e.type === 'pit')
      .map((e) => (e.type === 'pit' ? e.stage : ''));
    expect(stages).toEqual(['release', 'exit']);
    expect(events.some((e) => e.type === 'pit' && e.stage === 'speeding')).toBe(false);
    // Asked in while coasting down the pit straight's approach: teleport near the entry, at speed.
    session.placeCar(0, ...poseAt(session, track.pit.entryS - 100), 40);
    throttle = 0;
    session.requestPit(0, [{ kind: 'tyres', compound: 'soft' }]);
    const more = session.run(60, () => undefined);
    const stages2 = more
      .filter((e) => e.type === 'pit')
      .map((e) => (e.type === 'pit' ? e.stage : ''));
    expect(stages2.slice(0, 4)).toEqual(['entry', 'stop', 'serviceStart', 'serviceEnd']);
    expect(session.control.cars[0]!.compound).toBe('soft');
  });
});

function poseAt(session: RaceSession, s: number): [number, number, number] {
  const p = session.lapPose(s, 0);
  return [p.x, p.z, p.yaw];
}
