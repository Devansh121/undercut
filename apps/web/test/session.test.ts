import { NEUTRAL_INPUT, SurfaceKind, type ControlInput } from '@undercut/sim';
import { createGround, createVec3 } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { assistsFor } from '../src/game/assists';
import { GameLoop, type ControlSource, type DriverFrame } from '../src/game/loop';
import { DriveSession, type SessionEvent } from '../src/game/session';
import { loadMonza } from './fixtures';

const track = loadMonza();
const STEP = 1 / 240;

/** A driver that holds one ControlInput and can raise one-shot actions. */
class Scripted implements ControlSource {
  control: ControlInput = { ...NEUTRAL_INPUT };
  pending: string[] = [];
  samples = 0;
  private readonly frame: DriverFrame = {
    control: { ...NEUTRAL_INPUT },
    device: 'keyboard',
    lookBack: false,
    events: [],
  };
  sample(): DriverFrame {
    this.samples++;
    Object.assign(this.frame.control, this.control);
    this.control.gearShift = 0;
    this.frame.events = this.pending.map((action) => ({ type: 'action' as const, action }));
    this.pending = [];
    return this.frame;
  }
}

function setup() {
  const session = new DriveSession({ track, seed: 7 });
  const driver = new Scripted();
  const loop = new GameLoop(session, driver);
  loop.start();
  return { session, driver, loop };
}

/** Run the loop for `seconds` of sim time in 60 Hz frames; returns every session event. */
function run(loop: GameLoop, seconds: number): SessionEvent[] {
  const events: SessionEvent[] = [];
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++) events.push(...loop.frame(1 / 60).events);
  return events;
}

/** A patch of gravel at least 3 m across near the first chicane. */
function findGravel(): { s: number; d: number } {
  const g = createGround();
  const gravel = (s: number, d: number): boolean =>
    track.ground(s, d, g).kind === SurfaceKind.Gravel;
  for (let s = 560; s < 1200; s += 4) {
    for (const side of [1, -1]) {
      for (let k = 2; k < 60; k += 0.5) {
        const d = side * (track.halfWidthAt(s, side > 0 ? 0 : 1) + k);
        if (
          [-3, 0, 3].every(
            (ds) => gravel(s + ds, d) && gravel(s + ds, d - 1.5) && gravel(s + ds, d + 1.5),
          )
        )
          return { s, d };
      }
    }
  }
  throw new Error('no gravel near the first chicane');
}

describe('GameLoop and DriveSession', () => {
  it('starts rolling on the grid behind the line, before the first timed lap', () => {
    const { session } = setup();
    expect(session.phase).toBe('running');
    expect(session.timer.running).toBe(false);
    const t = session.readTelemetry();
    expect(t.speed).toBeGreaterThan(30);
    expect(track.lapDelta(session.s, 0)).toBeGreaterThan(100);
    expect(track.lapDelta(session.s, 0)).toBeLessThan(200);
  });

  it('samples input exactly once per sim tick', () => {
    const { loop, driver, session } = setup();
    run(loop, 0.5);
    expect(driver.samples).toBe(session.world.tick);
    expect(session.world.tick).toBe(120);
  });

  it('accelerates under throttle, then brakes', () => {
    const { loop, driver, session } = setup();
    const v0 = session.readTelemetry().speed;
    driver.control.throttle = 1;
    run(loop, 2);
    const v1 = session.readTelemetry().speed;
    expect(v1).toBeGreaterThan(v0 + 15);
    driver.control.throttle = 0;
    driver.control.brake = 1;
    run(loop, 1);
    // About 2.4 g from 225 km/h with the low-drag trim and tyre-limited brakes.
    expect(session.readTelemetry().speed).toBeLessThan(v1 - 18);
  });

  it('pause truly freezes the sim, the clock and the interpolation factor', () => {
    const { loop, driver, session } = setup();
    driver.control.throttle = 1;
    loop.frame(0.0123);
    const tick = session.world.tick;
    const alpha = loop.alpha;
    const x = session.car.state.x;
    expect(loop.pause()).toBe(true);
    expect(session.phase).toBe('paused');
    for (let i = 0; i < 100; i++) loop.frame(1 / 60);
    expect(session.world.tick).toBe(tick);
    expect(loop.alpha).toBe(alpha);
    expect(session.car.state.x).toBe(x);
    expect(loop.resume()).toBe(true);
    loop.frame(1 / 60);
    expect(session.world.tick).toBeGreaterThan(tick);
  });

  it('clamps a stall instead of catching up on it', () => {
    const { loop, session } = setup();
    loop.frame(30);
    expect(session.world.tick).toBe(Math.floor(0.25 / STEP + 1e-9));
  });

  it('scales time for tests and tools', () => {
    const { loop, session } = setup();
    loop.timeScale = 4;
    loop.frame(0.1);
    expect(session.world.tick).toBe(96);
  });

  it('pauses on the pause action and resets on the reset action', () => {
    const { loop, driver, session } = setup();
    driver.pending.push('pause');
    loop.frame(1 / 60);
    expect(session.phase).toBe('paused');
    loop.resume();
    driver.pending.push('nextCamera');
    const out = loop.frame(1 / 60);
    expect(out.actions).toContain('nextCamera');
  });

  it('ignores transitions that do not apply', () => {
    const session = new DriveSession({ track, seed: 1 });
    const loop = new GameLoop(session, new Scripted());
    expect(session.phase).toBe('ready');
    expect(loop.pause()).toBe(false);
    expect(loop.resume()).toBe(false);
    expect(loop.frame(1).steps).toBe(0);
    loop.start();
    expect(loop.resume()).toBe(false);
    expect(loop.start()).toBe(false);
    loop.quit();
    expect(session.phase).toBe('ended');
    expect(loop.pause()).toBe(false);
    expect(loop.frame(1).steps).toBe(0);
  });

  it('times a lap start from the rolling start and records sector crossings', () => {
    const { loop, driver, session } = setup();
    driver.control.throttle = 1;
    const events = run(loop, 4);
    const start = events.find((e) => e.type === 'lapStart');
    expect(start).toBeDefined();
    expect(session.timer.running).toBe(true);
    expect(session.timer.lap).toBe(1);
  });

  it('resets to the centreline from the gravel, stopped and facing along the lap', () => {
    const { loop, session } = setup();
    const { s, d } = findGravel();
    session.teleport(s, d, 0);
    run(loop, 0.5);
    expect(session.surfaceUnderCar()).toBe(SurfaceKind.Gravel);
    loop.resetToTrack();
    const t = session.readTelemetry();
    expect(Math.abs(t.speed)).toBeLessThan(0.05);
    expect(Math.abs(session.d)).toBeLessThan(0.05);
    expect(track.lapDelta(session.s, s)).toBeLessThan(5);
    const tangent = track.tangentAt(session.s, createVec3());
    const yaw = Math.atan2(-tangent.z, tangent.x);
    expect(Math.abs(Math.atan2(Math.sin(t.yaw - yaw), Math.cos(t.yaw - yaw)))).toBeLessThan(0.01);
    run(loop, 1);
    expect(Math.abs(session.readTelemetry().speed)).toBeLessThan(0.5);
  });

  it('invalidates the running lap on a reset and on four wheels off', () => {
    const { loop, driver, session } = setup();
    driver.control.throttle = 1;
    run(loop, 4);
    expect(session.timer.running).toBe(true);
    expect(session.timer.valid).toBe(true);
    const events = loop.resetToTrack();
    expect(session.timer.valid).toBe(false);
    expect(events.some((e) => e.type === 'invalidated')).toBe(true);
  });

  it('restart lap returns to the rolling start with timing cleared', () => {
    const { loop, driver, session } = setup();
    driver.control.throttle = 1;
    run(loop, 4);
    expect(session.timer.running).toBe(true);
    loop.pause();
    loop.restartLap();
    expect(session.phase).toBe('running');
    expect(session.timer.running).toBe(false);
    expect(track.lapDelta(session.s, 0)).toBeGreaterThan(100);
  });

  it('opens DRS only inside a DRS zone', () => {
    const { loop, driver, session } = setup();
    driver.control.drs = true;
    driver.control.throttle = 1;
    // Curva Biassono is outside both DRS zones at Monza. (The main-straight zone opens 12 m
    // after the timing line, 320.5 m before the start line, so the rolling start is inside it.)
    session.teleport(1108, 0, 80);
    run(loop, 0.5);
    expect(session.drsAvailable).toBe(false);
    expect(session.car.input.drs).toBe(false);
    // Middle of the zone after the line.
    session.teleport(300, 0, 80);
    run(loop, 0.6);
    expect(session.drsAvailable).toBe(true);
    expect(session.car.input.drs).toBe(true);
    expect(session.readTelemetry().drs).toBeGreaterThan(0.9);
  });

  it('resets the ERS lap counters at the line', () => {
    const { loop, driver, session } = setup();
    driver.control.throttle = 1;
    run(loop, 1);
    expect(session.car.state.ersDeployLap + session.car.state.ersHarvestLap).toBeGreaterThan(0);
    const events = run(loop, 3);
    const start = events.find((e) => e.type === 'lapStart');
    expect(start).toBeDefined();
    // Deployment since the line only: at most about 3 s of 120 kW.
    expect(session.car.state.ersDeployLap).toBeLessThan(3 * 120e3 + 1);
  });

  it('maps device presets to the sim assists, with the player overrides on top', () => {
    expect(assistsFor('keyboard', {})).toMatchObject({
      tractionControl: 2,
      abs: 2,
      autoGears: true,
    });
    expect(assistsFor('gamepad', {})).toMatchObject({
      tractionControl: 1,
      abs: 2,
      autoGears: true,
    });
    expect(assistsFor('touch', {})).toMatchObject({ tractionControl: 3, abs: 2, autoGears: true });
    expect(assistsFor('keyboard', { tractionControl: 0, autoGears: false })).toMatchObject({
      tractionControl: 0,
      autoGears: false,
    });
  });
});
