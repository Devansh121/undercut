/**
 * Scripted manoeuvres for offline audio checks. Each scenario is a stepper: called at the
 * update rate with the time step, it advances its own little state and returns the car
 * state the game would send to the audio engine at that moment.
 */
import {
  AudioCore,
  defaultCarState,
  rpmToRadPerSecond,
  type AudioCarState,
  type AudioView,
  LAYERS,
} from '@undercut/audio';
import { brakingDecel, CAR, coastDecel, fullThrottleAccel, rpmAt, speedAt } from './car-model';

export interface Scenario {
  name: string;
  title: string;
  /** What to listen for, for the listening queue. */
  listen: string;
  duration: number;
  /** Builds a fresh stepper. `step(dt)` returns the state at the end of the step. */
  create(): (dt: number) => AudioCarState;
}

const kmh = (v: number) => v / 3.6;

function base(): AudioCarState {
  const s = defaultCarState();
  s.engineOn = true;
  return s;
}

/** Boost demand the way exhaust energy builds: needs load and revs. */
function boostFor(rpm: number, load: number): number {
  return load * Math.min(1, Math.max(0, (rpm - 4000) / 6500));
}

function fill(s: AudioCarState, rpm: number, throttle: number, load: number): void {
  s.engineSpeed = rpmToRadPerSecond(rpm);
  s.throttle = throttle;
  s.load = load;
  s.boost = boostFor(rpm, load);
}

/** Gear-change bookkeeping shared by the scenarios: shifting flag for the shift time. */
class Gearbox {
  gear: number;
  private shiftLeft = 0;
  direction = 0;
  constructor(gear: number) {
    this.gear = gear;
  }
  get shifting(): boolean {
    return this.shiftLeft > 0;
  }
  shift(direction: 1 | -1): void {
    this.gear += direction;
    this.direction = direction;
    this.shiftLeft = direction > 0 ? CAR.upshiftTime : CAR.downshiftTime;
  }
  tick(dt: number): void {
    this.shiftLeft = Math.max(0, this.shiftLeft - dt);
    if (this.shiftLeft === 0) this.direction = 0;
  }
  apply(s: AudioCarState): void {
    s.gear = this.gear;
    s.shifting = this.shifting;
    s.shiftDirection = this.shifting ? this.direction : 0;
  }
}

/**
 * Engine rpm during a shift: it follows the road speed in the new gear, but the crank cannot
 * jump, so it slews there over the shift time.
 */
class RpmSlew {
  rpm: number;
  constructor(rpm: number) {
    this.rpm = rpm;
  }
  toward(target: number, dt: number, shifting: boolean): number {
    if (!shifting) {
      this.rpm = target;
    } else {
      const rate = 120_000; // rpm/s while the clutches change over
      this.rpm += Math.max(-rate * dt, Math.min(rate * dt, target - this.rpm));
    }
    return this.rpm;
  }
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'idle',
    title: 'Idle in neutral',
    listen: 'Steady idle near 4500 rpm with slight hunting; no clicks at the start.',
    duration: 4,
    create() {
      const s = base();
      let t = 0;
      return (dt) => {
        t += dt;
        const rpm = CAR.idleRpm + 40 * Math.sin(2 * Math.PI * 1.3 * t);
        fill(s, rpm, 0, 0.08);
        s.gear = 0;
        return s;
      };
    },
  },
  {
    name: 'full-throttle',
    title: 'Full throttle through all eight gears',
    listen:
      'Pitch climbs in each gear and drops on every upshift; cut on each shift, turbo and ERS whine rising.',
    duration: 13,
    create() {
      const s = base();
      const box = new Gearbox(1);
      let v = speedAt(6500, 1);
      const slew = new RpmSlew(6500);
      return (dt) => {
        box.tick(dt);
        const ersOn = v > kmh(100);
        v += fullThrottleAccel(v, ersOn) * (box.shifting && box.direction > 0 ? 0.3 : 1) * dt;
        let rpm = rpmAt(v, box.gear);
        if (!box.shifting && rpm >= CAR.upshiftRpm && box.gear < 8) {
          box.shift(1);
          rpm = rpmAt(v, box.gear);
        }
        rpm = Math.min(slew.toward(rpm, dt, box.shifting), CAR.limiterRpm);
        fill(s, rpm, 1, 1);
        box.apply(s);
        s.revLimiter = rpm >= CAR.limiterRpm - 1;
        s.ersPower = ersOn ? CAR.mgukPower : 0;
        s.speed = v;
        s.slipRear = v < kmh(120) ? 0.07 : 0.03;
        return s;
      };
    },
  },
  {
    name: 'lift-off',
    title: 'Lift-off and coast from high rpm',
    listen:
      'Full throttle in 7th, then a lift: tone goes hollow, a few subtle pops, turbo whine winds down, harvest whine.',
    duration: 7,
    create() {
      const s = base();
      let v = speedAt(10_600, 7);
      let t = 0;
      return (dt) => {
        t += dt;
        const lifted = t > 1.5;
        const pedal = lifted ? Math.max(0, 1 - (t - 1.5) / 0.08) : 1;
        v +=
          (pedal > 0 ? fullThrottleAccel(v, true) * pedal : 0) * dt -
          (pedal > 0 ? 0 : coastDecel(v) * dt);
        const rpm = rpmAt(v, 7);
        fill(s, rpm, pedal, pedal > 0 ? pedal : 0);
        s.gear = 7;
        s.ersPower = lifted ? -60_000 : CAR.mgukPower;
        s.speed = v;
        return s;
      };
    },
  },
  {
    name: 'braking-downshifts',
    title: 'Braking zone with downshifts, 8th to 2nd',
    listen:
      'Hard stop from about 315 km/h: blips and crackle on each downshift, harvest whine, a short lock-up squeal, a plank scrape at the start.',
    duration: 4.5,
    create() {
      const s = base();
      const box = new Gearbox(8);
      let v = speedAt(11_000, 8);
      const slew = new RpmSlew(11_000);
      let t = 0;
      return (dt) => {
        t += dt;
        box.tick(dt);
        const braking = t > 1 && v > kmh(88);
        if (t <= 1) v += fullThrottleAccel(v, true) * dt;
        else if (braking) v -= brakingDecel(v) * dt;
        let rpm = rpmAt(v, box.gear);
        if (braking && !box.shifting && rpm < 8200 && box.gear > 2) {
          box.shift(-1);
          rpm = rpmAt(v, box.gear);
        }
        rpm = slew.toward(rpm, dt, box.shifting);
        const throttle = t <= 1 ? 1 : braking ? 0 : 0.2;
        fill(s, rpm, throttle, t <= 1 ? 1 : braking ? 0 : 0.25);
        box.apply(s);
        s.ersPower = t <= 1 ? CAR.mgukPower : braking ? -CAR.mgukPower : 0;
        s.speed = v;
        const lockup = v < kmh(170) && v > kmh(140);
        s.slipFront = braking ? (lockup ? 0.19 : 0.06) : 0.01;
        s.slipRear = braking ? 0.04 : 0.01;
        s.bottoming = t > 1.02 && t < 1.3 ? 0.5 : 0;
        return s;
      };
    },
  },
  {
    name: 'limiter',
    title: 'On the rev limiter in 6th',
    listen: 'Rpm climbs into the limiter and holds: the ignition-cut stutter, then a lift.',
    duration: 4.5,
    create() {
      const s = base();
      let t = 0;
      return (dt) => {
        t += dt;
        const lifted = t > 3.8;
        let rpm = Math.min(CAR.limiterRpm, 11_600 + 2400 * t);
        const onLimiter = !lifted && rpm >= CAR.limiterRpm;
        if (onLimiter) rpm = CAR.limiterRpm - 75 + 75 * Math.cos(2 * Math.PI * 14 * t);
        if (lifted) rpm = CAR.limiterRpm - 1500 * (t - 3.8);
        fill(s, rpm, lifted ? 0 : 1, lifted ? 0 : 1);
        s.gear = 6;
        s.revLimiter = onLimiter;
        s.ersPower = lifted ? 0 : CAR.mgukPower;
        s.speed = speedAt(rpm, 6);
        return s;
      };
    },
  },
  {
    name: 'slow-corner',
    title: 'Slow corner: scrub, squeal and a kerb strike',
    listen:
      'Brake to about 85 km/h, understeer scrub then squeal, a kerb rumble with a plank tap at the apex, wheelspin squeal on exit, one upshift.',
    duration: 6,
    create() {
      const s = base();
      const box = new Gearbox(3);
      let v = kmh(115);
      const slew = new RpmSlew(rpmAt(v, 3));
      let t = 0;
      return (dt) => {
        t += dt;
        box.tick(dt);
        let throttle = 0;
        let load = 0;
        if (t < 1.6) {
          v = Math.max(kmh(85), v - 6 * dt); // trail-braking into the corner
        } else if (t < 2.8) {
          throttle = 0.15; // balancing the car at the apex
          load = 0.2;
        } else {
          throttle = Math.min(1, 0.3 + (t - 2.8) * 0.9);
          load = throttle;
          v += fullThrottleAccel(v, false) * throttle * 0.8 * dt;
        }
        let rpm = rpmAt(v, box.gear);
        if (!box.shifting && rpm >= CAR.upshiftRpm && box.gear < 8) {
          box.shift(1);
          rpm = rpmAt(v, box.gear);
        }
        rpm = slew.toward(rpm, dt, box.shifting);
        fill(s, rpm, throttle, load);
        box.apply(s);
        s.speed = v;
        s.slipFront = t < 0.8 ? 0.04 : t < 1.6 ? 0.04 + 0.08 * (t - 0.8) : t < 2.6 ? 0.15 : 0.05;
        s.slipRear =
          t > 3.0 && t < 3.9 ? 0.07 + 0.11 * Math.sin((Math.PI * (t - 3.0)) / 0.9) : 0.03;
        const onKerb = t > 2.25 && t < 2.65;
        s.kerb = onKerb ? 0.9 : 0;
        s.kerbFrequency = v / 0.6;
        s.bottoming = t > 2.3 && t < 2.38 ? 0.3 : 0;
        return s;
      };
    },
  },
  {
    name: 'pit-lane',
    title: 'Pit lane at 80 km/h on the pit limiter',
    listen:
      'Constant speed in 2nd, throttle floored, the limiter cut pattern; low wind and road noise.',
    duration: 5,
    create() {
      const s = base();
      let t = 0;
      return (dt) => {
        t += dt;
        const v = kmh(80) + 0.15 * Math.sin(2 * Math.PI * 0.7 * t);
        const rpm = rpmAt(v, 2);
        // The limiter holds speed by cutting ignition; the cylinders that do fire run at
        // full throttle, so the load seen by the voice stays high.
        fill(s, rpm, 1, 0.85);
        s.gear = 2;
        s.pitLimiter = true;
        s.speed = v;
        return s;
      };
    },
  },
  {
    name: 'rev-sweep',
    title: 'Full-load sweep from idle to the limiter',
    listen: 'One clean pitch sweep at full load, for the harmonic ladder; no road noise.',
    duration: 8,
    create() {
      const s = base();
      let t = 0;
      return (dt) => {
        t += dt;
        const rpm = CAR.idleRpm + (12_400 - CAR.idleRpm) * Math.min(1, t / 7.5);
        fill(s, rpm, 1, 1);
        s.gear = 0;
        return s;
      };
    },
  },
  {
    name: 'load-steps',
    title: 'Fixed 11 000 rpm, throttle on and off',
    listen: 'Same pitch throughout; the tone must change between full load and trailing throttle.',
    duration: 6,
    create() {
      const s = base();
      let t = 0;
      return (dt) => {
        t += dt;
        const on = Math.floor(t) % 2 === 0;
        fill(s, 11_000, on ? 1 : 0, on ? 1 : 0.03);
        s.gear = 7;
        s.speed = speedAt(11_000, 7);
        return s;
      };
    },
  },
];

export function scenarioByName(name: string): Scenario {
  const s = SCENARIOS.find((x) => x.name === name);
  if (!s)
    throw new Error(
      `unknown scenario "${name}"; known: ${SCENARIOS.map((x) => x.name).join(', ')}`,
    );
  return s;
}

/** What the renderer recorded at each state update, for analysis. */
export interface TracePoint {
  /** Sample index at which this state was applied. */
  frame: number;
  rpm: number;
  shifting: boolean;
  revLimiter: boolean;
  pitLimiter: boolean;
  engineOn: boolean;
}

export interface Rendered {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  trace: TracePoint[];
  /** Wall time spent in `AudioCore.process`, ms. */
  processMs: number;
  /** Layer RMS levels, dBFS, before bus gains. */
  layers: Record<string, number>;
  limiterMinGainDb: number;
}

export interface RenderOptions {
  view?: AudioView;
  sampleRate?: number;
  /** State updates per second (the sim rate). */
  updateRate?: number;
  /** Frames per `process` call. */
  blockSize?: number;
  seed?: number;
  /** Wall clock for the performance figure. Tests that need determinism leave it out. */
  now?: () => number;
}

/** Render a scenario through the audio core, the way the worklet would drive it. */
export function renderScenario(scenario: Scenario, options: RenderOptions = {}): Rendered {
  const sampleRate = options.sampleRate ?? 48_000;
  const updateRate = options.updateRate ?? 120;
  const blockSize = options.blockSize ?? 128;
  const core = new AudioCore({
    sampleRate,
    seed: options.seed ?? 1,
    ...(options.view ? { view: options.view } : {}),
  });
  const step = scenario.create();
  const total = Math.round(scenario.duration * sampleRate);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const trace: TracePoint[] = [];
  const framesPerUpdate = sampleRate / updateRate;
  let nextUpdate = 0;
  let updates = 0;
  let processMs = 0;
  const now = options.now;
  let frame = 0;
  while (frame < total) {
    if (frame >= nextUpdate) {
      const state = step(1 / updateRate);
      core.setCarState(state);
      trace.push({
        frame,
        rpm: (state.engineSpeed * 60) / (2 * Math.PI),
        shifting: state.shifting,
        revLimiter: state.revLimiter,
        pitLimiter: state.pitLimiter,
        engineOn: state.engineOn,
      });
      updates++;
      nextUpdate = Math.round(updates * framesPerUpdate);
    }
    // Stop each block at the next update, as the worklet does at its quantum boundaries.
    const n = Math.min(blockSize, total - frame, Math.max(1, nextUpdate - frame));
    const t0 = now?.() ?? 0;
    core.process([left.subarray(frame, frame + n), right.subarray(frame, frame + n)], n);
    if (now) processMs += now() - t0;
    frame += n;
  }
  const layers: Record<string, number> = {};
  for (const name of LAYERS) {
    const rms = core.meters.rms(name);
    layers[name] = rms > 0 ? Math.round(200 * Math.log10(rms)) / 10 : -Infinity;
  }
  return {
    sampleRate,
    left,
    right,
    trace,
    processMs,
    layers,
    limiterMinGainDb: Math.round(200 * Math.log10(core.limiter.minGain)) / 10,
  };
}
