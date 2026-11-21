import {
  addCar,
  beginErsLap,
  computeMass,
  createCarParams,
  createCarTelemetry,
  createWorld,
  readCarTelemetry,
  setErsMode,
  stepWorld,
  type AeroTrim,
  type CarParams,
  type CarTelemetry,
  type MassState,
  type WorldCar,
} from '@undercut/sim';
import { LEFT, RIGHT, TrackSurface, createPathPoint, type Track } from '@undercut/track';
import type { Driver } from '../../src/driver/driver';
import type { DrivingPlan } from '../../src/profile/plan';

/** The game's sim step (ADR 0007). */
export const STEP = 1 / 240;

/** Columns of the lap trace, in order. */
export const LAP_TRACE_COLUMNS = [
  't',
  'lap',
  's',
  'd',
  'line_d',
  'lateral_error',
  'speed_kmh',
  'target_kmh',
  'throttle',
  'brake',
  'steer',
  'gear',
  'rpm',
  'long_g',
  'lat_g',
  'drs',
  'ers_mj',
  'deploy_lap_mj',
  'harvest_lap_mj',
  'mguk_kw',
  'wheels_off',
  'sideslip_deg',
  'course_error_deg',
  'curvature_cmd',
  'line_curvature',
  'yaw_rate',
  'slip_fl',
  'slip_fr',
  'slip_rl',
  'slip_rr',
  'load_fl',
  'load_fr',
  'load_rl',
  'load_rr',
  'brake_cap',
  'throttle_cap',
  'lock_excess',
] as const;

export interface LapRunOptions {
  track: Track;
  plan: DrivingPlan;
  /** Builds the driver for the car the runner creates. */
  driver: (params: CarParams) => Driver;
  trim: AeroTrim;
  airDensity: number;
  /** Fuel at the start, kg. Doc 2.1: qualifying fuel, about 10 kg. */
  fuel: number;
  /** Number of timed laps after the lead-in. */
  laps: number;
  /** Lead-in before the timing line, m of centreline (flying start, on the main straight). Default 400. */
  leadIn?: number;
  /** Record a trace row every `recordEvery` ticks (0 = none). */
  recordEvery?: number;
  /** Give up after this many sim seconds. */
  maxTime?: number;
  /** A wall clock (ms) to time the driver's ticks with; the runner itself never reads one. */
  clock?: () => number;
  /** Published stops to measure the same way, by corner number: [from, to] km/h. */
  stops?: Readonly<Record<number, readonly [number, number]>>;
}

export interface CornerRecord {
  number: number;
  name: string;
  /** Minimum speed between the corner's start and end, km/h. */
  minSpeed: number;
  /**
   * The braking that leads into it: speed where the brakes went on (km/h, 0 if the corner is
   * taken without braking) and the distance and time from there to the minimum.
   */
  entrySpeed: number;
  brakeDistance: number;
  brakeTime: number;
  /** For a published stop (`LapRunOptions.stops`): distance and time between its two speeds. */
  stop?: { from: number; to: number; distance: number; time: number };
}

export interface LapRecord {
  time: number;
  sectors: number[];
  /** Speed at the speed trap and at the timing line, km/h. */
  trap: number;
  finish: number;
  maxSpeed: number;
  corners: CornerRecord[];
  /** Most wheels beyond the track edge at once (centre of the wheel past the white line). */
  maxWheelsOff: number;
  /** Ticks with all four wheels off. */
  allOffTicks: number;
  maxLateralError: number;
  rmsLateralError: number;
  maxSideslipDeg: number;
  deployMJ: number;
  harvestMJ: number;
  fuelUsed: number;
}

export interface LapRunResult {
  laps: LapRecord[];
  /** True if the car spun (sideslip past 20°) or went backwards at any point. */
  spun: boolean;
  /** Time the run took, s of sim time, and ticks. */
  simTime: number;
  ticks: number;
  trace?: { columns: readonly string[]; rows: number[][] };
  params: CarParams;
  /** Mean wall time of one driver tick, µs, when a clock was given. */
  driverTickUs?: number;
}

/** Positions of the four wheel centres projected to the track: how many are past the edge. */
class WheelLimits {
  private readonly hints = [{ index: -1 }, { index: -1 }, { index: -1 }, { index: -1 }];
  private readonly q = createPathPoint();
  private readonly mass: MassState = {
    total: 0,
    sprung: 0,
    a: 0,
    b: 0,
    sprungA: 0,
    sprungB: 0,
    yawInertia: 0,
  };
  constructor(private readonly track: Track) {}
  wheelsOff(car: WorldCar): number {
    const st = car.state;
    const m = computeMass(st.model, st.fuelMass, this.mass);
    const c = Math.cos(st.yaw);
    const sn = Math.sin(st.yaw);
    let off = 0;
    for (let i = 0; i < 4; i++) {
      const bx = i < 2 ? m.a : -m.b;
      const by = st.model.wheelLeft[i]!;
      const x = st.x + bx * c - by * sn;
      const z = st.z - bx * sn - by * c;
      const q = this.track.project(x, z, this.hints[i]!, this.q);
      const side = q.d >= 0 ? LEFT : RIGHT;
      if (Math.abs(q.d) > this.track.halfWidthAt(q.s, side)) off++;
    }
    return off;
  }
}

/**
 * A flying lap (or several): the car is built exactly as the game builds it (`createWorld`
 * with the track's surface, `addCar` with the trim's parameters) and placed on the racing line
 * `leadIn` metres before the timing line at the plan's speed. The driver's input is the only
 * thing that reaches the car. Timing crossings are interpolated between ticks.
 */
export function runLaps(o: LapRunOptions): LapRunResult {
  const track = o.track;
  const plan = o.plan;
  const params = createCarParams(o.trim);
  const surface = new TrackSurface(track);
  const world = createWorld({
    step: STEP,
    seed: 1,
    surface,
    environment: { airDensity: o.airDensity },
  });
  const leadIn = o.leadIn ?? 400;
  const s0 = track.wrap(-leadIn);
  const n = plan.line.count;
  const i0 = Math.round(s0 / track.lap.step) % n;
  const car = addCar(world, params, {
    x: plan.line.x[i0]!,
    z: plan.line.z[i0]!,
    yaw: plan.line.heading[i0]!,
    speed: plan.profile.v[i0]!,
    fuel: o.fuel,
    airDensity: o.airDensity,
  });
  const driver = o.driver(params);
  setErsMode(car.state, driver.ersMode);
  const tel: CarTelemetry = createCarTelemetry();
  const limits = new WheelLimits(track);
  const q = createPathPoint();
  const hint = { index: -1 };
  const recordEvery = o.recordEvery ?? 0;
  const trace =
    recordEvery > 0 ? { columns: LAP_TRACE_COLUMNS, rows: [] as number[][] } : undefined;
  const maxTime = o.maxTime ?? (o.laps + 1) * 200;
  const diag = (driver as unknown as { last?: Record<string, number> }).last;
  const clock = o.clock;
  let driverMs = 0;
  let driverTicks = 0;

  const laps: LapRecord[] = [];
  let lapIndex = -1; // -1 = lead-in
  let lapStart = 0;
  let sectorStart = 0;
  let sectors: number[] = [];
  let prevS = track.project(car.state.x, car.state.z, hint, q).s;
  let prevT = 0;
  let prevV = car.state.vx;
  let spun = false;
  let cur = newLap();
  let lastWheelsOff = 0;
  let deploy0 = 0;
  let harvest0 = 0;
  let fuel0 = car.state.fuelMass;
  let errSq = 0;
  let errN = 0;
  // Per-corner tracking.
  const rs: number[] = [];
  const rv: number[] = [];
  const rt: number[] = [];
  const rb: number[] = [];

  function newLap(): LapRecord {
    return {
      time: 0,
      sectors: [],
      trap: 0,
      finish: 0,
      maxSpeed: 0,
      corners: [],
      maxWheelsOff: 0,
      allOffTicks: 0,
      maxLateralError: 0,
      rmsLateralError: 0,
      maxSideslipDeg: 0,
      deployMJ: 0,
      harvestMJ: 0,
      fuelUsed: 0,
    };
  }

  while (world.time < maxTime && lapIndex < o.laps) {
    readCarTelemetry(car.state, tel, world.environment.gravity);
    if (clock) {
      const c0 = clock();
      driver.drive(tel, STEP, car.input);
      driverMs += clock() - c0;
      driverTicks++;
    } else driver.drive(tel, STEP, car.input);
    stepWorld(world);
    car.input.gearShift = 0;
    const st = car.state;
    const t = world.time;
    const s = track.project(st.x, st.z, hint, q).s;
    const v = st.vx;
    const beta = (Math.atan2(st.vy, Math.max(Math.abs(st.vx), 1)) * 180) / Math.PI;
    if (Math.abs(beta) > 20 || st.vx < 1) spun = true;
    const interp = (line: number): number => {
      const ds = track.forwardDistance(prevS, s);
      const frac = ds > 0 ? track.forwardDistance(prevS, line) / ds : 1;
      return prevT + (t - prevT) * frac;
    };
    const interpV = (line: number): number => {
      const ds = track.forwardDistance(prevS, s);
      const frac = ds > 0 ? track.forwardDistance(prevS, line) / ds : 1;
      return (prevV + (v - prevV) * frac) * 3.6;
    };

    // Timing line.
    if (track.crossed(prevS, s, 0)) {
      const tc = interp(0);
      if (lapIndex >= 0) {
        sectors.push(tc - sectorStart);
        cur.time = tc - lapStart;
        cur.sectors = sectors;
        cur.deployMJ = (st.ersDeployLap - deploy0) / 1e6;
        cur.harvestMJ = (st.ersHarvestLap - harvest0) / 1e6;
        cur.fuelUsed = fuel0 - st.fuelMass;
        cur.rmsLateralError = Math.sqrt(errSq / Math.max(errN, 1));
        cur.corners = cornerRecords(track, rs, rv, rt, rb, o.stops ?? {});
        laps.push(cur);
      }
      lapIndex++;
      cur = newLap();
      cur.finish = interpV(0);
      lapStart = tc;
      sectorStart = tc;
      sectors = [];
      beginErsLap(st);
      deploy0 = 0;
      harvest0 = 0;
      fuel0 = st.fuelMass;
      errSq = 0;
      errN = 0;
      rs.length = 0;
      rv.length = 0;
      rt.length = 0;
      rb.length = 0;
    }
    if (lapIndex >= 0 && lapIndex < o.laps) {
      for (let k = 1; k < track.sectors.length; k++) {
        if (track.crossed(prevS, s, track.sectors[k]!)) {
          const tc = interp(track.sectors[k]!);
          sectors.push(tc - sectorStart);
          sectorStart = tc;
        }
      }
      if (track.crossed(prevS, s, track.speedTrap)) cur.trap = interpV(track.speedTrap);
      cur.maxSpeed = Math.max(cur.maxSpeed, v * 3.6);
      const off = limits.wheelsOff(car);
      lastWheelsOff = off;
      cur.maxWheelsOff = Math.max(cur.maxWheelsOff, off);
      if (off === 4) cur.allOffTicks++;
      cur.maxSideslipDeg = Math.max(cur.maxSideslipDeg, Math.abs(beta));
      if (diag) {
        const e = Math.abs(diag.lateralError ?? 0);
        cur.maxLateralError = Math.max(cur.maxLateralError, e);
        errSq += e * e;
        errN++;
      }
      rs.push(s);
      rv.push(v * 3.6);
      rt.push(t);
      rb.push(st.brakeApplied);
    }
    if (trace && world.tick % recordEvery === 0) {
      readCarTelemetry(st, tel, world.environment.gravity);
      trace.rows.push([
        t,
        lapIndex,
        s,
        diag?.d ?? 0,
        diag?.lineD ?? 0,
        diag?.lateralError ?? 0,
        v * 3.6,
        (diag?.targetSpeed ?? 0) * 3.6,
        tel.throttle,
        tel.brake,
        car.input.steer,
        tel.gear,
        tel.engineRpm,
        tel.longG,
        tel.latG,
        tel.drs,
        tel.ersStore / 1e6,
        tel.ersDeployLap / 1e6,
        tel.ersHarvestLap / 1e6,
        tel.mgukPower / 1e3,
        lastWheelsOff,
        beta,
        ((diag?.courseError ?? 0) * 180) / Math.PI,
        diag?.curvature ?? 0,
        diag?.lineCurvature ?? 0,
        diag?.yawRate ?? 0,
        tel.slipRatio[0]!,
        tel.slipRatio[1]!,
        tel.slipRatio[2]!,
        tel.slipRatio[3]!,
        tel.wheelLoad[0]!,
        tel.wheelLoad[1]!,
        tel.wheelLoad[2]!,
        tel.wheelLoad[3]!,
        diag?.brakeCap ?? 1,
        diag?.throttleCap ?? 1,
        diag?.lockExcess ?? 0,
      ]);
    }
    prevS = s;
    prevT = t;
    prevV = v;
    if (spun) break;
  }
  const result: LapRunResult = { laps, spun, simTime: world.time, ticks: world.tick, params };
  if (trace) result.trace = trace;
  if (clock && driverTicks > 0) result.driverTickUs = (driverMs / driverTicks) * 1000;
  return result;
}

/**
 * Per-corner minimum speed and the braking into it, from one lap's record of s, speed (km/h),
 * time and brake pedal. The braking event is found by walking back from the minimum while the
 * brake was on (gaps under 120 m count as the same stop, as a driver modulating the pedal),
 * never past the previous corner.
 */
function cornerRecords(
  track: Track,
  rs: readonly number[],
  rv: readonly number[],
  rt: readonly number[],
  rb: readonly number[],
  stops: Readonly<Record<number, readonly [number, number]>>,
): CornerRecord[] {
  return track.corners.map((c, ci) => {
    // Never walk back past the previous corner: its braking is its own.
    const floor = ci > 0 ? track.corners[ci - 1]!.end : -Infinity;
    let mi = -1;
    for (let k = 0; k < rs.length; k++) {
      if (rs[k]! >= c.start && rs[k]! <= c.end && (mi < 0 || rv[k]! < rv[mi]!)) mi = k;
    }
    const rec: CornerRecord = {
      number: c.number,
      name: c.name,
      minSpeed: mi >= 0 ? rv[mi]! : Number.NaN,
      entrySpeed: 0,
      brakeDistance: 0,
      brakeTime: 0,
    };
    if (mi < 0) return rec;
    let onset = -1;
    let lastBrake = mi;
    for (let k = mi; k >= 0; k--) {
      if (rs[mi]! - rs[k]! > 700 || rs[k]! < floor) break;
      if (rb[k]! > 0.05) {
        onset = k;
        lastBrake = k;
      } else if (rs[lastBrake]! - rs[k]! > 120) break;
    }
    if (onset >= 0) {
      rec.entrySpeed = rv[onset]!;
      rec.brakeDistance = rs[mi]! - rs[onset]!;
      rec.brakeTime = rt[mi]! - rt[onset]!;
      const stop = stops[c.number];
      if (stop) {
        const at = (target: number): { s: number; t: number } | null => {
          for (let k = onset; k < mi; k++) {
            if (rv[k]! >= target && rv[k + 1]! < target) {
              const f = (rv[k]! - target) / (rv[k]! - rv[k + 1]!);
              return {
                s: rs[k]! + (rs[k + 1]! - rs[k]!) * f,
                t: rt[k]! + (rt[k + 1]! - rt[k]!) * f,
              };
            }
          }
          return null;
        };
        const a = at(stop[0]);
        const b = at(stop[1]);
        if (a && b) {
          rec.stop = { from: stop[0], to: stop[1], distance: b.s - a.s, time: b.t - a.t };
        }
      }
    }
    return rec;
  });
}
