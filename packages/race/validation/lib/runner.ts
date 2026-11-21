import { createCarParams } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { MONZA, loadEnvelope, loadLine } from '../../../ai/validation/lib/index';
import type { RaceEvent } from '../../src/events';
import type { SessionSpec } from '../../src/kinds';
import type { EntrantInfo, SessionResult } from '../../src/results';
import type { RaceRules } from '../../src/rules';
import { createAiField } from '../../src/session/ai-field';
import { RaceSession } from '../../src/session/session';
import { RaceWeekend } from '../../src/weekend';

/**
 * Headless race runs: N AI cars with a skill spread on a circuit, faster than real time, with
 * the event log, the classification and the watchdog's anomalies. Shared by the telemetry
 * runner (`npm run telemetry -- race | weekend`), the physics job and the nightly soak.
 */
export interface RaceRunOptions {
  circuit?: 'monza';
  cars: number;
  laps: number;
  seed: number;
  /** Skill spread across the field, 0 to 1. */
  spread?: number;
  /**
   * One stop (tyres) per car: the lap each car is asked in on, or null for no stops. Default
   * for races of five laps or more: around half distance, spread over three laps across the
   * field (car k on lap mid - 1 + k mod 3).
   */
  pitLap?: ((car: number) => number | null) | null;
  rules?: Partial<RaceRules>;
  /** Give up after this much sim time, s (a stuck session). */
  maxTime?: number;
  /** A wall clock (ms) to report speed with; the run itself never reads one. */
  clock?: () => number;
  /** Grid order (car indices, pole first). */
  grid?: number[];
}

export interface CarSummary {
  car: number;
  code: string;
  /** Position after the first lap (at the leader's first crossing of the line). */
  positionAfterLap1: number | null;
  /** Lowest speed after lights out outside the pit lane, km/h, and where (lap s). */
  minSpeedKmh: number;
  minSpeedAt: number;
  /** Most wheels off at once, and ticks with all four off. */
  maxWheelsOff: number;
  allOffTicks: number;
  /** Largest |d| from the centreline outside the pit lane, m. */
  maxOffset: number;
  /** Ticks in contact with another car, the largest closing speed at a contact (m/s), and the total impulse (N·s). */
  contactTicks: number;
  maxContactSpeed: number;
  contactImpulse: number;
  /** Longest unbroken spell in contact with another car, s. */
  longestContact: number;
  /** Largest distance of the CoG past the barrier line on its side, m (negative: never reached it). */
  beyondBarrier: number;
  /** Spins after the start (heading more than 0.8 rad off the track's direction, outside the pit lane). */
  spins: number;
  /** Through the first corners on lap 1 cleanly, or what went wrong there. */
  turnOne: 'clean' | 'contact' | 'spin' | 'off' | 'stopped' | 'pending';
}

/** Cars that would have touched on the first lap if the sim had car-to-car contact. */
export interface FirstLapOverlaps {
  /** Most overlapping pairs at one moment, and where the leader was then (lap s). */
  peak: number;
  peakAtS: number;
  /** Distinct pairs that overlapped at any time on lap 1, and in the first corner's braking zone and exit. */
  pairs: number;
  pairsInFirstCorner: number;
}

export interface RaceRun {
  result: SessionResult;
  events: RaceEvent[];
  cars: CarSummary[];
  simTime: number;
  wallSeconds: number | null;
  /** The first lap: who led at the line and how far behind the last car crossed it, s. */
  firstLap: { leader: number; spread: number } | null;
  overlaps: FirstLapOverlaps;
}

/** Default stop lap for car k in a race of `laps` laps, or null. */
export function defaultPitLap(laps: number): ((car: number) => number | null) | null {
  if (laps < 5) return null;
  const mid = Math.ceil(laps / 2);
  return (car) => Math.max(2, Math.min(laps - 1, mid - 1 + (car % 3)));
}

/** Car footprint for the overlap count, m: length and width with a little margin off. */
const CAR_LENGTH = 5.4;
const CAR_WIDTH = 1.9;

export function entrantsFor(count: number): EntrantInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `car${String(i + 1).padStart(2, '0')}`,
    name: `Driver ${String(i + 1).padStart(2, '0')}`,
    code: `D${String(i + 1).padStart(2, '0')}`,
    team: Math.floor(i / 2),
  }));
}

interface Loaded {
  track: Track;
  line: ReturnType<typeof loadLine>;
  envelope: ReturnType<typeof loadEnvelope>;
}

let cache: Loaded | null = null;
function load(): Loaded {
  cache ??= { track: MONZA.track(), line: loadLine(MONZA), envelope: loadEnvelope(MONZA) };
  return cache;
}

/** Build a session of AI cars. */
export function aiSession(
  spec: SessionSpec,
  o: Pick<RaceRunOptions, 'cars' | 'seed' | 'spread' | 'rules' | 'grid'>,
): RaceSession {
  const { track, line, envelope } = load();
  const params = createCarParams(MONZA.trim);
  const field = createAiField({
    track,
    line,
    envelope,
    params,
    count: o.cars,
    seed: o.seed,
    ...(o.spread !== undefined ? { spread: o.spread } : {}),
    ...(o.rules ? { rules: o.rules } : {}),
  });
  const entrants = entrantsFor(o.cars);
  return new RaceSession({
    track,
    session: spec,
    seed: o.seed,
    params,
    cars: field.map((controller, i) => ({
      entrant: entrants[i]!,
      controller,
      ersMode: controller.driver.ersMode,
    })),
    ...(o.rules ? { rules: o.rules } : {}),
    ...(o.grid ? { grid: o.grid } : {}),
  });
}

/** Run one session to its end with per-car summaries. */
export function runSession(
  session: RaceSession,
  o: {
    pitLap?: ((car: number) => number | null) | null;
    maxTime?: number;
    clock?: () => number;
  } = {},
): RaceRun {
  const n = session.cars.length;
  const events: RaceEvent[] = [];
  const cars: CarSummary[] = session.entrants.map((e, i) => ({
    car: i,
    code: e.code,
    positionAfterLap1: null,
    minSpeedKmh: Infinity,
    minSpeedAt: 0,
    maxWheelsOff: 0,
    allOffTicks: 0,
    maxOffset: 0,
    contactTicks: 0,
    maxContactSpeed: 0,
    contactImpulse: 0,
    longestContact: 0,
    beyondBarrier: Number.NEGATIVE_INFINITY,
    spins: 0,
    turnOne: 'pending',
  }));
  const contactRun = new Float64Array(n);
  const spinning = new Array<boolean>(n).fill(false);
  const offTime = new Float64Array(n);
  const tangent = { x: 0, y: 0, z: 0 };
  const track = session.track;
  const asked = new Array<boolean>(n).fill(false);
  let firstLap: RaceRun['firstLap'] = null;
  let leaderLap1At = 0;
  const overlaps: FirstLapOverlaps = { peak: 0, peakAtS: 0, pairs: 0, pairsInFirstCorner: 0 };
  const seenPairs = new Set<number>();
  const cornerPairs = new Set<number>();
  const corner1 = session.track.corners[0];
  const cornerFrom = corner1 ? corner1.start - 150 : 0;
  const cornerTo = session.track.corners[1]?.end ?? (corner1 ? corner1.end : 0);
  const t0 = o.clock?.() ?? null;
  const maxTime = o.maxTime ?? 7200;
  const c = session.control;
  while (!session.ended && session.time < maxTime) {
    const ev = session.tick();
    if (ev.length) events.push(...ev);
    for (const e of ev) {
      if (e.type !== 'lap' || e.result.lap !== 1 || c.strategy.kind !== 'race') continue;
      if (firstLap === null) {
        leaderLap1At = e.at;
        firstLap = { leader: e.car, spread: 0 };
        c.order.forEach((car, k) => (cars[car]!.positionAfterLap1 = k + 1));
      } else firstLap.spread = e.at - leaderLap1At;
    }
    const racing = c.phase === 'green' || c.phase === 'chequered';
    if (racing && c.strategy.kind === 'race' && c.timer(c.order[0]!).lap === 1) {
      let now = 0;
      for (let i = 0; i < n; i++) {
        const fi = session.carFacts(i);
        if (fi.inPitLane) continue;
        for (let j = i + 1; j < n; j++) {
          const fj = session.carFacts(j);
          if (fj.inPitLane) continue;
          if (
            Math.abs(c.cars[i]!.dist - c.cars[j]!.dist) < CAR_LENGTH &&
            Math.abs(fi.d - fj.d) < CAR_WIDTH
          ) {
            now++;
            const key = i * 1000 + j;
            seenPairs.add(key);
            if (fi.s >= cornerFrom && fi.s <= cornerTo) cornerPairs.add(key);
          }
        }
      }
      if (now > overlaps.peak) {
        overlaps.peak = now;
        overlaps.peakAtS = session.carFacts(c.order[0]!).s;
      }
    }
    for (let i = 0; i < n; i++) {
      const f = session.carFacts(i);
      const s = cars[i]!;
      if (racing && c.racing(i) && !f.inPitLane && !c.held(i)) {
        const kmh = f.speed * 3.6;
        if (session.time > (c.lightsOutAt ?? c.greenTime ?? 0) + 10 && kmh < s.minSpeedKmh) {
          s.minSpeedKmh = kmh;
          s.minSpeedAt = f.s;
        }
        s.maxWheelsOff = Math.max(s.maxWheelsOff, f.wheelsOff);
        if (f.wheelsOff >= 4) s.allOffTicks++;
        s.maxOffset = Math.max(s.maxOffset, Math.abs(f.d));
        const st = session.worldCar(i).state;
        const dt = session.world.step;
        if (st.carContacts > 0) {
          s.contactTicks++;
          contactRun[i] = contactRun[i]! + dt;
          s.longestContact = Math.max(s.longestContact, contactRun[i]!);
        } else contactRun[i] = 0;
        s.maxContactSpeed = Math.max(s.maxContactSpeed, st.carContactSpeed);
        s.contactImpulse += st.carContactImpulse;
        const side = f.d >= 0 ? 0 : 1;
        const barrier = track.lap.interpolate(track.barrier[side], f.s);
        s.beyondBarrier = Math.max(s.beyondBarrier, Math.abs(f.d) - barrier);
        track.tangentAt(f.s, tangent);
        const err = st.yaw - Math.atan2(-tangent.z, tangent.x);
        const off = Math.abs(Math.atan2(Math.sin(err), Math.cos(err)));
        if (off > 0.8 && !spinning[i]) s.spins++;
        spinning[i] = off > 0.8 ? true : off < 0.3 ? false : spinning[i]!;
        offTime[i] = f.wheelsOff >= 4 ? offTime[i]! + dt : 0;
        // Turn one: lap 1, from the grid to 50 m past the end of the first corners.
        if (s.turnOne === 'pending' && c.strategy.kind === 'race') {
          const sinceGreen = session.time - (c.lightsOutAt ?? 0);
          if (c.timer(i).lap > 1 || (f.s > cornerTo + 50 && f.s < cornerTo + 2000)) {
            s.turnOne = 'clean';
          } else if (st.carContactSpeed > 3) s.turnOne = 'contact';
          else if (off > 0.8) s.turnOne = 'spin';
          else if (offTime[i]! > 0.5) s.turnOne = 'off';
          else if (sinceGreen > 10 && f.speed < 3) s.turnOne = 'stopped';
        }
      }
      const lap = o.pitLap ? o.pitLap(i) : null;
      if (lap !== null && !asked[i] && c.timer(i).lap === lap && c.racing(i)) {
        asked[i] = true;
        session.requestPit(i, [{ kind: 'tyres', compound: 'hard' }]);
      }
    }
  }
  const wall = t0 !== null && o.clock ? (o.clock() - t0) / 1000 : null;
  overlaps.pairs = seenPairs.size;
  overlaps.pairsInFirstCorner = cornerPairs.size;
  return {
    result: session.result(),
    events,
    cars,
    simTime: session.time,
    wallSeconds: wall,
    firstLap,
    overlaps,
  };
}

/** A race of AI cars at Monza. */
export function runRace(o: RaceRunOptions): RaceRun {
  const session = aiSession({ kind: 'race', laps: o.laps }, o);
  const pitLap = o.pitLap === undefined ? defaultPitLap(o.laps) : o.pitLap;
  return runSession(session, {
    pitLap,
    ...(o.maxTime !== undefined ? { maxTime: o.maxTime } : {}),
    ...(o.clock ? { clock: o.clock } : {}),
  });
}

/** Practice, qualifying and the race, the grid from qualifying. */
export function runWeekend(o: RaceRunOptions & { practice?: number | null; qualifying?: number }): {
  weekend: RaceWeekend;
  runs: RaceRun[];
} {
  const weekend = new RaceWeekend(
    {
      circuit: 'monza',
      practice: o.practice ?? null,
      qualifying: o.qualifying ?? 600,
      raceLaps: o.laps,
    },
    o.cars,
  );
  const runs: RaceRun[] = [];
  for (let spec = weekend.next(); spec; spec = weekend.next()) {
    const grid = spec.kind === 'race' ? weekend.grid() : undefined;
    const session = aiSession(spec, { ...o, ...(grid ? { grid } : {}) });
    const pitLap =
      spec.kind === 'race' ? (o.pitLap === undefined ? defaultPitLap(o.laps) : o.pitLap) : null;
    const run = runSession(session, {
      pitLap,
      ...(o.maxTime !== undefined ? { maxTime: o.maxTime } : {}),
      ...(o.clock ? { clock: o.clock } : {}),
    });
    runs.push(run);
    weekend.complete(run.result);
  }
  return { weekend, runs };
}

/** Plain-text classification for the console. */
export function formatResult(run: RaceRun): string {
  const r = run.result;
  const lines: string[] = [];
  const fmt = (t: number | null): string => {
    if (t === null) return '-';
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  };
  lines.push(`${r.kind} at ${r.circuit}, seed ${r.seed}${r.laps ? `, ${r.laps} laps` : ''}`);
  lines.push('Pos  Car  Status         Laps  Time        Gap        Best      Pits  Pen  Grid>L1');
  for (const e of r.entries) {
    const gap =
      e.gap === null
        ? ''
        : 'laps' in e.gap
          ? `+${e.gap.laps} lap${e.gap.laps === 1 ? '' : 's'}`
          : `+${e.gap.time.toFixed(3)}`;
    const summary = run.cars[e.car];
    lines.push(
      [
        String(e.position).padStart(3),
        e.code.padEnd(4),
        (e.status + (e.reason ? ` (${e.reason})` : '')).padEnd(14),
        String(e.laps).padStart(4),
        fmt(e.totalTime).padStart(10),
        gap.padStart(10),
        fmt(e.bestLap).padStart(9),
        String(e.pitStops).padStart(5),
        String(e.penaltyTime).padStart(4),
        `  ${summary?.positionAfterLap1 ?? '-'}`,
      ].join(' '),
    );
  }
  if (r.fastestLap) {
    lines.push(
      `Fastest lap: ${run.result.entries.find((e) => e.car === r.fastestLap!.car)?.code} ${fmt(r.fastestLap.time)} (lap ${r.fastestLap.lap})`,
    );
  }
  return lines.join('\n');
}
