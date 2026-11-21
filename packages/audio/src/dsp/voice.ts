import type { CarControls } from './controls';
import type { LayerMeters } from './meters';

/** Buses a voice can feed. Each has its own gain under the master gain. */
export type BusId = 'engine' | 'effects' | 'ui';

/** Gains the player can set: one per bus plus the master. */
export type GainId = 'master' | BusId;

/**
 * A sound source driven by one car's control signals. The core renders each voice into a
 * mono scratch buffer and mixes it into its bus with the car's pan gains. Other cars, with
 * distance, pan and Doppler, are added later as more voices on the same buses.
 */
export interface Voice {
  readonly bus: BusId;
  /**
   * Write (not add) `frames` mono samples into `out`. `aligned` is true when this chunk starts
   * on a control-rate boundary of the core's sample clock; control-rate work (filter
   * coefficient updates, waking or sleeping optional layers) happens only then, so output
   * does not depend on how the host splits its blocks.
   */
  render(
    controls: CarControls,
    out: Float64Array,
    frames: number,
    meters: LayerMeters,
    aligned: boolean,
  ): void;
}
