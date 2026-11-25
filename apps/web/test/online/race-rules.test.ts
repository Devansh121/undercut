import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, checkSettings, type StartSchedule } from '@undercut/protocol';
import type { AssistConfig } from '../../src/game/assists';
import {
  enforceAssistPolicy,
  lapClaim,
  lightsOn,
  liveOrder,
  localProgress,
  onlineDriverName,
  onlineLapTime,
  remoteProgress,
} from '../../src/online/race-rules';

const START: StartSchedule = {
  lightsStartAt: 10_000,
  lightIntervalMs: 1000,
  lightCount: 5,
  lightsOutAt: 15_700,
};

describe('lightsOn', () => {
  it('counts the lights up a second apart, holds, then all out at lights out', () => {
    expect(lightsOn(START, 9_999)).toBe(0);
    expect(lightsOn(START, 10_000)).toBe(1);
    expect(lightsOn(START, 12_500)).toBe(3);
    expect(lightsOn(START, 14_000)).toBe(5);
    expect(lightsOn(START, 15_699)).toBe(5);
    expect(lightsOn(START, 15_700)).toBe(0);
  });
});

describe('lapClaim', () => {
  const base = {
    seat: 2,
    lap: 1,
    crossTime: 70.25,
    simTime: 70.5,
    serverNow: 15_700 + 70_000,
    lightsOutAt: 15_700,
    lastRaceMs: 0,
    tick: 16_920,
    s: 12.5,
    speed: 80,
  };

  it('times the crossing on the server clock, from lights out', () => {
    const c = lapClaim(base);
    expect(c).not.toBeNull();
    // The crossing was 250 ms of sim time before the frame's server time.
    expect(c?.at).toBe(15_700 + 70_000 - 250);
    expect(c?.raceMs).toBe(69_750);
    expect(c?.lapMs).toBe(69_750);
    expect(c?.lap).toBe(1);
    expect(c?.seat).toBe(2);
  });

  it('makes the lap time exactly the race time difference', () => {
    const c = lapClaim({ ...base, lap: 2, lastRaceMs: 40_123 });
    expect(c?.lapMs).toBe((c?.raceMs ?? 0) - 40_123);
  });

  it('claims nothing for a crossing at or before lights out', () => {
    expect(lapClaim({ ...base, serverNow: 15_700, crossTime: 70.5 })).toBeNull();
    expect(lapClaim({ ...base, lastRaceMs: 69_750 })).toBeNull();
  });
});

describe('liveOrder and continuous progress', () => {
  it('orders finished cars first by finishing order, then by distance run', () => {
    const order = liveOrder(1000, [
      { seat: 0, lap: 1, s: 900, finishedAt: null },
      { seat: 1, lap: 2, s: 100, finishedAt: null },
      { seat: 2, lap: 2, s: 50, finishedAt: 5000 },
      { seat: 3, lap: 2, s: 40, finishedAt: 4000 },
    ]);
    expect(order).toEqual([3, 2, 1, 0]);
  });

  it('keeps grid slots starting behind the timing line behind pole', () => {
    // Spa: length 7004 m, timing line 128.6 m before s = 0. P1 starts at lineS = 128.6;
    // P18 starts 144 m behind P1 (behind the timing line, lineS = 6988.6).
    const p1 = localProgress(7004, 0, 128.6, false);
    const p18 = localProgress(7004, 0, 6988.6, true);
    expect(p1).toBeCloseTo(128.6, 5);
    expect(p18).toBeCloseTo(-15.4, 5);
    expect(
      liveOrder(7004, [
        { seat: 17, lap: 0, s: 6988.6, progress: p18, finishedAt: null },
        { seat: 0, lap: 0, s: 128.6, progress: p1, finishedAt: null },
      ]),
    ).toEqual([0, 17]);
  });

  it('anchors remote drawn-pose projection continuously across timing-line wraps', () => {
    const L = 5793;
    // Extrapolated 20 m forward across the timing line (snap was 8 m before, drawn is 12 m after).
    expect(remoteProgress(L, 0, 5785, 12, false)).toBeCloseTo(5805, 5);
    // Smoothed 8 m backward across the timing line (snap is lap 1 + 5 m, drawn is 5790 m).
    expect(remoteProgress(L, 1, 5, 5790, false)).toBeCloseTo(5790, 5);
    // Remote car extrapolated 25 m ahead of local car ranks ahead of local car.
    const hostProg = localProgress(L, 0, 500, false);
    const guestProg = remoteProgress(L, 0, 500, 525, false);
    expect(
      liveOrder(L, [
        { seat: 0, lap: 0, s: 500, progress: hostProg, finishedAt: null },
        { seat: 1, lap: 0, s: 525, progress: guestProg, finishedAt: null },
      ]),
    ).toEqual([1, 0]);
  });

  it('formats human member names and AI labels cleanly', () => {
    expect(onlineDriverName('Host', null, 0)).toBe('Host');
    expect(onlineDriverName(null, 0, 3)).toBe('AI 1');
    expect(onlineDriverName(null, 17, 19)).toBe('AI 18');
    expect(onlineDriverName('', null, 2)).toBe('AI 3');
  });
});

describe('room assist policy', () => {
  const everything = (): AssistConfig => ({
    tractionControl: 2,
    abs: 2,
    autoGears: true,
    steering: 2,
    stability: 1,
    braking: 1,
  });
  /** A stand-in for the session: its assists and the pause menu's setter. */
  function fakeSession(start: AssistConfig) {
    const s = {
      assists: { ...start },
      setAssist<K extends keyof AssistConfig>(key: K, value: AssistConfig[K]) {
        s.assists = { ...s.assists, [key]: value };
      },
    };
    return s;
  }

  it('switches off every assist the room does not allow, the stability and braking help too', () => {
    const s = fakeSession(everything());
    enforceAssistPolicy(
      {
        abs: false,
        tractionControl: false,
        autoGears: false,
        racingLine: false,
        steeringAssist: false,
        stability: false,
        brakingHelp: false,
      },
      s,
    );
    expect(s.assists).toMatchObject({
      abs: 0,
      tractionControl: 0,
      autoGears: false,
      steering: 0,
      stability: 0,
      braking: 0,
    });
  });

  it('leaves allowed assists as the player set them', () => {
    const s = fakeSession(everything());
    enforceAssistPolicy({ ...DEFAULT_SETTINGS.assists }, s);
    expect(s.assists).toEqual(everything());
  });

  it('treats a policy from an older host without the new fields as allowing them', () => {
    const s = fakeSession(everything());
    enforceAssistPolicy(
      { abs: true, tractionControl: true, autoGears: true, racingLine: true, steeringAssist: true },
      s,
    );
    expect(s.assists.stability).toBe(1);
    expect(s.assists.braking).toBe(1);
  });

  it('allows both new assists by default and validates them on the wire', () => {
    expect(DEFAULT_SETTINGS.assists.stability).toBe(true);
    expect(DEFAULT_SETTINGS.assists.brakingHelp).toBe(true);
    const ok = checkSettings({
      ...DEFAULT_SETTINGS,
      assists: { ...DEFAULT_SETTINGS.assists, stability: false, brakingHelp: false },
    });
    expect(ok.ok).toBe(true);
    const bad = checkSettings({
      ...DEFAULT_SETTINGS,
      assists: { ...DEFAULT_SETTINGS.assists, brakingHelp: 'yes' },
    });
    expect(bad.ok).toBe(false);
  });
});

describe('online lap clock', () => {
  it('uses the server race clock, including time discarded by a clamped render stall', () => {
    expect(onlineLapTime(14000, 10000, 0)).toBe(4);
    expect(onlineLapTime(16000, 10000, 0)).toBe(6);
    expect(onlineLapTime(16000, 10000, 4500)).toBe(1.5);
  });
  it('stays zero before release or before the clock is available', () => {
    expect(onlineLapTime(9000, 10000, 0)).toBe(0);
    expect(onlineLapTime(null, 10000, 0)).toBe(0);
    expect(onlineLapTime(9000, null, 0)).toBe(0);
  });
});
