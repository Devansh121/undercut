import type { Quality } from '../quality';

/**
 * Bloom runs on the HDR scene before exposure, so its threshold is in scene-linear radiance (the
 * sky's units): the same things bloom in a bright afternoon and at night. `exposure` is accepted
 * only to make that independence explicit and tested.
 */
export function bloomThreshold(quality: Quality, _exposure: number): number {
  return quality.bloom.threshold;
}

/** Whether a scene-linear luminance is above the bloom threshold. */
export function blooms(luminance: number, quality: Quality, exposure: number): boolean {
  return quality.bloom.enabled && luminance > bloomThreshold(quality, exposure);
}
