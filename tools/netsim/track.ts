/**
 * A synthetic circuit for headless races: a circle with a known length, and cars that
 * each run at their own constant speed from lights out. Positions are a pure function
 * of server time, so any client can compute the truth for any car at any time.
 */
import type { CarSnapshot, CircuitInfo } from '@undercut/protocol';

export interface LoopTrack {
  circuit: CircuitInfo;
  /** Speed of the car in `seat`, m/s. */
  speed(seat: number): number;
  /** Lap time of the car in `seat`, whole ms. */
  lapMs(seat: number): number;
}

export function loopTrack(lengthM: number, baseSpeed = 75, perSeat = 0.5): LoopTrack {
  const speed = (seat: number) => baseSpeed + perSeat * seat;
  return {
    circuit: {
      id: 'test-loop',
      lengthM,
      minLapMs: Math.floor((lengthM / 95) * 1000),
      minSectorMs: [0, 1, 2].map(() => Math.floor((lengthM / 3 / 95) * 1000)),
      maxLapMs: Math.ceil((lengthM / 20) * 1000),
    },
    speed,
    lapMs: (seat) => Math.round((lengthM / speed(seat)) * 1000),
  };
}

/** Distance covered by `seat` at race time `raceMs` (0 before lights out), metres. */
export function distance(track: LoopTrack, seat: number, raceMs: number): number {
  return (Math.max(0, raceMs) / track.lapMs(seat)) * track.circuit.lengthM;
}

/** The car's true state at server time `t`, given lights out at `lightsOutAt`. */
export function carAt(
  track: LoopTrack,
  seat: number,
  t: number,
  lightsOutAt: number,
  tick: number,
): CarSnapshot {
  const L = track.circuit.lengthM;
  const r = L / (2 * Math.PI);
  const moving = t >= lightsOutAt;
  const d = distance(track, seat, t - lightsOutAt);
  const a = d / r;
  const v = moving ? (L / track.lapMs(seat)) * 1000 : 0;
  // Each grid slot sits a little back from the line, on its own lateral offset.
  const lane = 2 + (seat % 2) * 4;
  const R = r + lane;
  return {
    seat,
    flags: 0,
    resets: 0,
    tick,
    t,
    x: R * Math.cos(a),
    y: 0,
    z: R * Math.sin(a),
    yaw: a + Math.PI / 2,
    pitch: 0,
    roll: 0,
    vx: (-v * Math.sin(a) * R) / r,
    vy: 0,
    vz: (v * Math.cos(a) * R) / r,
    yawRate: moving ? v / r : 0,
    steer: 0.1,
    throttle: moving ? 1 : 0,
    brake: 0,
    gear: moving ? 7 : 1,
    rpm: moving ? 11_000 : 4000,
    wheelSpin: [v / 0.33, v / 0.33, v / 0.33, v / 0.33],
    lap: Math.floor(d / L),
    s: d % L,
  };
}
