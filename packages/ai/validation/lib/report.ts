import { createReferenceDriver, planFromRacingLine } from '../../src/reference-setup';
import { REFERENCE_SKILL } from '../../src/driver/reference';
import type { DrivingPlan } from '../../src/profile/plan';
import { loadEnvelope, loadLine } from './artefacts';
import type { CircuitSetup } from './circuits';
import { runLaps, type LapRecord, type LapRunResult } from './lap';
import { LAP_TARGETS, MONZA_M4_BAND, MONZA_PUBLISHED, MONZA_REFERENCE_LAP } from './targets';

export interface ReferenceLapOptions {
  laps?: number;
  fuel?: number;
  recordEvery?: number;
  clock?: () => number;
}

export interface ReferenceLapRun {
  result: LapRunResult;
  plan: DrivingPlan;
}

/**
 * The reference driver on the committed racing line, in the doc 2.1 conditions: flying start
 * 400 m before the line (the run-up is the end of the out-lap, so the MGU-K may deploy on it),
 * then `laps` timed laps.
 */
export function referenceLap(setup: CircuitSetup, o: ReferenceLapOptions = {}): ReferenceLapRun {
  const track = setup.track();
  const envelope = loadEnvelope(setup);
  const line = loadLine(setup);
  const plan = planFromRacingLine(track, line, envelope, REFERENCE_SKILL);
  const result = runLaps({
    track,
    plan,
    trim: setup.trim,
    airDensity: setup.airDensity,
    fuel: o.fuel ?? setup.fuel,
    laps: o.laps ?? 1,
    recordEvery: o.recordEvery ?? 0,
    stops: { 1: [MONZA_PUBLISHED.t1.v1, MONZA_PUBLISHED.t1.v2] },
    ...(o.clock ? { clock: o.clock } : {}),
    driver: (params) =>
      createReferenceDriver({ track, line, envelope, params, deployBeforeLine: true }),
  });
  return { result, plan };
}

export interface SectorRow {
  sector: number;
  time: number;
  plan: number;
  pole: number;
  best: number;
  /** Ours minus the pole lap's sector, s and %. */
  delta: number;
  percent: number;
}

export interface CornerRow {
  number: number;
  name: string;
  minSpeed: number;
  planMin: number;
  entrySpeed: number;
  brakeDistance: number;
  brakeTime: number;
  published: string;
}

export interface LapReport {
  lap: number;
  plan: number;
  reference: number;
  /** Ours against the reference lap, s and %. */
  margin: number;
  marginPercent: number;
  m1: readonly [number, number];
  m4: readonly [number, number];
  /** How far outside the band (s; 0 when inside). */
  outsideM1: number;
  outsideM4: number;
  trap: number;
  trapTarget: string;
  finish: number;
  sectors: SectorRow[];
  corners: CornerRow[];
  deployMJ: number;
  harvestMJ: number;
  maxWheelsOff: number;
  maxLateralError: number;
  rmsLateralError: number;
  maxSideslipDeg: number;
}

function planSectorTimes(plan: DrivingPlan): number[] {
  const t = plan.profile.time;
  const step = plan.track.lap.step;
  const at = (s: number): number => t[Math.round(s / step) % t.length]!;
  const lines = Array.from(plan.track.sectors);
  return lines.map((s, k) =>
    k + 1 < lines.length ? at(lines[k + 1]!) - at(s) : plan.profile.lapTime - at(s),
  );
}

function planCornerMin(plan: DrivingPlan, start: number, end: number): number {
  const step = plan.track.lap.step;
  const n = plan.line.count;
  let m = Infinity;
  const i0 = Math.round(start / step);
  const i1 = Math.round(end / step);
  for (let i = i0; i <= i1; i++) m = Math.min(m, plan.profile.v[i % n]!);
  return m * 3.6;
}

export function monzaLapReport(lap: LapRecord, plan: DrivingPlan): LapReport {
  const m1 = [LAP_TARGETS['monza-lap-m1']!.low, LAP_TARGETS['monza-lap-m1']!.high] as const;
  const out = (x: number, [lo, hi]: readonly [number, number]): number =>
    x < lo ? lo - x : x > hi ? x - hi : 0;
  const planSectors = planSectorTimes(plan);
  const pub = MONZA_PUBLISHED;
  const sectors = lap.sectors.map((t, k) => ({
    sector: k + 1,
    time: t,
    plan: planSectors[k]!,
    pole: pub.poleSectors[k]!,
    best: pub.bestSectors[k]!,
    delta: t - pub.poleSectors[k]!,
    percent: ((t - pub.poleSectors[k]!) / pub.poleSectors[k]!) * 100,
  }));
  const corners = lap.corners.map((c, k) => {
    const cd = plan.track.corners[k]!;
    let published = '';
    if (c.number === 1 && c.stop) {
      published =
        `${pub.t1.v1}→${pub.t1.v2} km/h: ${pub.t1.distance} m, ${pub.t1.time} s published; ` +
        `${c.stop.distance.toFixed(0)} m, ${c.stop.time.toFixed(2)} s here`;
    }
    if (c.number === 4) published = `braking ${pub.t4.distance} m, ${pub.t4.time} s published`;
    return {
      number: c.number,
      name: c.name,
      minSpeed: c.minSpeed,
      planMin: planCornerMin(plan, cd.start, cd.end),
      entrySpeed: c.entrySpeed,
      brakeDistance: c.brakeDistance,
      brakeTime: c.brakeTime,
      published,
    };
  });
  return {
    lap: lap.time,
    plan: plan.profile.lapTime,
    reference: MONZA_REFERENCE_LAP,
    margin: lap.time - MONZA_REFERENCE_LAP,
    marginPercent: ((lap.time - MONZA_REFERENCE_LAP) / MONZA_REFERENCE_LAP) * 100,
    m1,
    m4: MONZA_M4_BAND,
    outsideM1: out(lap.time, m1),
    outsideM4: out(lap.time, MONZA_M4_BAND),
    trap: lap.trap,
    trapTarget: LAP_TARGETS['monza-trap']!.stated,
    finish: lap.finish,
    sectors,
    corners,
    deployMJ: lap.deployMJ,
    harvestMJ: lap.harvestMJ,
    maxWheelsOff: lap.maxWheelsOff,
    maxLateralError: lap.maxLateralError,
    rmsLateralError: lap.rmsLateralError,
    maxSideslipDeg: lap.maxSideslipDeg,
  };
}

const fixed3 = (x: number): string => x.toFixed(3);
const fixed1 = (x: number): string => x.toFixed(1);

/** Plain-text tables for the terminal and the PR. */
export function formatLapReport(r: LapReport): string {
  const lines: string[] = [];
  lines.push(
    `Lap ${fixed3(r.lap)} s (plan ${fixed3(r.plan)} s); reference ${fixed3(r.reference)} s: ` +
      `${r.margin >= 0 ? '+' : ''}${fixed3(r.margin)} s (${r.marginPercent >= 0 ? '+' : ''}${fixed1(r.marginPercent)} %)`,
  );
  lines.push(
    `M1 band ${fixed3(r.m1[0])}–${fixed3(r.m1[1])} s: ${r.outsideM1 > 0 ? `outside by ${fixed3(r.outsideM1)} s` : 'inside'}; ` +
      `M4 band ${fixed3(r.m4[0])}–${fixed3(r.m4[1])} s: ${r.outsideM4 > 0 ? `outside by ${fixed3(r.outsideM4)} s` : 'inside'}`,
  );
  lines.push(
    `Speed trap ${fixed1(r.trap)} km/h (target ${r.trapTarget}); timing line ${fixed1(r.finish)} km/h ` +
      `(published fastest ${MONZA_PUBLISHED.finishLine}); ERS deployed ${r.deployMJ.toFixed(2)} MJ, ` +
      `harvested ${r.harvestMJ.toFixed(2)} MJ`,
  );
  lines.push(
    `Clean: at most ${r.maxWheelsOff} wheel(s) past the white line, sideslip ≤ ${fixed1(r.maxSideslipDeg)}°, ` +
      `line error max ${r.maxLateralError.toFixed(2)} m, RMS ${r.rmsLateralError.toFixed(2)} m`,
  );
  lines.push('');
  lines.push('| Sector | Lap | Plan | Pole lap | Session best | Lap − pole |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of r.sectors) {
    lines.push(
      `| S${s.sector} | ${fixed3(s.time)} | ${fixed3(s.plan)} | ${fixed3(s.pole)} | ${fixed3(s.best)} | ` +
        `${s.delta >= 0 ? '+' : ''}${fixed3(s.delta)} (${s.percent >= 0 ? '+' : ''}${fixed1(s.percent)} %) |`,
    );
  }
  lines.push('');
  lines.push(
    '| Corner | Min speed (km/h) | Plan min | Brakes on at (km/h) | Braking distance (m) | Braking time (s) | Published |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const c of r.corners) {
    const braked = c.entrySpeed > 0;
    lines.push(
      `| T${c.number} ${c.name} | ${fixed1(c.minSpeed)} | ${fixed1(c.planMin)} | ${braked ? fixed1(c.entrySpeed) : '—'} | ` +
        `${braked ? fixed1(c.brakeDistance) : '—'} | ${braked ? c.brakeTime.toFixed(2) : '—'} | ${c.published || '—'} |`,
    );
  }
  return lines.join('\n');
}

/** CSV of a lap trace, numbers to six significant digits. */
export function lapTraceToCsv(trace: { columns: readonly string[]; rows: number[][] }): string {
  const out = [trace.columns.join(',')];
  for (const row of trace.rows) out.push(row.map((v) => Number(v.toPrecision(6))).join(','));
  return out.join('\n') + '\n';
}
