import { describe, expect, it } from 'vitest';
import { measure, type Measurement } from './measure';
import { renderScenario, SCENARIOS } from './scenarios';

/**
 * Objective checks on every scripted manoeuvre, rendered the way the offline renderer does
 * (48 kHz, 120 Hz state updates, 128-frame blocks). Thresholds and why, in docs/audio.md.
 */
const LOUDNESS_WINDOW = [-28, -14] as const; // LUFS, BS.1770 integrated
const DRIVING_SPREAD = 8; // LU between the loudest and quietest scenario with the car moving

const results = new Map<string, Measurement>();
function result(name: string): Measurement {
  let m = results.get(name);
  if (!m) {
    const scenario = SCENARIOS.find((s) => s.name === name);
    if (!scenario) throw new Error(name);
    m = measure(renderScenario(scenario));
    results.set(name, m);
  }
  return m;
}

describe('scenarios', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: no clipping, true peak under 0 dBTP, DC near zero`, () => {
      const m = result(scenario.name);
      expect(m.samplePeakDbfs).toBeLessThan(0);
      expect(m.truePeakDbtp).toBeLessThan(0);
      expect(Math.abs(m.dcOffset)).toBeLessThan(1e-3);
    });

    it(`${scenario.name}: integrated loudness inside ${LOUDNESS_WINDOW[0]}..${LOUDNESS_WINDOW[1]} LUFS`, () => {
      const m = result(scenario.name);
      expect(m.loudnessLufs).toBeGreaterThanOrEqual(LOUDNESS_WINDOW[0]);
      expect(m.loudnessLufs).toBeLessThanOrEqual(LOUDNESS_WINDOW[1]);
    });

    it(`${scenario.name}: firing frequency tracks rpm/20`, () => {
      const t = result(scenario.name).tracking;
      expect(t.windows).toBeGreaterThan(10);
      expect(t.medianErrorPct).toBeLessThan(0.25);
      expect(t.maxErrorPct).toBeLessThan(1);
    });
  }

  it(`scenarios with the car moving sit within ${DRIVING_SPREAD} LU of each other`, () => {
    const driving = SCENARIOS.filter((s) => s.name !== 'idle' && s.name !== 'rev-sweep');
    const levels = driving.map((s) => result(s.name).loudnessLufs);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(DRIVING_SPREAD);
  });

  it('idle is quieter than full throttle', () => {
    expect(result('idle').loudnessLufs).toBeLessThan(result('full-throttle').loudnessLufs - 6);
  });
});
