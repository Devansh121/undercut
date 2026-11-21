import { defaultCarState, packCarState, CAR_STATE_LENGTH } from '@undercut/audio';
import { CarControls, CHUNK } from '../../../packages/audio/src/dsp/controls';
import { F } from '../../../packages/audio/src/dsp/state';
import { MemoryStorage } from '@undercut/input';
import {
  SurfaceKind,
  createCarParams,
  createCarState,
  createCarTelemetry,
  readCarTelemetry,
} from '@undercut/sim';
import { LEFT, createGround } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { ImpactEvents, KERB_RIDGE_SPACING, toAudioCarState } from '../src/game/audio-map';
import { AUDIO_DEFAULTS, AudioSettingsStore } from '../src/game/audio-settings';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

const params = createCarParams('low');

function carAt(speed: number) {
  const state = createCarState(params, { speed });
  return { state, telemetry: readCarTelemetry(state, createCarTelemetry()) };
}

describe('ImpactEvents', () => {
  it('turns per-frame barrier impact speeds into distinct impact events', () => {
    const e = new ImpactEvents();
    const dt = 1 / 60;
    e.observe(0, dt);
    expect(e.serial).toBe(0);
    // A touch below 0.3 m/s is not an impact.
    e.observe(0.2, dt);
    expect(e.serial).toBe(0);
    e.observe(6, dt);
    expect(e.serial).toBe(1);
    expect(e.speed).toBe(6);
    // Corners following within 80 ms belong to the same impact unless twice as hard.
    e.observe(2, dt);
    expect(e.serial).toBe(1);
    e.observe(13, dt);
    expect(e.serial).toBe(2);
    expect(e.speed).toBe(13);
    for (let i = 0; i < 6; i++) e.observe(0, dt);
    e.observe(3, dt);
    expect(e.serial).toBe(3);
    expect(e.speed).toBe(3);
  });

  it('feeds the audio state through the impact fields', () => {
    const { state, telemetry } = carAt(40);
    const e = new ImpactEvents();
    e.observe(9, 1 / 60);
    const a = toAudioCarState(
      {
        state,
        telemetry,
        pitLimiter: false,
        kerbRoughness: 0,
        impactSpeed: e.speed,
        impactSerial: e.serial,
      },
      defaultCarState(),
    );
    expect(a.impactSpeed).toBe(9);
    expect(a.impactSerial).toBe(1);
  });
});

describe('toAudioCarState', () => {
  it('preserves lock-up sign, DRS and collision event identity', () => {
    const { state, telemetry } = carAt(40);
    telemetry.slipRatio.set([-0.8, -0.2, 0.1, 0.6]);
    telemetry.drs = 1;
    const a = toAudioCarState(
      { state, telemetry, pitLimiter: false, kerbRoughness: 0, impactSerial: 2, impactSpeed: 8 },
      defaultCarState(),
    );
    expect(a.slipRatioFront).toBe(-0.8);
    expect(a.slipRatioRear).toBe(0.6);
    expect(a.drs).toBe(1);
    expect(a.impactSerial).toBe(2);
    expect(a.impactSpeed).toBe(8);
  });

  it('passes high-speed kerb ridge rates through the DSP boundary without clamping', () => {
    for (const speed of [60, 80, 150]) {
      const { state, telemetry } = carAt(speed);
      const mapped = toAudioCarState(
        { state, telemetry, pitLimiter: false, kerbRoughness: 1 },
        defaultCarState(),
      );
      const expected = speed / KERB_RIDGE_SPACING;
      expect(mapped.kerbFrequency).toBe(expected);
      for (const input of [mapped, packCarState(mapped, new Float64Array(CAR_STATE_LENGTH))]) {
        const controls = new CarControls(48000);
        controls.set(input);
        controls.advance(CHUNK);
        expect(controls.targetOf(F.kerbFrequency)).toBe(expected);
        expect(controls.buffers[F.kerbFrequency]?.[CHUNK - 1]).toBe(expected);
      }
    }
  });

  it('maps the sim to the audio engine in SI units', () => {
    const { state, telemetry } = carAt(60);
    state.engineSpeed = 1000;
    state.throttleApplied = 0.7;
    state.mgukPower = 120e3;
    readCarTelemetry(state, telemetry);
    const a = toAudioCarState(
      { state, telemetry, pitLimiter: false, kerbRoughness: 0 },
      defaultCarState(),
    );
    expect(a.engineOn).toBe(true);
    expect(a.engineSpeed).toBe(1000);
    expect(a.throttle).toBeCloseTo(0.7, 9);
    expect(a.load).toBeCloseTo(0.7, 9);
    expect(a.speed).toBeCloseTo(60, 9);
    expect(a.ersPower).toBe(120e3);
    expect(a.gear).toBe(state.gear);
    expect(a.shifting).toBe(false);
    expect(a.revLimiter).toBe(false);
    expect(a.kerb).toBe(0);
    expect(a.bottoming).toBe(0);
    expect(a.boost).toBeGreaterThan(0);
    expect(a.boost).toBeLessThanOrEqual(1);
  });

  it('flags shift direction while a shift is in progress', () => {
    const { state, telemetry } = carAt(40);
    state.shiftTimer = 0.02;
    state.shiftTarget = state.gear + 1;
    readCarTelemetry(state, telemetry);
    const up = toAudioCarState(
      { state, telemetry, pitLimiter: false, kerbRoughness: 0 },
      defaultCarState(),
    );
    expect(up.shifting).toBe(true);
    expect(up.shiftDirection).toBe(1);
    state.shiftTarget = state.gear - 1;
    const down = toAudioCarState(
      { state, telemetry, pitLimiter: false, kerbRoughness: 0 },
      defaultCarState(),
    );
    expect(down.shiftDirection).toBe(-1);
  });

  it('reports the rev limiter at the limit under throttle, and the pit limiter', () => {
    const { state, telemetry } = carAt(40);
    state.engineSpeed = (params.engine.revLimit * 2 * Math.PI) / 60;
    state.throttleApplied = 1;
    readCarTelemetry(state, telemetry);
    const a = toAudioCarState(
      { state, telemetry, pitLimiter: true, kerbRoughness: 0 },
      defaultCarState(),
    );
    expect(a.revLimiter).toBe(true);
    expect(a.pitLimiter).toBe(true);
  });

  it('gives per-axle combined slip, kerb rumble from roughness, and bottoming', () => {
    const { state, telemetry } = carAt(50);
    state.slipRatio.set([0.05, 0.02, 0.15, 0.1]);
    state.slipTan.set([0.1, 0, 0, 0]);
    state.rideHeightFront = -0.004;
    readCarTelemetry(state, telemetry);
    const a = toAudioCarState(
      { state, telemetry, pitLimiter: false, kerbRoughness: 0.5 },
      defaultCarState(),
    );
    expect(a.slipFront).toBeCloseTo(Math.hypot(0.05, Math.atan(0.1)), 6);
    expect(a.slipRear).toBeCloseTo(0.15, 6);
    expect(a.kerb).toBe(0.5);
    expect(a.kerbFrequency).toBeCloseTo(50 / KERB_RIDGE_SPACING, 6);
    expect(a.bottoming).toBeGreaterThan(0.5);
  });
});

describe('DriveSession kerb roughness under the wheels', () => {
  const track = loadMonza();
  it('is zero on the centreline and positive with wheels on a kerb', () => {
    const session = new DriveSession({ track, seed: 1 });
    session.teleport(300, 0, 0);
    expect(session.kerbUnderWheels()).toBe(0);
    // Find a kerb on the left and put the left wheels on it.
    const g = createGround();
    for (let s = 560; s < 5700; s += 2) {
      const hw = track.halfWidthAt(s, LEFT);
      if (track.ground(s, hw + 0.3, g).kind === SurfaceKind.Kerb) {
        session.teleport(s, hw + 0.3 - 0.81, 0);
        break;
      }
    }
    expect(session.kerbUnderWheels()).toBeGreaterThan(0);
    expect(session.kerbUnderWheels()).toBeLessThanOrEqual(1);
  });
});

describe('AudioSettingsStore', () => {
  it('starts from the defaults and persists changes', async () => {
    const port = new MemoryStorage();
    const store = new AudioSettingsStore(port);
    expect(await store.load()).toEqual(AUDIO_DEFAULTS);
    await store.set('engine', 0.4);
    expect(await new AudioSettingsStore(port).load()).toEqual({ ...AUDIO_DEFAULTS, engine: 0.4 });
  });

  it('clamps values and ignores damaged data', async () => {
    const port = new MemoryStorage();
    await port.save('settings.audio', JSON.stringify({ master: 7, engine: -1, effects: 'loud' }));
    expect(await new AudioSettingsStore(port).load()).toEqual({
      master: 1,
      engine: 0,
      effects: AUDIO_DEFAULTS.effects,
      ui: AUDIO_DEFAULTS.ui,
      ambience: AUDIO_DEFAULTS.ambience,
    });
    await port.save('settings.audio', '{nope');
    expect(await new AudioSettingsStore(port).load()).toEqual(AUDIO_DEFAULTS);
  });

  it('keeps working when storage rejects', async () => {
    const store = new AudioSettingsStore({
      load: () => Promise.reject(new Error('blocked')),
      save: () => Promise.reject(new Error('blocked')),
    });
    expect(await store.load()).toEqual(AUDIO_DEFAULTS);
    await expect(store.set('master', 0.5)).resolves.toBeUndefined();
    expect(store.current.master).toBe(0.5);
  });
});
