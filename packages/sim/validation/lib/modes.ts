import { Harness, STEP } from './harness';

/**
 * Free decay of the body modes at rest: settle the dry car on flat ground, displace the body in
 * heave or roll from its equilibrium, release, and fit a damped oscillation
 * x(t) = e^(−ζωt)·(a·cos ω_d t + b·sin ω_d t) to the first 0.3 s by least squares over a grid of
 * natural frequency and damping ratio (amplitudes solved linearly at each grid point).
 */
export interface ModeResult {
  frequency: number;
  damping: number;
}

export function freeDecay(mode: 'heave' | 'roll' | 'pitch', amplitude = 0.004): ModeResult {
  const h = new Harness({ trim: 'medium', fuel: 0 });
  for (let k = 0; k < 480; k++) h.step();
  const car = h.car;
  const read = (): number => (mode === 'heave' ? car.y : mode === 'roll' ? car.roll : car.pitch);
  const eq = read();
  if (mode === 'heave') car.y += amplitude;
  else if (mode === 'roll') car.roll += amplitude;
  else car.pitch += amplitude;
  const ts: number[] = [0];
  const xs: number[] = [amplitude];
  for (let k = 0; k < 0.3 / STEP; k++) {
    h.step();
    ts.push(h.steps * STEP - 480 * STEP);
    xs.push(read() - eq);
  }
  const fit = (f: number, z: number): number => {
    const w = 2 * Math.PI * f;
    const wd = w * Math.sqrt(1 - z * z);
    let s11 = 0;
    let s12 = 0;
    let s22 = 0;
    let r1 = 0;
    let r2 = 0;
    for (let i = 0; i < ts.length; i++) {
      const e = Math.exp(-z * w * ts[i]!);
      const c = e * Math.cos(wd * ts[i]!);
      const s = e * Math.sin(wd * ts[i]!);
      s11 += c * c;
      s12 += c * s;
      s22 += s * s;
      r1 += c * xs[i]!;
      r2 += s * xs[i]!;
    }
    const det = s11 * s22 - s12 * s12;
    const a = (r1 * s22 - r2 * s12) / det;
    const b = (r2 * s11 - r1 * s12) / det;
    let err = 0;
    for (let i = 0; i < ts.length; i++) {
      const e = Math.exp(-z * w * ts[i]!);
      const m = e * (a * Math.cos(wd * ts[i]!) + b * Math.sin(wd * ts[i]!));
      err += (m - xs[i]!) ** 2;
    }
    return err;
  };
  // Coarse grid, then a fine one around the best point.
  let best = { frequency: 0, damping: 0, err: Infinity };
  for (let f = 2; f <= 20; f += 0.1) {
    for (let z = 0.02; z <= 0.95; z += 0.01) {
      const err = fit(f, z);
      if (err < best.err) best = { frequency: f, damping: z, err };
    }
  }
  const c = best;
  for (let f = c.frequency - 0.1; f <= c.frequency + 0.1; f += 0.005) {
    for (let z = c.damping - 0.01; z <= c.damping + 0.01; z += 0.0005) {
      const err = fit(f, z);
      if (err < best.err) best = { frequency: f, damping: z, err };
    }
  }
  return { frequency: best.frequency, damping: best.damping };
}
