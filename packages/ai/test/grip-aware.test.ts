import { beforeAll, expect, it } from 'vitest';
import {
  NEUTRAL_INPUT,
  createCarParams,
  createCarTelemetry,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import { createVec3, type Track } from '@undercut/track';
import { createReferenceDriver } from '../src/index';
import { Phase, SpeedProfiler } from '../src/profile/speed-profile';
import { MONZA, loadEnvelope, loadLine } from '../validation/lib/index';

// A driver drives to the grip its tyres have: on tyres with less grip than the reference tyre
// (worn, cold or overheated: telemetry's `tyreGrip` under 1) it drives the speed profile planned
// on the envelope scaled by that grip, which is slower where the plan is grip-limited (corners,
// braking) and the same where it is not (the engine's top speed). With the reference tyre, the
// plan itself.

let track: Track;
const params = createCarParams(MONZA.trim);

beforeAll(() => {
  track = MONZA.track();
});

function at(s: number, v: number, grip: number): CarTelemetry {
  const t = createCarTelemetry();
  const p = track.pointAt(s, 0, createVec3());
  const tan = track.tangentAt(s, createVec3());
  t.x = p.x;
  t.z = p.z;
  t.yaw = Math.atan2(-tan.z, tan.x);
  t.speed = v;
  t.gear = 5;
  t.engineRpm = 10000;
  t.tyreGrip = grip;
  for (let i = 0; i < 4; i++) t.wheelLoad[i] = 4000;
  return t;
}

function driver() {
  return createReferenceDriver({
    track,
    line: loadLine(MONZA),
    envelope: loadEnvelope(MONZA),
    params,
  });
}

function target(s: number, v: number, grip: number): number {
  const dr = driver();
  const out: ControlInput = { ...NEUTRAL_INPUT };
  dr.drive(at(s, v, grip), 1 / 240, out);
  return dr.last.targetSpeed;
}

it('drives the plan itself on the reference tyre', () => {
  const dr = driver();
  const out: ControlInput = { ...NEUTRAL_INPUT };
  dr.drive(at(650, 40, 1), 1 / 240, out);
  const prof = dr.plan.profile;
  const k = Math.round(dr.plan.track.wrap(650) / dr.plan.track.lap.step);
  expect(Math.abs(dr.last.targetSpeed - prof.v[k]!)).toBeLessThan(1);
});

it('on less grip, slows where the plan is grip-limited and keeps the top speed', () => {
  const dr = driver();
  const plan = dr.plan;
  // The profile planned on the envelope at 0.9 of the plan's shares.
  const scale = {
    lateral: plan.scale.lateral * 0.9,
    brake: plan.scale.brake * 0.9,
    traction: plan.scale.traction * 0.9,
  };
  const worn = new SpeedProfiler(plan.line, plan.model).compute({
    scale,
    drs: plan.drsZone,
    ers: plan.deployMask,
  });
  // In the first chicane (s about 650): the re-planned speed, under the plan's.
  const k = Math.round(track.wrap(650) / track.lap.step);
  expect(Math.abs(target(650, 30, 0.9) - worn.v[k]!)).toBeLessThan(0.5);
  expect(target(650, 30, 0.9)).toBeLessThan(target(650, 30, 1) - 1);
  // Flat out on a straight, 300 m and more before the next braking: power-limited, the same.
  const prof = plan.profile;
  const n = prof.v.length;
  const step = track.lap.step;
  let flat = -1;
  for (let i = 0; i < n && flat < 0; i++) {
    if (prof.phase[i] !== Phase.Throttle || prof.v[i]! < 70) continue;
    let clear = true;
    for (let d = 0; d * step < 300; d++) if (prof.phase[(i + d) % n] === Phase.Brake) clear = false;
    if (clear) flat = i;
  }
  expect(flat).toBeGreaterThanOrEqual(0);
  const sFlat = flat * step;
  const full = target(sFlat, 75, 1);
  expect(Math.abs(target(sFlat, 75, 0.9) - full)).toBeLessThan(0.01 * full);
});
