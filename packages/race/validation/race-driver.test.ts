import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RACE_SKILL,
  createRaceDriver,
  type Driver,
  type RaceSkill,
  type TrafficView,
} from '@undercut/ai';
import { createCarParams, type CarTelemetry, type ControlInput } from '@undercut/sim';
import { MONZA, loadEnvelope, loadLine } from '../../ai/validation/lib/index';
import type { RaceEvent } from '../src/events';
import { AiController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { entrantsFor, runSession } from './lib/runner';

// The racing driver in closed loop on the real sim at Monza (physics job): a pass, a car being
// lapped under blue flags, and a spin recovery in traffic. Decision-level tests with scripted
// motion are in packages/ai/test/race-driver.test.ts.

const track = MONZA.track();
const line = loadLine(MONZA);
const envelope = loadEnvelope(MONZA);
const params = createCarParams(MONZA.trim);

function racer(skill: Partial<RaceSkill>, seed: number): Driver {
  return createRaceDriver({
    track,
    line,
    envelope,
    params,
    skill: { ...DEFAULT_RACE_SKILL, ...skill, seed },
  });
}

/** A racing driver that never uses more than `cap` throttle: a car far off the pace. */
class Hobbled implements Driver {
  readonly name = 'hobbled';
  constructor(
    private readonly inner: Driver,
    private readonly cap: number,
  ) {}
  get ersMode() {
    return this.inner.ersMode;
  }
  get following() {
    return this.inner.following === true;
  }
  sense(v: TrafficView): void {
    this.inner.sense?.(v);
  }
  reset(): void {
    this.inner.reset();
  }
  snapshot() {
    return this.inner.snapshot();
  }
  restore(m: ReturnType<Driver['snapshot']>): void {
    this.inner.restore(m);
  }
  drive(t: CarTelemetry, dt: number, out: ControlInput): ControlInput {
    this.inner.drive(t, dt, out);
    out.throttle = Math.min(out.throttle, this.cap);
    out.overtake = false;
    return out;
  }
}

function race(drivers: Driver[], laps: number, seed: number): RaceSession {
  const entrants = entrantsFor(drivers.length);
  return new RaceSession({
    track,
    session: { kind: 'race', laps },
    seed,
    params,
    cars: drivers.map((driver, i) => ({
      entrant: entrants[i]!,
      controller: new AiController({ driver, params, reaction: 0.25 + 0.05 * i }),
      ersMode: driver.ersMode,
    })),
  });
}

const flags = (events: readonly RaceEvent[]) =>
  events.filter((e) => e.type === 'flag' && e.flag === 'blue' && e.on);

describe('race driver on the sim', () => {
  it('a faster car catches a slower one ahead, passes it on track and pulls away', () => {
    // Pole: a car down on power (75 % throttle at most). Second on the grid: the reference pace.
    const s = race([new Hobbled(racer({}, 11), 0.75), racer({ pace: 1, braking: 1 }, 12)], 3, 4);
    const run = runSession(s, { pitLap: null });
    expect(run.result.anomalies).toEqual([]);
    expect(run.result.entries[0]!.car).toBe(1);
    expect(run.racing.overtakes).toBeGreaterThanOrEqual(1);
    expect(run.cars.every((c) => c.longestContact < 0.5 && c.spins === 0)).toBe(true);
  }, 180_000);

  it('a car being lapped is shown the blue flag, moves over and lets the leader by', () => {
    const s = race([racer({ pace: 1, braking: 1 }, 21), new Hobbled(racer({}, 22), 0.3)], 5, 5);
    const run = runSession(s, { pitLap: null });
    const blue = flags(run.events);
    expect(blue.length).toBeGreaterThan(0);
    expect(blue.every((e) => e.type === 'flag' && e.car === 1 && e.by === 0)).toBe(true);
    // Let by within the time allowed: no penalty, and the leader a lap up at the flag.
    expect(run.events.filter((e) => e.type === 'penalty')).toEqual([]);
    const [first, second] = run.result.entries;
    expect(first!.car).toBe(0);
    expect(first!.laps - second!.laps).toBeGreaterThanOrEqual(1);
    expect(run.cars.every((c) => c.longestContact < 0.5)).toBe(true);
    expect(run.result.anomalies).toEqual([]);
  }, 300_000);

  it('a car spun round on the straight waits for the traffic, turns back and rejoins', () => {
    const s = race(
      [racer({}, 31), racer({}, 32), racer({ pace: 0.8 }, 33), racer({ pace: 0.8 }, 34)],
      2,
      6,
    );
    // Run to the second lap, then turn car 3 round on the main straight in front of the others.
    while (s.control.timer(0).lap < 2 && s.time < 400) s.tick();
    const lead = s.carFacts(0).s;
    const at = s.lapPose(lead + 250, 0);
    s.placeCar(3, at.x, at.z, at.yaw + Math.PI, 0);
    let turned: number | null = null;
    let contact = 0;
    const start = s.time;
    while (!s.ended && s.time < start + 300) {
      s.tick();
      const st = s.worldCar(3).state;
      if (st.carContacts > 0) contact++;
      const ok = Math.cos(st.yaw - at.yaw) > 0.9 && st.vx > 10;
      if (turned === null && ok) turned = s.time - start;
    }
    expect(turned).not.toBeNull();
    expect(turned!).toBeLessThan(40);
    expect(contact).toBe(0);
    expect(s.result().entries.every((e) => e.status === 'finished')).toBe(true);
  }, 300_000);
});
