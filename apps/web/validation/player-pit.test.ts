import { expect, it } from 'vitest';
import { PathFollower } from '@undercut/ai';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { DriveSession } from '../src/game/session';
import { MONZA, SPA, SINGAPORE, loadLine, loadEnvelope } from '../../../packages/ai/validation/lib';
import { pitInPath, pitOutPath } from '@undercut/race';
import { carStopped } from '../src/game/stopped';
for (const setup of [MONZA, SPA, SINGAPORE]) {
  it(`${setup.id}: player calls, drives in, changes tyres and is released without contact`, () => {
    const track = setup.track();
    const session = new DriveSession({
      track,
      seed: 3141,
      quickRace: { laps: 5, gridPosition: 1, fieldStartDelay: 55 },
      raceArtefacts: { line: loadLine(setup), envelope: loadEnvelope(setup) },
    });
    session.start();
    while (session.race.control.phase !== 'green') session.tick({ ...NEUTRAL_INPUT }, 'keyboard');
    const start = track.wrap(track.pit.entryS - 110);
    session.teleport(start, 0, 30);
    expect(session.boxThisLap()).toBe(true);
    expect(session.boxThisLap()).toBe(false);
    expect(session.race.control.pitRequested(0)).toBe(false);
    expect(session.boxThisLap()).toBe(true);
    session.car.state.tyreWear.fill(0.5);
    const follower = new PathFollower(session.params);
    follower.setPath(
      pitInPath(track, session.race.circuit, start, 0, session.race.control.pitBox(0)!),
      true,
    );
    const input = { ...NEUTRAL_INPUT };
    const begin = session.world.time;
    let serviceAt: number | null = null;
    let serviceEnd: number | null = null;
    let exited = false;
    let contacts = 0;
    const stages: string[] = [];
    while (session.world.time - begin < 120 && !exited) {
      follower.drive(session.readTelemetry(), session.world.step, input);
      session.tick(input, 'keyboard');
      contacts += session.car.state.carContacts;
      for (const e of session.raceEvents.splice(0)) {
        if (e.type !== 'pit' || e.car !== 0) continue;
        stages.push(e.stage);
        if (e.stage === 'serviceStart') {
          serviceAt = e.t;
          // At rest in the box: no stopped-car prompt, and a reset does not cut the stop short.
          const prompt = {
            playing: true,
            time: session.world.time,
            speed: session.readTelemetry().speed,
            surface: session.surfaceUnderCar(),
          };
          // (The box is off the lap's asphalt: without the pit state the prompt would show.)
          expect(carStopped(prompt)).toBe(true);
          expect(carStopped({ ...prompt, inPit: session.inPit })).toBe(false);
          expect(session.resetToTrack()).toEqual([]);
          expect(session.race.control.held(0)).toBe(true);
          expect(session.race.carFacts(0).inPitLane).toBe(true);
        }
        if (e.stage === 'serviceEnd') {
          serviceEnd = e.t;
          expect(Math.max(...session.car.state.tyreWear)).toBeLessThan(0.001);
        }
        if (e.stage === 'exit') exited = true;
      }
    }
    console.warn(setup.id, { stages, elapsed: session.world.time - begin, contacts });
    expect(exited).toBe(true);
    expect(stages).toEqual(['entry', 'stop', 'serviceStart', 'serviceEnd', 'release', 'exit']);
    expect(serviceEnd! - serviceAt!).toBeGreaterThanOrEqual(2.4);
    expect(serviceEnd! - serviceAt!).toBeLessThan(3.21);
    expect(session.world.time - begin).toBeGreaterThan(10);
    expect(session.world.time - begin).toBeLessThan(90);
    expect(contacts).toBe(0);
    expect(session.race.control.cars[0]!.compounds).toEqual(['medium', 'hard']);
    expect(session.race.control.cars[0]!.pitStops).toBe(1);
    // No request: drive through, with manual limiter off. Speeding remains a real offence.
    session.automaticLimiter = false;
    const sp = session.race.circuit.pit.limitStart + 10;
    const pose = track.pit.path.pointAt(sp, 0, { x: 0, y: 0, z: 0 });
    const tangent = track.pit.path.tangent(sp, { x: 0, y: 0, z: 0 });
    session.race.placeCar(0, pose.x, pose.z, Math.atan2(-tangent.z, tangent.x), 40);
    follower.reset();
    follower.setPath(pitOutPath(track, session.race.circuit, sp, 0), false);
    const through = session.world.time;
    let speeding = false;
    while (session.world.time - through < 90) {
      follower.drive(session.readTelemetry(), session.world.step, input);
      input.pitLimiter = false;
      session.tick(input, 'keyboard');
      for (const e of session.raceEvents.splice(0))
        if (e.type === 'pit' && e.car === 0 && e.stage === 'speeding') speeding = true;
      if (session.world.time > through + 1 && !session.race.carFacts(0).inPitLane) break;
    }
    expect(speeding).toBe(true);
    expect(session.race.control.cars[0]!.pitStops).toBe(1);
    expect(session.race.control.pitRequested(0)).toBe(false);
  }, 120_000);
}

/**
 * Time from 700 m before the pit entry to 600 m after the exit, the scripted racing driver
 * at the wheel, with a stop (called before the run) and without. The field is retired at the
 * green, so neither run meets traffic.
 */
function stintTime(
  setup: typeof MONZA,
  stop: boolean,
  cuts: readonly number[] = [],
): {
  time: number;
  stops: number;
  marks: Record<string, number>;
  distances: Record<string, number>;
  crossings: number[];
} {
  const track = setup.track();
  const session = new DriveSession({
    track,
    seed: 3141,
    quickRace: { laps: 5, gridPosition: 1 },
    raceArtefacts: { line: loadLine(setup), envelope: loadEnvelope(setup) },
  });
  session.start();
  while (session.race.control.phase !== 'green') session.tick({ ...NEUTRAL_INPUT }, 'keyboard');
  for (let i = 1; i < session.race.cars.length; i++) session.race.control.retire(i, 'test');
  session.scriptedRaceDriver = true;
  const L = track.length;
  const start = track.wrap(track.pit.entryS - 700);
  session.teleport(start, 0, 60);
  if (stop) expect(session.boxThisLap()).toBe(true);
  const distance = ((track.pit.exitS - start + L) % L) + 600;
  const car = session.race.control.cars[0]!;
  const from = car.dist;
  const begin = session.world.time;
  const marks: Record<string, number> = {};
  const distances: Record<string, number> = {};
  const crossings: number[] = [];
  while (car.dist - from < distance && session.world.time - begin < 200) {
    session.tick({ ...NEUTRAL_INPUT }, 'keyboard');
    for (const e of session.raceEvents.splice(0)) {
      if (e.type !== 'pit' || e.car !== 0 || marks[e.stage] !== undefined) continue;
      marks[e.stage] = session.world.time - begin;
      distances[e.stage] = car.dist - from;
    }
    while (crossings.length < cuts.length && car.dist - from >= cuts[crossings.length]!)
      crossings.push(session.world.time - begin);
  }
  expect(car.dist - from).toBeGreaterThanOrEqual(distance);
  return { time: session.world.time - begin, stops: car.pitStops, marks, distances, crossings };
}

// Time lost to a stop (with a 3.07 s service), s. The ceiling is the measured loss with 1 s of
// headroom (Monza 31.6, Spa-Francorchamps 23.2, Singapore 29.1, with the limit lines at the cited
// timing loops: docs/race-rules.md, pit time loss). The floor is the limited zone at the limit
// plus the service, less the same stretch at 90 m/s.
const PIT_LOSS_MAX: Record<string, number> = { monza: 32.6, spa: 24.2, singapore: 30.1 };
const SERVICE = 3.07;
function pitLossFloor(setup: typeof MONZA): number {
  const pit = setup.track().pit;
  const zone = pit.limitEnd - pit.limitStart;
  return zone / pit.speedLimit + SERVICE - zone / 90;
}
for (const setup of [MONZA, SPA, SINGAPORE]) {
  it(`${setup.id}: a stop costs the time the pit lane's geometry sets, against a lap without one`, () => {
    const withStop = stintTime(setup, true);
    const without = stintTime(setup, false, [withStop.distances.entry!, withStop.distances.exit!]);
    const lost = withStop.time - without.time;
    const m = withStop.marks;
    const baselineLane = without.crossings[1]! - without.crossings[0]!;
    const approachLoss = m.entry! - without.crossings[0]!;
    const laneLoss = m.exit! - m.entry! - baselineLane;
    const rejoinLoss = withStop.time - m.exit! - (without.time - without.crossings[1]!);
    expect(Math.abs(approachLoss + laneLoss + rejoinLoss - lost)).toBeLessThan(1e-9);
    console.warn(setup.id, {
      lost,
      withStop: withStop.time,
      without: without.time,
      approachLoss,
      laneToBox: m.stop! - m.entry!,
      service: m.release! - m.stop!,
      releaseToExit: m.exit! - m.release!,
      baselineLane,
      laneLoss,
      rejoinLoss,
    });
    expect(withStop.stops).toBe(1);
    expect(without.stops).toBe(0);
    expect(lost).toBeGreaterThan(pitLossFloor(setup));
    expect(lost).toBeLessThan(PIT_LOSS_MAX[setup.id]!);
  }, 120_000);
}
