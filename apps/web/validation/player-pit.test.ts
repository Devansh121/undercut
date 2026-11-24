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
    const travel = (session.s - start + track.length) % track.length;
    const lost = session.world.time - begin - travel / 50;
    expect(lost).toBeGreaterThan(5);
    expect(lost).toBeLessThan(70);
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
