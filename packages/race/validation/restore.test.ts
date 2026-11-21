import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../src/events';
import type { RaceSession, RaceSessionSnapshot } from '../src/session/session';
import { aiSession } from './lib/runner';

// Physics job, review of #15 item 2: a session snapshot holds the drivers' memory (AI driver,
// launch, pit-lane follower) and every cache, so a session restored from it continues bit for
// bit: the same inputs every tick, the same events, the same result.

const spec = { kind: 'race' as const, laps: 2 };
const opts = { cars: 3, seed: 4 };

/** The pit request rule, from state only, so a restored session issues it identically. */
function strategy(s: RaceSession): void {
  const c = s.control;
  if (
    c.racing(1) &&
    c.timer(1).lap >= 1 &&
    c.cars[1]!.pitStops === 0 &&
    !c.pitRequested(1) &&
    c.pitPhase(1) === 'none'
  ) {
    s.requestPit(1, [{ kind: 'tyres', compound: 'hard' }]);
  }
}

interface Tick {
  inputs: number[];
  events: RaceEvent[];
}

function step(s: RaceSession): Tick {
  strategy(s);
  const events = s.tick();
  const inputs: number[] = [];
  for (const car of s.world.cars) {
    const i = car.input;
    inputs.push(
      i.steer,
      i.throttle,
      i.brake,
      i.gearShift,
      i.drs ? 1 : 0,
      i.overtake ? 1 : 0,
      i.pitLimiter ? 1 : 0,
    );
  }
  return { inputs, events };
}

describe('session snapshots over the real sim', () => {
  // The reference run, with snapshots at the points of interest.
  const a = aiSession(spec, opts);
  const log: Tick[] = [];
  const snaps: { name: string; at: number; snap: RaceSessionSnapshot }[] = [];
  const want = new Set(['lights', 'race', 'pitApproach', 'service']);
  const take = (name: string) => {
    if (!want.has(name)) return;
    want.delete(name);
    snaps.push({
      name,
      at: log.length,
      snap: JSON.parse(JSON.stringify(a.snapshot())) as RaceSessionSnapshot,
    });
  };
  while (!a.ended && a.time < 600) {
    const c = a.control;
    if (c.phase === 'lights' && c.lightsCount >= 3) take('lights');
    if (c.racing(0) && a.time > 40) take('race');
    // Turning for the pit lane at the end of lap 1 (the follower takes over 120 m before it).
    const car1 = a.carFacts(1);
    if (
      a.time > 60 &&
      c.pitRequested(1) &&
      c.pitPhase(1) === 'none' &&
      car1.s > 5140 &&
      car1.s < 5235
    )
      take('pitApproach');
    if (c.pitPhase(1) === 'service') take('service');
    log.push(step(a));
  }
  const result = a.result();

  it('took every snapshot and finished the reference run', () => {
    expect(snaps.map((s) => s.name)).toEqual(['lights', 'race', 'pitApproach', 'service']);
    expect(a.ended).toBe(true);
    expect(result.entries.find((e) => e.car === 1)!.pitStops).toBe(1);
  });

  for (const name of ['lights', 'race', 'pitApproach', 'service']) {
    it(`continues bit for bit after a restore (${name})`, () => {
      const s = snaps.find((x) => x.name === name)!;
      const b = aiSession(spec, opts);
      b.restore(JSON.parse(JSON.stringify(s.snap)) as RaceSessionSnapshot);
      expect(JSON.parse(JSON.stringify(b.snapshot()))).toEqual(s.snap);
      for (let k = s.at; k < log.length; k++) {
        const t = step(b);
        const ref = log[k]!;
        if (
          t.inputs.some((v, j) => v !== ref.inputs[j]) ||
          JSON.stringify(t.events) !== JSON.stringify(ref.events)
        ) {
          expect({ tick: k, inputs: t.inputs, events: t.events }).toEqual({
            tick: k,
            inputs: ref.inputs,
            events: ref.events,
          });
        }
      }
      expect(b.ended).toBe(true);
      expect(b.result()).toEqual(result);
    });
  }
});
