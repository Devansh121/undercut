import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIMINGS,
  applySettingsPatch,
  checkSettings,
  circuitLimits,
  parseTimings,
} from '../src/index';

describe('settings', () => {
  it('defaults are valid and equal cars is on', () => {
    expect(checkSettings(DEFAULT_SETTINGS).ok).toBe(true);
    expect(DEFAULT_SETTINGS.equalCars).toBe(true);
  });

  it('derives circuit limits from length and sectors at a 95 m/s mean speed', () => {
    const c = circuitLimits('loop', 950, [0, 380, 570]);
    expect(c).toEqual({
      id: 'loop',
      lengthM: 950,
      minLapMs: 10_000,
      minSectorMs: [4000, 2000, 4000],
      maxLapMs: 300_000,
    });
    expect(circuitLimits('loop', 950, [0]).minSectorMs).toEqual([]);
  });

  it('rejects a patch that makes the settings inconsistent', () => {
    const circuit = { ...DEFAULT_SETTINGS.circuit, maxLapMs: DEFAULT_SETTINGS.circuit.minLapMs };
    expect(applySettingsPatch(DEFAULT_SETTINGS, { circuit }).ok).toBe(false);
    const sectors = { ...DEFAULT_SETTINGS.circuit, minSectorMs: [999_999] };
    expect(applySettingsPatch(DEFAULT_SETTINGS, { circuit: sectors }).ok).toBe(false);
    expect(applySettingsPatch(DEFAULT_SETTINGS, { laps: 10 })).toEqual({
      ok: true,
      value: { ...DEFAULT_SETTINGS, laps: 10 },
    });
  });

  it('checkSettings needs every field', () => {
    const { laps: _laps, ...rest } = DEFAULT_SETTINGS;
    expect(checkSettings(rest).ok).toBe(false);
  });
});

describe('parseTimings', () => {
  it('uses the defaults when nothing is set', () => {
    expect(parseTimings(undefined)).toEqual({ ok: true, value: DEFAULT_TIMINGS });
    expect(parseTimings('')).toEqual({ ok: true, value: DEFAULT_TIMINGS });
  });

  it('applies overrides and rejects nonsense', () => {
    expect(parseTimings('{"graceMs":5000}')).toEqual({
      ok: true,
      value: { ...DEFAULT_TIMINGS, graceMs: 5000 },
    });
    for (const raw of [
      '{',
      '[]',
      '{"graceMs":-1}',
      '{"nope":1}',
      '{"holdMinMs":5000,"holdMaxMs":10}',
      42,
    ]) {
      expect(parseTimings(raw).ok).toBe(false);
    }
  });
});
