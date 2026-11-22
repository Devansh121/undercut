import { describe, expect, it } from 'vitest';
import { AudioCore, SceneSound, type AudioScene, type OtherCarSound } from '../src';
import { findPeak, magnitudeSpectrum, rmsDbfs } from '../src/analysis';
const car = (z = 0, distance = 10, vx = 0): OtherCarSound => ({
  x: distance,
  z,
  vx,
  vz: 0,
  engineSpeed: (9000 * Math.PI) / 30,
  throttle: 1,
});
const scene = (cars: OtherCarSound[]): AudioScene => ({
  cars,
  circuit: 'forest',
  progress: 0.5,
  lights: -1,
});
function render(state: AudioScene, block = 128) {
  const core = new AudioCore({ sampleRate: 48000 });
  core.setScene(state);
  const output = [new Float32Array(48000), new Float32Array(48000)];
  for (let i = 0; i < 48000; i += block) {
    const n = Math.min(block, 48000 - i);
    core.process(
      output.map((c) => c.subarray(i, i + n)),
      n,
    );
  }
  return output;
}
describe('spatial field', () => {
  it('caps the pool at nineteen and selects the nearest six', () => {
    const sound = new SceneSound(48000);
    sound.set(scene(Array.from({ length: 30 }, (_, i) => car(0, i + 1))));
    expect(sound.audibleCount).toBe(6);
    sound.set(scene([car(0, 251)]));
    expect(sound.audibleCount).toBe(0);
  });
  it('pans towards the source and attenuates with distance', () => {
    const near = render(scene([car(20)]));
    expect(rmsDbfs(near[1]!)).toBeGreaterThan(rmsDbfs(near[0]!) + 8);
    const far = render(scene([car(0, 100)]));
    expect(rmsDbfs(render(scene([car()]))[0]!)).toBeGreaterThan(rmsDbfs(far[0]!) + 20);
  });
  it('bounds Doppler for approach and recession', () => {
    for (const [vx, ratio] of [
      [-150, 1.25],
      [150, 0.8],
    ]) {
      const x = render(scene([car(0, 10, vx)]))[0]!;
      const peak = findPeak(magnitudeSpectrum(x, 30000, 16384, 65536), 48000, 300, 650).frequency;
      expect(Math.abs(peak - 450 * ratio!)).toBeLessThan(1);
    }
  });
  it('renders bit-identically across host blocks, including culled slots', () => {
    const state = scene(Array.from({ length: 19 }, (_, i) => car(i * 4, 10 + i * 8)));
    expect(render(state, 4096)).toEqual(render(state, 127));
  });
  it('changes ambience between stands, forest and city and rejects invalid car data', () => {
    const forest = render(scene([]));
    const stands = render({ ...scene([]), progress: 0 });
    const city = render({ ...scene([]), circuit: 'city' });
    expect(forest).not.toEqual(stands);
    expect(forest).not.toEqual(city);
    const invalid = render(
      scene([{ x: NaN, z: Infinity, vx: NaN, vz: Infinity, engineSpeed: NaN, throttle: Infinity }]),
    );
    expect(invalid.every((c) => c.every(Number.isFinite))).toBe(true);
  });
  it('emits each cue on the UI bus and honours bus muting', () => {
    for (const cue of ['focus', 'accept', 'back', 'light', 'go'] as const) {
      const core = new AudioCore({ sampleRate: 48000 });
      core.cue(cue);
      const out = [new Float32Array(24000), new Float32Array(24000)];
      core.process(out, 24000);
      expect(rmsDbfs(out[0]!)).toBeGreaterThan(-50);
      expect(Math.max(...out[0]!.subarray(20000))).toBeLessThan(1e-4);
    }
  });
});
