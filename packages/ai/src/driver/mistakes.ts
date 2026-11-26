import { createRng, type Rng } from '@undercut/core';
import { Phase, type SpeedProfile } from '../profile/speed-profile';

/**
 * A racing driver's small errors: a lock-up into a braking zone, a missed apex, a wide exit.
 * Each costs a few tenths and leaves the car on the road; a car close behind can use them.
 * Seeded per driver, decided once per corner, more often for a less consistent driver and
 * under pressure from a car close behind. They never start on the opening lap, in a move,
 * beside another car or near a hazard (the race driver says when one may start).
 */

/** A braking corner on the plan, as line sample indices: braking onset, slowest point, exit. */
export interface CornerRun {
  start: number;
  apex: number;
  /** The last sample of the corner (may be past the lap's end: indices run on, mod n). */
  end: number;
}

/** One kind of error: where in the corner it lasts and what it does to the pedals there. */
export interface MistakeKind {
  readonly name: 'lock-up' | 'missed apex' | 'wide exit';
  /** Severity drawn for it, from `severity[0]` to `severity[1]`. */
  readonly severity: readonly [number, number];
  /** Samples it lasts over, [from, to] (to may pass the lap's end). */
  span(c: CornerRun, exitSamples: number): readonly [number, number];
  /**
   * The acceleration ceiling it sets, m/s², at speed `v` where the plan wants `vPlan`
   * (Infinity: none).
   */
  limit(v: number, vPlan: number, severity: number): number;
}

/** Speed feedback for a capped speed, 1/s (the race driver's own `SPEED_GAIN`). */
const GAIN = 3;

/** Overslowed on the brakes: the car brakes too hard, early, and reaches the apex slow. */
const LOCK_UP: MistakeKind = {
  name: 'lock-up',
  severity: [0.06, 0.14],
  span: (c) => [c.start, c.apex],
  limit: (v, vPlan, sev) => GAIN * ((1 - sev) * vPlan - v),
};

/** Off the apex: the middle of the corner a little under the plan's speed. */
const MISSED_APEX: MistakeKind = {
  name: 'missed apex',
  severity: [0.05, 0.1],
  span: (c) => [
    c.apex - Math.floor((c.apex - c.start) / 2),
    c.apex + Math.floor((c.end - c.apex) / 2),
  ],
  limit: (v, vPlan, sev) => GAIN * ((1 - sev) * vPlan - v),
};

/** Wide on the exit: the drive comes late, at no more than a share of a moderate push. */
const WIDE_EXIT: MistakeKind = {
  name: 'wide exit',
  severity: [0.4, 0.7],
  span: (c, exit) => [c.apex, c.end + exit],
  limit: (_v, _vPlan, sev) => WIDE_EXIT_DRIVE * (1 - sev),
};

/** Drive on a wide exit before its severity, m/s². */
const WIDE_EXIT_DRIVE = 6;
/** How far past the corner a wide exit costs drive, m. */
const WIDE_EXIT_RUN = 150;

export const MISTAKE_KINDS: readonly MistakeKind[] = [LOCK_UP, MISSED_APEX, WIDE_EXIT];
/** How often each kind comes, in the order above (summing to 1): a wide exit most often. */
const MISTAKE_WEIGHTS: readonly number[] = [0.25, 0.25, 0.5];

/** Errors per lap for a driver of the default consistency (0.8). */
export const MISTAKES_PER_LAP = 0.6;
/** Roughness (1 - consistency) the rate above is for. */
const ROUGH_REF = 0.2;
/** A car close behind (within the mirrors) makes an error this much more likely. */
export const PRESSURE = 2;
/** Outside a braking zone an error slows the car at no more than this, m/s² (a lift). */
const MISTAKE_LIFT = 2;
/** Least slowdown from braking onset to apex for a corner to count, m/s. */
const MIN_DROP = 5;

/**
 * The braking corners of a speed profile: each run of braking samples, on to the slowest point
 * after it and the point where the car is back at full throttle (or the next braking).
 */
export function brakingCorners(profile: SpeedProfile): CornerRun[] {
  const n = profile.v.length;
  const phase = profile.phase;
  const out: CornerRun[] = [];
  // Start the walk at a sample that is not braking, so no run is split at the lap's end.
  let first = 0;
  while (first < n && phase[first] === Phase.Brake) first++;
  if (first === n) return out;
  for (let m = 0; m < n; m++) {
    const i = first + m;
    if (phase[i % n] !== Phase.Brake || phase[(i - 1 + n) % n] === Phase.Brake) continue;
    // From the onset: through the braking, then to the slowest point and the exit.
    let k = i;
    while (k < i + n && phase[k % n] === Phase.Brake) k++;
    let apex = k;
    let j = k;
    while (j < i + n && phase[j % n] !== Phase.Brake && phase[j % n] !== Phase.Throttle) {
      if (profile.v[j % n]! < profile.v[apex % n]!) apex = j;
      j++;
    }
    if (profile.v[i % n]! - profile.v[apex % n]! < MIN_DROP) continue;
    out.push({ start: i, apex, end: Math.max(apex, j - 1) });
  }
  return out;
}

export interface MistakesOptions {
  profile: SpeedProfile;
  /** Line sample spacing, m. */
  step: number;
  /** 0 to 1: 1 makes none. */
  consistency: number;
  seed: number;
  /** Errors per lap at the default consistency (default `MISTAKES_PER_LAP`). */
  perLap?: number;
}

/** What a driver's error is doing now (for diagnostics and tests). */
export interface ActiveMistake {
  kind: MistakeKind['name'];
  from: number;
  to: number;
  severity: number;
}

export class DriverMistakes {
  private readonly runs: CornerRun[];
  /** Per line sample: the braking corner it is in (onset to exit), or -1. */
  private readonly runAt: Int16Array;
  /** Per line sample: 1 in a braking zone of the plan. */
  private readonly braking: Uint8Array;
  private readonly n: number;
  private readonly chance: number;
  private readonly exitSamples: number;
  private readonly seed: number;
  private rng: Rng;
  /** The corner last decided on (-1 none), and the error under way (kind -1: none). */
  private decided = -1;
  private kind = -1;
  private from = 0;
  private to = 0;
  private severity = 0;
  /** Errors made so far (diagnostics). */
  count = 0;

  constructor(o: MistakesOptions) {
    this.n = o.profile.v.length;
    this.runs = brakingCorners(o.profile);
    this.runAt = new Int16Array(this.n).fill(-1);
    this.braking = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) this.braking[i] = o.profile.phase[i] === Phase.Brake ? 1 : 0;
    this.runs.forEach((c, r) => {
      for (let i = c.start; i <= c.end; i++) this.runAt[i % this.n] = r;
    });
    const rough = Math.max(0, Math.min(1, 1 - o.consistency));
    const perLap = o.perLap ?? MISTAKES_PER_LAP;
    this.chance =
      this.runs.length > 0 ? Math.min(0.5, (perLap * rough) / ROUGH_REF / this.runs.length) : 0;
    this.exitSamples = Math.round(WIDE_EXIT_RUN / o.step);
    this.seed = (o.seed ^ 0x6d157a4e) >>> 0;
    this.rng = createRng(this.seed);
  }

  /** The braking corners errors are decided at. */
  get corners(): readonly CornerRun[] {
    return this.runs;
  }

  /** The error under way, if any. */
  get active(): ActiveMistake | null {
    if (this.kind < 0) return null;
    return {
      kind: MISTAKE_KINDS[this.kind]!.name,
      from: this.from,
      to: this.to,
      severity: this.severity,
    };
  }

  /**
   * One tick at line sample `i` (rounded down from the car's lap position) at speed `v`, where
   * the plan wants `vPlan`. `allowed`: an error may start (decided once, on reaching a corner's
   * braking onset). `pressed`: a car is close behind. Returns the acceleration ceiling, m/s².
   */
  update(i: number, v: number, vPlan: number, allowed: boolean, pressed: boolean): number {
    const n = this.n;
    const r = this.runAt[((i % n) + n) % n]!;
    if (r >= 0 && r !== this.decided) {
      this.decided = r;
      // Three draws every time, whether or not an error may start: the sequence of corners
      // decides the draws, not the traffic.
      const roll = this.rng.next();
      const which = this.rng.next();
      const sev = this.rng.next();
      const chance = this.chance * (pressed ? PRESSURE : 1);
      if (allowed && this.kind < 0 && roll < chance) {
        let k = 0;
        for (let w = which; k < MISTAKE_KINDS.length - 1 && w >= MISTAKE_WEIGHTS[k]!; k++)
          w -= MISTAKE_WEIGHTS[k]!;
        const kind = MISTAKE_KINDS[k]!;
        const c = this.runs[r]!;
        const [from, to] = kind.span(c, this.exitSamples);
        this.kind = k;
        this.from = from;
        this.to = to;
        this.severity = kind.severity[0] + (kind.severity[1] - kind.severity[0]) * sev;
        this.count++;
      }
    } else if (r < 0) this.decided = -1;
    if (this.kind < 0) return Number.POSITIVE_INFINITY;
    // Samples on from the error's start (the span may run past the lap's end).
    const since = (((i - this.from) % n) + n) % n;
    if (since > this.to - this.from) {
      // Before its start (the car went back) or past its end: over.
      if (since > n / 2) return Number.POSITIVE_INFINITY;
      this.kind = -1;
      return Number.POSITIVE_INFINITY;
    }
    const a = MISTAKE_KINDS[this.kind]!.limit(v, vPlan, this.severity);
    // Outside the braking zone an error only lifts: braking on top of a corner's load took a car
    // wide into Singapore's walls.
    return this.braking[((i % n) + n) % n] === 1 ? a : Math.max(a, -MISTAKE_LIFT);
  }

  /** Called the car out of the driver's hands (pit lane, recovery): no error carries on. */
  cancel(): void {
    this.kind = -1;
  }

  reset(): void {
    this.rng = createRng(this.seed);
    this.decided = -1;
    this.kind = -1;
    this.from = 0;
    this.to = 0;
    this.severity = 0;
    this.count = 0;
  }

  snapshot(out: Record<string, number | boolean | readonly number[]>): void {
    out['err.rng'] = this.rng.getState().slice();
    out['err.decided'] = this.decided;
    out['err.kind'] = this.kind;
    out['err.from'] = this.from;
    out['err.to'] = this.to;
    out['err.severity'] = this.severity;
    out['err.count'] = this.count;
  }

  /** From `snapshot`; memory saved before errors existed starts them afresh. */
  restore(m: Readonly<Record<string, unknown>>): void {
    const rng = m['err.rng'];
    if (!Array.isArray(rng) || rng.length !== 4) {
      this.reset();
      return;
    }
    this.rng.setState([rng[0] as number, rng[1] as number, rng[2] as number, rng[3] as number]);
    const num = (k: string, d: number): number => {
      const v = m[k];
      return typeof v === 'number' ? v : d;
    };
    this.decided = num('err.decided', -1);
    this.kind = num('err.kind', -1);
    this.from = num('err.from', 0);
    this.to = num('err.to', 0);
    this.severity = num('err.severity', 0);
    this.count = num('err.count', 0);
  }
}
