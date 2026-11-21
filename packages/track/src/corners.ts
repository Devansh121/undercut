/**
 * Corner detection from curvature: the rule the pipeline uses to number corners
 * (tools/track-pipeline/lib/corners.py), repeated here so the committed file can be checked.
 */
export interface CornerRule {
  readonly smoothSigma: number;
  readonly enter: number;
  readonly exit: number;
  readonly mergeGap: number;
  readonly minTurn: number;
}

/**
 * The default rule. A circuit may override it (its track file records the rule used in
 * `source.cornerRule`), because official numbering is a convention: Spa counts a 17 degree kink
 * and splits double apexes the default merges.
 */
export const CORNER_RULE: CornerRule = Object.freeze({
  /** Gaussian smoothing of curvature before detection, metres. */
  smoothSigma: 8,
  /** A corner starts above this |curvature| and ends below the lower one (1/m). */
  enter: 1 / 400,
  exit: 1 / 800,
  /** Same-direction stretches closer than this merge into one corner, metres. */
  mergeGap: 150,
  /** Stretches turning less than this are kinks, not corners, degrees. */
  minTurn: 20,
});

export interface DetectedCorner {
  /** Sample index of the apex (largest smoothed |curvature|), first and last sample. */
  apex: number;
  first: number;
  last: number;
  /** +1 left-hander, -1 right-hander. */
  sign: number;
  turnDeg: number;
}

export function smoothClosed(values: ArrayLike<number>, sigmaSamples: number): Float64Array {
  const n = values.length;
  const half = Math.ceil(3 * sigmaSamples);
  const w: number[] = [];
  let sum = 0;
  for (let k = -half; k <= half; k++) {
    const v = Math.exp(-0.5 * (k / sigmaSamples) ** 2);
    w.push(v);
    sum += v;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -half; k <= half; k++) acc += w[k + half]! * values[(((i + k) % n) + n) % n]!;
    out[i] = acc / sum;
  }
  return out;
}

/** Corners of a closed lap from per-sample curvature at geometric spacing `step` metres. */
export function detectCorners(
  curvature: ArrayLike<number>,
  step: number,
  rule: CornerRule = CORNER_RULE,
): DetectedCorner[] {
  const n = curvature.length;
  const ks = smoothClosed(curvature, rule.smoothSigma / step);
  let start = 0;
  for (let i = 1; i < n; i++) if (Math.abs(ks[i]!) < Math.abs(ks[start]!)) start = i;
  const regions: [number, number, number][] = [];
  let cur: [number, number, number] | null = null;
  for (let j = 0; j <= n; j++) {
    const k = ks[(start + j) % n]!;
    if (cur) {
      if (Math.abs(k) < rule.exit || k > 0 !== cur[2] > 0 || j === n) {
        regions.push(cur);
        cur = null;
      } else {
        cur[1] = j;
      }
    }
    if (!cur && j < n && Math.abs(k) > rule.enter) cur = [j, j, k > 0 ? 1 : -1];
  }
  const merged: [number, number, number][] = [];
  for (const r of regions) {
    const last = merged[merged.length - 1];
    if (last && last[2] === r[2] && (r[0] - last[1]) * step < rule.mergeGap) last[1] = r[1];
    else merged.push([r[0], r[1], r[2]]);
  }
  const out: DetectedCorner[] = [];
  for (const [a, b, sign] of merged) {
    let turn = 0;
    let apex = (start + a) % n;
    for (let j = a; j <= b; j++) {
      const i = (start + j) % n;
      turn += curvature[i]!;
      if (Math.abs(ks[i]!) > Math.abs(ks[apex]!)) apex = i;
    }
    const turnDeg = (Math.abs(turn * step) * 180) / Math.PI;
    if (turnDeg < rule.minTurn) continue;
    out.push({ apex, first: (start + a) % n, last: (start + b) % n, sign, turnDeg });
  }
  return out.sort((p, q) => p.apex - q.apex);
}
