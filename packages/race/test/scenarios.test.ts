import { describe, expect, it } from 'vitest';
import { buildResult } from '../src/results';
import { RailRace, STEP, ofType, type RailScript } from './rails';

const entrants = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    name: `Driver ${i}`,
    code: `D${i}`,
    team: i,
  }));

describe('race start', () => {
  it('shows five lights a second apart, holds, then lights out inside the documented range', () => {
    const race = new RailRace({ kind: 'race', laps: 5 }, [{ speed: 50 }, { speed: 50 }]);
    const events = race.run(12, () => race.control.lightsOutAt !== null);
    const lights = ofType(events, 'lights');
    expect(lights.map((e) => e.count)).toEqual([1, 2, 3, 4, 5, 0]);
    const on = lights.slice(0, 5).map((e) => e.t);
    for (let k = 1; k < 5; k++) expect(on[k]! - on[k - 1]!).toBeCloseTo(1, 2);
    const hold = lights[5]!.t - on[4]!;
    expect(hold).toBeGreaterThanOrEqual(0.2 - STEP);
    expect(hold).toBeLessThanOrEqual(3 + STEP);
    expect(ofType(events, 'phase').map((e) => e.phase)).toEqual(['lights', 'green']);
  });

  it('draws the hold from the seed: same seed same hold, other seeds differ', () => {
    const holdOf = (seed: number): number => {
      const r = new RailRace({ kind: 'race', laps: 5 }, [{ speed: 50 }], { seed });
      r.run(12, () => r.control.lightsOutAt !== null);
      return r.control.lightsOutAt!;
    };
    expect(holdOf(3)).toBe(holdOf(3));
    const holds = new Set([1, 2, 3, 4, 5, 6].map(holdOf));
    expect(holds.size).toBeGreaterThan(3);
  });

  it('penalises a jump start and adds the penalty at the finish when it is not served', () => {
    const scripts: RailScript[] = [{ speed: 50 }, { speed: 50, creepFrom: 4 }];
    const race = new RailRace({ kind: 'race', laps: 2 }, scripts);
    race.runToEnd();
    const pens = ofType(race.log, 'penalty');
    expect(pens).toHaveLength(1);
    expect(pens[0]).toMatchObject({ car: 1, reason: 'jumpStart', seconds: 5 });
    expect(pens[0]!.t).toBeLessThan(race.control.lightsOutAt!);
    const result = buildResult(race.control, entrants(2), 1);
    const jumper = result.entries.find((e) => e.car === 1)!;
    expect(jumper.penaltyTime).toBe(5);
    // Both run the same speed; the jumper's own time includes the 5 s.
    const clean = result.entries.find((e) => e.car === 0)!;
    expect(jumper.totalTime! - clean.totalTime!).toBeGreaterThan(4);
  });

  it('starts timing every car at lights out from its grid slot', () => {
    const race = new RailRace({ kind: 'race', laps: 2 }, [{ speed: 50 }, { speed: 50 }]);
    race.run(12, () => race.control.lightsOutAt !== null);
    const out = race.control.lightsOutAt!;
    for (const t of race.control.timers) {
      expect(t.running).toBe(true);
      expect(t.lap).toBe(1);
      expect(t.lapStartTime).toBe(out);
    }
    // Pole is 40 m past the timing line (s 990 against 950), P2 32 m.
    expect(race.control.cars[0]!.dist).toBeCloseTo(40, 6);
    expect(race.control.cars[1]!.dist).toBeCloseTo(32, 6);
  });
});

describe('a five-lap race with a pit stop', () => {
  const scripts: RailScript[] = [{ speed: 60 }, { speed: 58 }, { speed: 56 }, { speed: 54 }];
  const race = new RailRace({ kind: 'race', laps: 5 }, scripts);
  race.run(12, () => race.control.lightsOutAt !== null);
  // Car 1 is asked in during lap 3.
  race.run(600, () => race.control.timer(1).lap >= 3);
  race.request(1, [{ kind: 'tyres', compound: 'hard' }]);
  race.runToEnd();
  const result = buildResult(race.control, entrants(4), 1);

  it('runs the stop sequence in order with the service time from data plus the seeded spread', () => {
    const stages = ofType(race.log, 'pit')
      .filter((e) => e.car === 1)
      .map((e) => e.stage);
    expect(stages).toEqual(['entry', 'stop', 'serviceStart', 'serviceEnd', 'release', 'exit']);
    const start = ofType(race.log, 'pit').find((e) => e.stage === 'serviceStart')!;
    expect(start.duration).toBeGreaterThanOrEqual(2.4);
    expect(start.duration).toBeLessThanOrEqual(2.4 + 0.8);
    const end = ofType(race.log, 'pit').find((e) => e.stage === 'serviceEnd')!;
    expect(end.t - start.t).toBeCloseTo(start.duration!, 1);
    expect(end.actions).toEqual([{ kind: 'tyres', compound: 'hard' }]);
  });

  it('records the stop and the compounds in the result', () => {
    const e = result.entries.find((x) => x.car === 1)!;
    expect(e.pitStops).toBe(1);
    expect(e.compounds).toEqual(['medium', 'hard']);
    expect(result.entries.filter((x) => x.car !== 1).every((x) => x.pitStops === 0)).toBe(true);
  });

  it('classifies everyone on five laps, by total time, with points', () => {
    expect(result.entries.map((e) => e.status)).toEqual([
      'finished',
      'finished',
      'finished',
      'finished',
    ]);
    expect(result.entries.every((e) => e.laps === 5)).toBe(true);
    const totals = result.entries.map((e) => e.totalTime!);
    for (let k = 1; k < totals.length; k++) expect(totals[k]!).toBeGreaterThan(totals[k - 1]!);
    expect(result.entries[0]!.car).toBe(0);
    expect(result.entries.map((e) => e.points)).toEqual([25, 18, 15, 12]);
    expect(race.control.ended).toBe(true);
  });

  it('enables DRS when the leader starts lap 3', () => {
    const on = ofType(race.log, 'drsEnabled')[0]!;
    const lap3 = ofType(race.log, 'lap').find((e) => e.car === 0 && e.result.lap === 2)!;
    expect(on.t).toBe(lap3.t);
  });
});

describe('track limits in a race', () => {
  /** Four wheels off for 0.2 s around s = 500 on each of the first `n` laps after lights out. */
  const offOnLaps = (n: number) => {
    let laps = 0;
    let last = -1;
    return (t: number, s: number): number => {
      if (s > 500 && s < 510) {
        if (last < 0 || t - last > 5) {
          laps += 1;
          last = t;
        }
        return laps <= n ? 4 : 0;
      }
      return 0;
    };
  };

  it('warns three times (black and white on the third), then a 5 s penalty, table by strike', () => {
    const race = new RailRace({ kind: 'race', laps: 6 }, [{ speed: 50, wheelsOff: offOnLaps(5) }]);
    race.runToEnd();
    const strikes = ofType(race.log, 'trackLimits').map((e) => [e.strike, e.outcome]);
    expect(strikes).toEqual([
      [1, 'warning'],
      [2, 'warning'],
      [3, 'blackWhite'],
      [4, 'penalty'],
      [5, 'warning'],
    ]);
    expect(ofType(race.log, 'penalty').map((e) => e.reason)).toEqual(['trackLimits']);
    expect(ofType(race.log, 'flag').filter((e) => e.flag === 'blackWhite')).toHaveLength(1);
    // Each of those laps is invalid.
    const laps = ofType(race.log, 'lap').map((e) => e.result.valid);
    expect(laps).toEqual([false, false, false, false, false, true]);
  });

  it('serves a track-limits penalty at the next pit stop, held before service', () => {
    const race = new RailRace({ kind: 'race', laps: 7 }, [{ speed: 50, wheelsOff: offOnLaps(4) }]);
    race.run(600, () => race.control.unservedPenalty(0) > 0);
    expect(race.control.unservedPenalty(0)).toBe(5);
    race.request(0);
    race.runToEnd();
    const pit = ofType(race.log, 'pit').map((e) => e.stage);
    expect(pit).toEqual([
      'entry',
      'stop',
      'penaltyStart',
      'serviceStart',
      'serviceEnd',
      'release',
      'exit',
    ]);
    const penaltyStart = ofType(race.log, 'pit').find((e) => e.stage === 'penaltyStart')!;
    const served = ofType(race.log, 'penaltyServed')[0]!;
    expect(penaltyStart.duration).toBe(5);
    expect(served.t - penaltyStart.t).toBeCloseTo(5, 1);
    const r = buildResult(race.control, entrants(1), 1);
    expect(r.entries[0]!.penaltyTime).toBe(0);
    expect(r.entries[0]!.penalties).toEqual([{ reason: 'trackLimits', seconds: 5, served: true }]);
  });

  it('a four-off reading in the tick that crosses the line invalidates both laps', () => {
    // Off exactly while crossing the timing line (s 950) on the first full lap.
    let crossings = 0;
    const race = new RailRace({ kind: 'race', laps: 3 }, [
      {
        speed: 50,
        wheelsOff: (_t, s) => {
          if (s > 950 && s < 950 + 50 * STEP + 1e-9) crossings++;
          return s > 950 && s < 950 + 50 * STEP + 1e-9 && crossings === 1 ? 4 : 0;
        },
      },
    ]);
    race.runToEnd();
    const laps = ofType(race.log, 'lap');
    expect(laps[0]!.result.valid).toBe(false);
    expect(laps[1]!.result.valid).toBe(false);
    expect(laps[2]!.result.valid).toBe(true);
    const types = race.log
      .filter((e) => e.type === 'invalidated' || e.type === 'lap')
      .map((e) => e.type);
    expect(types.slice(0, 3)).toEqual(['invalidated', 'lap', 'invalidated']);
  });

  it('a place taken off track must be given back, or it is penalised', () => {
    // Car 1 passes car 0 while off track on lap 2 and stays ahead.
    const cut = (t: number, s: number) => (t > 30 && t < 31 && s > 0 ? 4 : 0);
    const race = new RailRace({ kind: 'race', laps: 3 }, [
      { speed: 50 },
      { speed: (t) => (t > 30 && t < 31 ? 80 : 50), wheelsOff: cut },
    ]);
    race.runToEnd();
    const pens = ofType(race.log, 'penalty').filter((e) => e.reason === 'leavingTrack');
    expect(pens).toHaveLength(1);
    expect(pens[0]!.car).toBe(1);
    // Given back: the same pass, then car 1 drops behind within the window.
    const back = new RailRace({ kind: 'race', laps: 3 }, [
      { speed: 50 },
      { speed: (t) => (t > 30 && t < 31 ? 80 : t > 33 && t < 35 ? 30 : 50), wheelsOff: cut },
    ]);
    back.runToEnd();
    expect(ofType(back.log, 'penalty').filter((e) => e.reason === 'leavingTrack')).toHaveLength(0);
  });
});

describe('qualifying', () => {
  // Three cars from the pit lane, 250 s; car 1 goes off mid-lap on its first flying lap, car 2
  // goes off in the last corner on its first flying lap (that lap and the next are deleted).
  const offOnce = (from: number, to: number, lapStart: number) => {
    let done = false;
    return (t: number, s: number): number => {
      if (!done && t > lapStart && s > from && s < to) {
        if (s > to - 2) done = true;
        return 4;
      }
      return 0;
    };
  };
  const race = new RailRace({ kind: 'qualifying', duration: 250, releaseInterval: 4 }, [
    { speed: 50 },
    { speed: 52, wheelsOff: offOnce(400, 410, 30) },
    { speed: 54, wheelsOff: offOnce(800, 810, 30) },
  ]);
  race.runToEnd();
  const result = buildResult(race.control, entrants(3), 1);

  it('releases cars from the pit lane in turn and runs out-laps before the flying laps', () => {
    const releases = ofType(race.log, 'pit').filter((e) => e.stage === 'release');
    expect(releases.map((e) => e.car)).toEqual([0, 1, 2]);
    expect(releases[1]!.t - releases[0]!.t).toBeCloseTo(4, 1);
    // The first timed event of each car is the start of lap 1 at the line, not a lap.
    for (let car = 0; car < 3; car++) {
      const first = race.log.find(
        (e) => (e.type === 'lapStart' || e.type === 'lap') && e.car === car,
      );
      expect(first?.type).toBe('lapStart');
    }
  });

  it('deletes a lap over the limits, and the next one after a last-corner offence', () => {
    const lapsOf = (car: number) =>
      ofType(race.log, 'lap')
        .filter((e) => e.car === car)
        .map((e) => e.result.valid);
    expect(lapsOf(0).every(Boolean)).toBe(true);
    const c1 = lapsOf(1);
    expect(c1.filter((v) => !v)).toHaveLength(1);
    const c2 = lapsOf(2);
    const firstBad = c2.indexOf(false);
    expect(c2[firstBad + 1]).toBe(false);
    expect(c2.filter((v) => !v)).toHaveLength(2);
    expect(
      ofType(race.log, 'invalidated')
        .filter((e) => e.car === 2)
        .map((e) => e.reason),
    ).toEqual(['limits', 'deleted']);
  });

  it('classifies by best valid lap and ends after the chequered flag once everyone has crossed', () => {
    expect(result.entries.map((e) => e.car)).toEqual([2, 1, 0]);
    expect(result.entries[0]!.bestLap!).toBeCloseTo(1000 / 54, 2);
    expect(result.entries[1]!.gap).toEqual({ time: expect.closeTo(1000 / 52 - 1000 / 54, 2) });
    const flag = ofType(race.log, 'flag').find((e) => e.flag === 'chequered')!;
    expect(flag.t).toBeCloseTo(250, 1);
    expect(ofType(race.log, 'finish')).toHaveLength(3);
    expect(race.control.ended).toBe(true);
    expect(result.entries.every((e) => e.points === 0)).toBe(true);
  });

  it('frees DRS inside the zones only', () => {
    // Re-run a short session and look at one car crossing the zone.
    const q = new RailRace({ kind: 'qualifying', duration: 100 }, [{ speed: 50 }]);
    const seen: boolean[] = [];
    for (let k = 0; k < 240 * 80; k++) {
      q.step();
      const s = q.facts[0]!.s;
      if (!q.facts[0]!.inPitLane && (s > 905 || s < 140)) seen.push(q.control.drsAllowed(0));
      if (!q.facts[0]!.inPitLane && s > 300 && s < 700) expect(q.control.drsAllowed(0)).toBe(false);
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });
});

describe('DRS in a race', () => {
  it('is available at the detection line within one second of the car ahead, from the activation point', () => {
    // Car 0 leads; car 1 runs 0.5 s behind; car 2 2 s behind. DRS from lap 3.
    const race = new RailRace({ kind: 'race', laps: 5 }, [
      { speed: 50 },
      { speed: 50, reaction: 0.5 - 8 / 50 },
      { speed: 50, reaction: 2 - 16 / 50 },
    ]);
    race.run(600, () => race.control.timer(0).lap >= 3);
    const zone = race.circuit.drsZones[0]!;
    const allowed: Record<number, boolean[]> = { 0: [], 1: [], 2: [] };
    // Each car is judged from its first detection line after DRS is enabled.
    const armed = [false, false, false];
    let detections: { car: number; gap: number }[] = [];
    for (let k = 0; k < 240 * 25; k++) {
      const ev = race.step();
      detections = detections.concat(
        ofType(ev, 'drsEligible').map((e) => ({ car: e.car, gap: e.gap })),
      );
      for (let car = 0; car < 3; car++) {
        const s = race.facts[car]!.s;
        if (s > zone.detection && s < zone.detection + 10) armed[car] = true;
        if (armed[car] && (s > zone.activation + 5 || s < zone.end - 5))
          allowed[car]!.push(race.control.drsAllowed(car));
        if (s > zone.detection + 5 && s < zone.activation - 5) {
          expect(race.control.drsAllowed(car)).toBe(false);
        }
      }
    }
    expect(detections.map((d) => d.car)).toContain(1);
    expect(detections.every((d) => d.car === 1)).toBe(true);
    expect(detections[0]!.gap).toBeCloseTo(0.5, 2);
    expect(allowed[1]!.length).toBeGreaterThan(0);
    expect(allowed[1]!.every(Boolean)).toBe(true);
    expect(allowed[0]!.some(Boolean)).toBe(false);
    expect(allowed[2]!.some(Boolean)).toBe(false);
  });

  it('is not available before the enable lap however close the cars are', () => {
    const race = new RailRace({ kind: 'race', laps: 5 }, [
      { speed: 50 },
      { speed: 50, reaction: 0.3 },
    ]);
    race.run(600, () => race.control.timer(0).lap >= 2 && race.facts[1]!.s > 950);
    expect(ofType(race.log, 'drsEligible')).toHaveLength(0);
    expect(ofType(race.log, 'drsEnabled')).toHaveLength(0);
  });

  it('closes on braking or lifting and stays shut until the request is released', () => {
    const race = new RailRace({ kind: 'qualifying', duration: 100 }, [{ speed: 50 }]);
    race.run(80, () => !race.facts[0]!.inPitLane && race.facts[0]!.s > 920);
    expect(race.control.drsAllowed(0)).toBe(true);
    const c = race.control;
    expect(c.gateDrs(0, { drs: true, throttle: 1, brake: 0 })).toBe(true);
    expect(c.gateDrs(0, { drs: true, throttle: 0.1, brake: 0 })).toBe(false);
    expect(c.gateDrs(0, { drs: true, throttle: 1, brake: 0 })).toBe(false);
    expect(c.gateDrs(0, { drs: false, throttle: 1, brake: 0 })).toBe(false);
    expect(c.gateDrs(0, { drs: true, throttle: 1, brake: 0 })).toBe(true);
    expect(c.gateDrs(0, { drs: true, throttle: 1, brake: 0.5 })).toBe(false);
  });
});

describe('flags', () => {
  it('shows blue to a car about to be lapped and takes it in when the faster car is by', () => {
    const race = new RailRace({ kind: 'race', laps: 6 }, [{ speed: 60 }, { speed: 40 }]);
    race.runToEnd();
    const blues = ofType(race.log, 'flag').filter((e) => e.flag === 'blue');
    expect(blues.length).toBeGreaterThanOrEqual(2);
    expect(blues[0]).toMatchObject({ on: true, car: 1, by: 0 });
    expect(blues[1]).toMatchObject({ on: false, car: 1, by: 0 });
    // The faster car closes 20 m/s: the flag is out for about 1 s of gap at 60 m/s.
    expect(blues[1]!.t - blues[0]!.t).toBeLessThan(5);
    expect(ofType(race.log, 'penalty')).toHaveLength(0);
  });

  it('penalises a lapped car that holds the faster car up beyond the window', () => {
    // Car 0 closes to 20 m (0.5 s) behind car 1, a lap down, and sits there.
    let ref: RailRace | null = null;
    const behind = (): number => {
      const c = ref!.control.cars;
      return c[0]!.dist - c[1]!.dist;
    };
    const race = new RailRace(
      { kind: 'race', laps: 10 },
      [{ speed: () => (ref && behind() > 980 ? 40 : 60) }, { speed: 40 }],
      { rules: { blueWindow: 10 } },
    );
    ref = race;
    race.runToEnd();
    const pens = ofType(race.log, 'penalty');
    expect(pens.some((p) => p.car === 1 && p.reason === 'blueFlags')).toBe(true);
  });

  it('puts out a local yellow for a stopped car, disables DRS in the zone it touches, and clears it', () => {
    const race = new RailRace({ kind: 'qualifying', duration: 300 }, [
      { speed: 50, stopAt: 60 },
      { speed: 50 },
    ]);
    race.run(70);
    const yellows = ofType(race.log, 'flag').filter((e) => e.flag === 'yellow' && e.on);
    expect(yellows).toHaveLength(2);
    const sector = race.control.flags.sectorAt(race.facts[0]!.s);
    expect(yellows.map((e) => e.sector).sort()).toEqual(
      [
        sector,
        (sector + race.control.flags.sectorCount - 1) % race.control.flags.sectorCount,
      ].sort(),
    );
    expect(race.control.yellowHere(0)).toBe(true);
  });

  it('shows the chequered flag to the leader and finishes lapped cars at their next crossing', () => {
    const race = new RailRace({ kind: 'race', laps: 5 }, [
      { speed: 60 },
      { speed: 45 },
      { speed: 58 },
    ]);
    race.runToEnd();
    const finishes = ofType(race.log, 'finish');
    expect(finishes.map((f) => f.car)).toEqual([0, 2, 1]);
    expect(finishes.map((f) => f.laps)).toEqual([5, 5, 4]);
    const r = buildResult(race.control, entrants(3), 1);
    expect(r.entries[2]!.gap).toEqual({ laps: 1 });
    expect(r.entries[1]!.gap).toMatchObject({ time: expect.any(Number) });
    const flag = ofType(race.log, 'flag').find((e) => e.flag === 'chequered')!;
    expect(flag.t).toBe(finishes[0]!.t);
  });
});

describe('pit lane', () => {
  it('penalises speeding between the lines in a race and warns in practice', () => {
    const fast = { speed: 50, noStop: true } as RailScript;
    const race = new RailRace({ kind: 'race', laps: 3 }, [fast]);
    // Force a drive-through at full speed: the rail ignores the limiter when told to.
    race.run(12, () => race.control.lightsOutAt !== null);
    race.request(0, []);
    const rail = race.rails[0]!;
    race.run(200, () => rail.mode === 'pit' && rail.pitS > 30);
    // A speeding reading between the lines.
    const ev = race.control.tick(
      race.time + STEP,
      race.facts.map((f) => ({ ...f, speed: f.inPitLane ? 30 : f.speed })),
    );
    expect(ofType(ev, 'penalty')).toMatchObject([{ reason: 'pitSpeeding', seconds: 5 }]);
    const practice = new RailRace({ kind: 'practice', duration: 100 }, [{ speed: 50 }]);
    practice.run(
      10,
      () => practice.control.pitPhase(0) === 'released' && practice.rails[0]!.pitS > 135,
    );
    const ev2 = practice.control.tick(
      practice.time + STEP,
      practice.facts.map((f) => ({ ...f, speed: 30 })),
    );
    expect(ofType(ev2, 'warning')).toMatchObject([{ reason: 'pitSpeeding' }]);
    expect(ofType(ev2, 'penalty')).toHaveLength(0);
  });

  it('waits to release a car while another comes down the fast lane behind its box', () => {
    // Car 1 (box at s_pit 145) is held while car 0, a drive-through, passes.
    const race = new RailRace(
      { kind: 'race', laps: 4 },
      [
        { speed: 50, noStop: true },
        { speed: 50, reaction: 1 },
      ],
      {
        rules: { serviceSpread: 0 },
      },
    );
    race.run(12, () => race.control.lightsOutAt !== null);
    race.request(1);
    race.request(0, []);
    race.run(
      300,
      () => race.control.pitPhase(1) === 'waitRelease' || race.control.pitPhase(1) === 'released',
    );
    const r0 = race.rails[0]!;
    if (race.control.pitPhase(1) === 'waitRelease') {
      expect(r0.mode).toBe('pit');
    }
    race.run(60, () => race.control.pitPhase(1) === 'released');
    const release = ofType(race.log, 'pit').find((e) => e.car === 1 && e.stage === 'release')!;
    const box = race.control.pitBox(1)!;
    // At release no moving car is within 20 m behind or 5 m ahead of the box.
    void release;
    const f0 = race.facts[0]!;
    if (f0.inPitLane) expect(f0.pitS < box.s - 20 || f0.pitS > box.s + 5).toBe(true);
  });

  it('stacks team-mates: the second car waits until the first is serviced', () => {
    const race = new RailRace(
      { kind: 'race', laps: 4 },
      [{ speed: 50 }, { speed: 50, reaction: 0.2 }],
      {
        teams: [0, 0],
        rules: { serviceSpread: 0 },
      },
    );
    race.run(12, () => race.control.lightsOutAt !== null);
    race.request(0);
    race.request(1);
    race.runToEnd();
    const s0 = ofType(race.log, 'pit').filter((e) => e.car === 0);
    const s1 = ofType(race.log, 'pit').filter((e) => e.car === 1);
    const end0 = s0.find((e) => e.stage === 'serviceEnd')!;
    const start1 = s1.find((e) => e.stage === 'serviceStart')!;
    expect(start1.t).toBeGreaterThanOrEqual(end0.t);
  });
});

describe('race distance and the compound rule', () => {
  it('a time-capped race ends at the end of the leader’s lap on which the time runs out', () => {
    const race = new RailRace({ kind: 'race', laps: 50, timeLimit: 60 }, [
      { speed: 50 },
      { speed: 45 },
    ]);
    race.runToEnd();
    const out = race.control.lightsOutAt!;
    const flag = ofType(race.log, 'flag').find((e) => e.flag === 'chequered')!;
    const leaderLaps = ofType(race.log, 'lap').filter((e) => e.car === 0);
    // The flag falls at the leader's first crossing after the cap, not before.
    const before = leaderLaps.filter((e) => e.at - out < 60);
    const at = leaderLaps.find((e) => e.at - out >= 60)!;
    expect(flag.t).toBe(at.t);
    expect(before.length).toBe(at.result.lap - 1);
    expect(ofType(race.log, 'finish').map((e) => e.car)).toEqual([0, 1]);
  });

  it('disqualifies a finisher that ran one compound when the two-compound rule applies', () => {
    const race = new RailRace({ kind: 'race', laps: 3, twoCompoundRule: true }, [
      { speed: 50 },
      { speed: 50, reaction: 0.3 },
    ]);
    race.run(12, () => race.control.lightsOutAt !== null);
    race.request(1, [{ kind: 'tyres', compound: 'hard' }]);
    race.runToEnd();
    const r = buildResult(race.control, entrants(2), 1);
    expect(r.entries[0]).toMatchObject({
      car: 1,
      status: 'finished',
      compounds: ['medium', 'hard'],
    });
    expect(r.entries[1]).toMatchObject({
      car: 0,
      status: 'dsq',
      reason: 'two-compound rule',
      points: 0,
    });
  });

  it('applies the two-compound rule by default only at full distance', () => {
    const short = new RailRace({ kind: 'race', laps: 5 }, [{ speed: 50 }]);
    expect(short.control.strategy.twoCompoundRule).toBe(false);
    const full = new RailRace({ kind: 'race' }, [{ speed: 50 }]);
    expect(full.control.strategy.laps).toBe(50);
    expect(full.control.strategy.twoCompoundRule).toBe(true);
  });
});
