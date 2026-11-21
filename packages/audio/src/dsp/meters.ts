/** Layers the core meters, so tests and tools can check that each one is present or absent. */
export const LAYERS = [
  'exhaust',
  'intake',
  'combustion',
  'turbo',
  'ers',
  'crackle',
  'shift',
  'roll',
  'wind',
  'scrub',
  'squeal',
  'kerb',
  'scrape',
] as const;

export type LayerName = (typeof LAYERS)[number];

/** Index of each layer in `LayerMeters.sumSquares` (matches LAYERS; a test checks). */
export const L = {
  exhaust: 0,
  intake: 1,
  combustion: 2,
  turbo: 3,
  ers: 4,
  crackle: 5,
  shift: 6,
  roll: 7,
  wind: 8,
  scrub: 9,
  squeal: 10,
  kerb: 11,
  scrape: 12,
} as const satisfies { readonly [K in LayerName]: number };

/** Running sum of squares per layer, before bus gains. Allocation-free. */
export class LayerMeters {
  readonly sumSquares = new Float64Array(LAYERS.length);
  frames = 0;

  /** RMS of a layer since the last reset (linear, full scale = 1). */
  rms(layer: LayerName): number {
    return this.frames > 0
      ? Math.sqrt((this.sumSquares[LAYERS.indexOf(layer)] as number) / this.frames)
      : 0;
  }

  reset(): void {
    this.sumSquares.fill(0);
    this.frames = 0;
  }
}
