import type { Envelope } from '../src/envelope/envelope';

/**
 * A simple synthetic envelope for unit tests: lateral and braking grow with v² (downforce) and
 * with the load factor, drive falls with speed (power) and drag grows with v². Not the car's
 * numbers; the real envelope is measured from the sim (see the validation suite).
 */
export function syntheticEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  const speeds = Array.from({ length: 41 }, (_, k) => 5 + 2.5 * k); // 5–105 m/s
  const loads = [0.8, 1, 1.2];
  const lat = (v: number, l: number): number => 14 * l + 0.0025 * v * v;
  const brk = (v: number, l: number): number => 13 * l + 0.0025 * v * v;
  const trc = (v: number, l: number): number => 10 * l + 0.0015 * v * v;
  const drag = (v: number): number => 0.00065 * v * v;
  const drive = (v: number, ers: boolean, open: boolean): number =>
    Math.min(10, (ers ? 640e3 : 520e3) / 810 / v - drag(v) * (open ? 0.88 : 1));
  return {
    format: 'undercut-envelope',
    version: 1,
    conditions: { trim: 'test', airDensity: 1.17, fuel: 10, mass: 810, brakeBias: 0.57 },
    speeds,
    loads,
    lateral: loads.map((l) => speeds.map((v) => lat(v, l))),
    brake: loads.map((l) => speeds.map((v) => brk(v, l))),
    traction: loads.map((l) => speeds.map((v) => trc(v, l))),
    drive: {
      closedErs: speeds.map((v) => drive(v, true, false)),
      closedNoErs: speeds.map((v) => drive(v, false, false)),
      openErs: speeds.map((v) => drive(v, true, true)),
      openNoErs: speeds.map((v) => drive(v, false, true)),
    },
    drag: { closed: speeds.map(drag), open: speeds.map((v) => drag(v) * 0.88) },
    combinedExponent: 2,
    mguh: speeds.map(() => 60e3),
    harvest: speeds.map(() => 100e3),
    ers: { mgukPower: 120e3, deployPerLap: 4e6, harvestPerLap: 2e6, storeWindow: 4e6 },
    shiftRpm: [12400, 12170, 12040, 11940, 11910, 11950, 11980, 12400],
    topSpeed: { closed: 95, open: 98 },
    ...overrides,
  };
}
