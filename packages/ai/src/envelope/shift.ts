import { engineFullLoadTorque, type CarParams } from '@undercut/sim';

const RPM = (2 * Math.PI) / 60;

/** Crank torque at full throttle, with the rev limiter's soft cut, from the sim's engine model. */
export function fullLoadTorque(params: CarParams, efficiency: number, rpm: number): number {
  const eng = params.engine;
  const limiter = Math.min(1, Math.max(0, (eng.revLimit - rpm) / eng.limiterWidth));
  return engineFullLoadTorque(eng, efficiency, rpm) * limiter;
}

/**
 * Upshift points that maximise drive at the wheels, per gear (index 0 = 1st → 2nd), rpm. A gear
 * is held until the next one gives more wheel torque at the same road speed, or until the
 * limiter: computed from the sim's own full-load torque curve and the gear ratios. The last
 * entry (top gear) is the limiter.
 */
export function optimalShiftRpm(params: CarParams): number[] {
  const ratios = params.gearbox.ratios;
  const eng = params.engine;
  const efficiency = eng.peakPower / (eng.flowMax * eng.fuelEnergy); // as createCarModel derives it
  const out: number[] = [];
  const top = eng.revLimit - eng.limiterWidth;
  for (let g = 0; g < ratios.length; g++) {
    if (g === ratios.length - 1) {
      out.push(top);
      break;
    }
    const here = ratios[g]!;
    const next = ratios[g + 1]!;
    let shift = top;
    for (let n = 8000; n <= top; n += 10) {
      const wheelHere = fullLoadTorque(params, efficiency, n) * here;
      const wheelNext = fullLoadTorque(params, efficiency, (n * next) / here) * next;
      if (wheelNext > wheelHere) {
        shift = n;
        break;
      }
    }
    out.push(shift);
  }
  return out;
}

/** Engine speed, rpm, for road speed `v` (m/s) in gear `gear` (1-based). */
export function engineRpm(params: CarParams, gear: number, v: number): number {
  const ratio = params.gearbox.ratios[gear - 1] ?? 0;
  return (ratio * v) / params.tyre.rollingRadius / RPM;
}
