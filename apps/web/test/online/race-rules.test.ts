import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, checkSettings, type StartSchedule } from '@undercut/protocol';
import type { AssistConfig } from '../../src/game/assists';
import { enforceAssistPolicy, lapClaim, lightsOn, liveOrder } from '../../src/online/race-rules';

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

describe('liveOrder', () => {
  it('orders finished cars first by finishing order, then by distance run', () => {
    const order = liveOrder(1000, [
      { seat: 0, lap: 1, s: 900, finishedAt: null },
      { seat: 1, lap: 2, s: 100, finishedAt: null },
      { seat: 2, lap: 2, s: 50, finishedAt: 5000 },
      { seat: 3, lap: 2, s: 40, finishedAt: 4000 },
    ]);
    expect(order).toEqual([3, 2, 1, 0]);
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
