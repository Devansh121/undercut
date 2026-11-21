/**
 * Small rules of an online race as the local game applies them: the start lights from the
 * server's schedule, a lap claim timed on the server clock, and a live running order. Pure.
 */
import type { Assists, LapMessage, StartSchedule } from '@undercut/protocol';
import type { AssistConfig } from '../game/assists';

/** Lights showing at server time `now`: 0 before the first and from lights out. */
export function lightsOn(s: StartSchedule, now: number): number {
  if (now < s.lightsStartAt || now >= s.lightsOutAt) return 0;
  return Math.min(s.lightCount, Math.floor((now - s.lightsStartAt) / s.lightIntervalMs) + 1);
}

export interface ClaimInput {
  seat: number;
  /** The lap just completed. */
  lap: number;
  /** Sim time of the crossing and of the frame's sim state, s. */
  crossTime: number;
  simTime: number;
  /** Estimated server time of the frame's sim state, ms. */
  serverNow: number;
  lightsOutAt: number;
  /** Race time of the previous counted crossing, ms (0 at the start). */
  lastRaceMs: number;
  tick: number;
  /** Distance past the line and speed at the claim, m and m/s (evidence). */
  s: number;
  speed: number;
}

/**
 * A line crossing as the rooms service wants it (docs/netcode.md, Timing plausibility): `at` is
 * the server time of the crossing, `raceMs` runs from the server's lights out, and the lap time is
 * exactly the difference of race times so the two always agree. Null when the crossing cannot be
 * a lap (not after lights out, or not after the last one).
 */
export function lapClaim(c: ClaimInput): Omit<LapMessage, 'type'> | null {
  const at = Math.round(c.serverNow - Math.max(0, c.simTime - c.crossTime) * 1000);
  const raceMs = at - c.lightsOutAt;
  const lapMs = raceMs - c.lastRaceMs;
  if (raceMs < 1 || lapMs < 1) return null;
  return {
    seat: c.seat,
    lap: c.lap,
    lapMs,
    raceMs,
    tick: c.tick,
    s: Math.max(0, c.s),
    speed: Math.max(0, Math.min(999, c.speed)),
    at,
  };
}

export interface Runner {
  seat: number;
  lap: number;
  s: number;
  /** Server time it took the flag, or null while running. */
  finishedAt: number | null;
}

/** Seats in running order: finishers by when they finished, then by distance run. */
export function liveOrder(lapLength: number, cars: readonly Runner[]): number[] {
  return [...cars]
    .sort((a, b) => {
      if (a.finishedAt !== null || b.finishedAt !== null) {
        if (a.finishedAt === null) return 1;
        if (b.finishedAt === null) return -1;
        return a.finishedAt - b.finishedAt;
      }
      return b.lap * lapLength + b.s - (a.lap * lapLength + a.s);
    })
    .map((c) => c.seat);
}

/** The session as the room's assist policy sees it: the assists in use and the setter. */
export interface AssistHolder {
  readonly assists: Readonly<AssistConfig>;
  setAssist<K extends keyof AssistConfig>(key: K, value: AssistConfig[K]): void;
}

/**
 * Switch off every assist the room does not allow. A policy without the stability or braking
 * help fields (a host from before they existed) allows them.
 */
export function enforceAssistPolicy(policy: Assists, session: AssistHolder): void {
  const a = session.assists;
  if (!policy.abs && a.abs) session.setAssist('abs', 0);
  if (!policy.tractionControl && a.tractionControl) session.setAssist('tractionControl', 0);
  if (!policy.autoGears && a.autoGears) session.setAssist('autoGears', false);
  if (!policy.steeringAssist && a.steering) session.setAssist('steering', 0);
  if (policy.stability === false && a.stability) session.setAssist('stability', 0);
  if (policy.brakingHelp === false && a.braking) session.setAssist('braking', 0);
}
