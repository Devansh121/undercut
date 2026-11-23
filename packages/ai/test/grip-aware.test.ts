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
import { MONZA, loadEnvelope, loadLine } from '../validation/lib/index';

// A driver drives to the grip its tyres have: worn, cold or overheated tyres (telemetry's
// `tyreGrip` under 1) take the speed profile down as a re-planned one would, speeds by √grip
// and accelerations by grip. With the reference tyre (grip 1) nothing changes.

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

function target(s: number, grip: number): number {
  const dr = createReferenceDriver({
    track,
    line: loadLine(MONZA),
    envelope: loadEnvelope(MONZA),
    params,
  });
  const out: ControlInput = { ...NEUTRAL_INPUT };
  dr.drive(at(s, 40, grip), 1 / 240, out);
  return dr.last.targetSpeed;
}

it('asks for √grip of the profile speed on tyres with less grip', () => {
  // In the first chicane (s about 650), where the profile is slow and grip-limited.
  const full = target(650, 1);
  expect(target(650, 0.9)).toBeCloseTo(full * Math.sqrt(0.9), 9);
});
