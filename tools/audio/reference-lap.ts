/** Real reference-driver telemetry, captured at the sim's 240 Hz through the game's adapter. */
import { defaultCarState, type AudioCarState } from '@undercut/audio';
import { TrackSurface } from '@undercut/track';
import { MONZA, referenceLap, STEP } from '../../packages/ai/validation/lib/index';
import { toAudioCarState } from '../../apps/web/src/game/audio-map';
import type { Scenario } from './scenarios';

export function captureReferenceLap(): {
  scenario: Scenario;
  states: AudioCarState[];
  lapTime: number;
} {
  const states: AudioCarState[] = [];
  const surface = new TrackSurface(MONZA.track());
  const { result } = referenceLap(MONZA, {
    onSample(car, telemetry) {
      states.push({
        ...toAudioCarState(
          { state: car.state, telemetry, pitLimiter: false, kerbRoughness: 0, surface },
          defaultCarState(),
        ),
      });
    },
  });
  const lap = result.laps[0];
  if (result.spun || !lap || states.length < 1000)
    throw new Error('Reference driver failed to complete a lap');
  return {
    lapTime: lap.time,
    states,
    scenario: {
      name: 'reference-lap',
      title: 'Reference driver, complete flying lap',
      listen:
        'Compare onboard intake and transmission against the external exhaust balance. Trackside is a stationary balance preset; spatial pass-bys follow in slice 2.',
      duration: states.length * STEP,
      create() {
        let t = 0;
        return (dt) => {
          const index = Math.min(states.length - 1, Math.round(t / STEP));
          t += dt;
          return states[index]!;
        };
      },
    },
  };
}
