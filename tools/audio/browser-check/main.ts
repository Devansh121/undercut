/**
 * Runs in Chromium under `npm run audio:browser-check`: the bundled worklet renders the core
 * in an OfflineAudioContext, and the facade starts, suspends, resumes and disposes a live one.
 */
import {
  CAR_STATE_LENGTH,
  defaultCarState,
  packCarState,
  rpmToRadPerSecond,
} from '@undercut/audio';
import { findPeak, magnitudeSpectrum } from '@undercut/audio/analysis';
import { createAudioEngine } from '@undercut/audio/web';
import { WORKLET_URL } from '../../../packages/audio/src/web/worklet-url';

const RPM = 9000;

async function offline() {
  const sampleRate = 48_000;
  const ctx = new OfflineAudioContext(2, sampleRate * 2, sampleRate);
  await ctx.audioWorklet.addModule(WORKLET_URL);
  const node = new AudioWorkletNode(ctx, 'undercut-car-audio', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { seed: 1 },
  });
  node.connect(ctx.destination);
  const state = {
    ...defaultCarState(),
    engineOn: true,
    engineSpeed: rpmToRadPerSecond(RPM),
    throttle: 1,
    load: 1,
  };
  // Messages reach the audio thread asynchronously; deliver the state at a suspend point.
  void ctx.suspend(0.1).then(async () => {
    node.port.postMessage({
      type: 'state',
      packed: packCarState(state, new Float64Array(CAR_STATE_LENGTH)),
    });
    await new Promise((r) => setTimeout(r, 200));
    await ctx.resume();
  });
  const buffer = await ctx.startRendering();
  const x = buffer.getChannelData(0);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const mags = magnitudeSpectrum(x, x.length - 16_384, 16_384, 65_536);
  const expected = RPM / 20;
  const firing = findPeak(mags, sampleRate, expected * 0.92, expected * 1.08).frequency;
  return { workletUrl: WORKLET_URL, peak, firingHz: firing, expectedHz: expected };
}

async function live() {
  const engine = createAudioEngine();
  engine.setCarState({
    ...defaultCarState(),
    engineOn: true,
    engineSpeed: rpmToRadPerSecond(7000),
  });
  const statuses: string[] = [engine.status];
  await engine.resume();
  statuses.push(engine.status);
  await engine.suspend();
  statuses.push(engine.status);
  await engine.resume();
  statuses.push(engine.status);
  await engine.dispose();
  statuses.push(engine.status);
  return { statuses };
}

(window as unknown as { result: Promise<unknown> }).result = (async () => ({
  offline: await offline(),
  live: await live(),
}))().catch((error: unknown) => ({ error: String(error) }));
