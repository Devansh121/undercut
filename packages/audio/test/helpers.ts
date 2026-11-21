import { AudioCore, defaultCarState, rpmToRadPerSecond, type AudioCarState } from '../src/index';

export const FS = 48_000;

/** A running engine at a fixed rpm and load, everything else quiet. */
export function engineState(
  rpm: number,
  load: number,
  extra: Partial<AudioCarState> = {},
): AudioCarState {
  return {
    ...defaultCarState(),
    engineOn: true,
    engineSpeed: rpmToRadPerSecond(rpm),
    throttle: load,
    load,
    ...extra,
  };
}

export interface Clip {
  left: Float32Array;
  right: Float32Array;
}

/**
 * Render `seconds` with `state(t)` applied every `1/updateRate` s, in blocks of `block`
 * frames that never straddle an update (as the worklet and the offline renderer do).
 */
export function render(
  core: AudioCore,
  seconds: number,
  state: (t: number) => AudioCarState | undefined,
  options: { updateRate?: number; block?: number; startFrame?: number } = {},
): Clip {
  const total = Math.round(seconds * FS);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const per = FS / (options.updateRate ?? 120);
  let next = 0;
  let updates = 0;
  let frame = 0;
  const block = options.block ?? 128;
  while (frame < total) {
    if (frame >= next) {
      const s = state(frame / FS);
      if (s) core.setCarState(s);
      updates++;
      next = Math.round(updates * per);
    }
    const n = Math.min(block, total - frame, next - frame);
    core.process([left.subarray(frame, frame + n), right.subarray(frame, frame + n)], n);
    frame += n;
  }
  return { left, right };
}

/** Render a steady state and return the clip. */
export function steady(
  state: AudioCarState,
  seconds: number,
  seed = 1,
): { core: AudioCore; clip: Clip } {
  const core = new AudioCore({ sampleRate: FS, seed });
  const clip = render(core, seconds, () => state);
  return { core, clip };
}

/** Bit-for-bit equality of two sample buffers. */
export function identical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
