/**
 * Spectrogram PNG for reviewers: log frequency 40 Hz – 16 kHz, time across, 80 dB range,
 * with the commanded firing frequency (rpm/20) drawn as a dashed line so the harmonic ladder
 * can be checked against it by eye.
 */
import { magnitudeSpectrum } from '@undercut/audio/analysis';
import { drawText, textWidth } from './font';
import { encodeIndexedPng } from './png';
import type { Rendered, TracePoint } from './scenarios';

const PLOT_W = 1200;
const PLOT_H = 440;
const LEFT = 64;
const RIGHT = 16;
const TOP = 34;
const BOTTOM = 34;
const F_MIN = 40;
const F_MAX = 16_000;
const RANGE_DB = 80;
const FFT = 4096;

type Rgb = readonly [number, number, number];
/** Palette: entries 0..LEVELS-1 are the colour map (1.25 dB steps), then the fixed colours. */
const LEVELS = 64;
const BACKGROUND = LEVELS;
const TEXT = LEVELS + 1;
const GRID = LEVELS + 2;
const MARK = LEVELS + 3;
const FIXED: readonly Rgb[] = [
  [16, 18, 20],
  [200, 204, 208],
  [90, 96, 102],
  [60, 255, 120],
];

/** Dark-to-bright map (black, indigo, crimson, orange, pale yellow), perceptually ordered. */
const STOPS: readonly [number, Rgb][] = [
  [0, [0, 0, 4]],
  [0.25, [60, 15, 110]],
  [0.5, [175, 45, 80]],
  [0.75, [245, 125, 25]],
  [1, [252, 250, 190]],
];

function colourAt(t: number): Rgb {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i] as [number, Rgb];
    const [p0, c0] = STOPS[i - 1] as [number, Rgb];
    if (x <= p1) {
      const u = (x - p0) / (p1 - p0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ];
    }
  }
  return STOPS[STOPS.length - 1]?.[1] ?? [255, 255, 255];
}

function yOf(f: number): number {
  return PLOT_H * (1 - Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN));
}

export function spectrogramPng(r: Rendered, title: string): Uint8Array {
  const width = LEFT + PLOT_W + RIGHT;
  const height = TOP + PLOT_H + BOTTOM;
  const pixels = new Uint8Array(width * height).fill(BACKGROUND);
  const put = (x: number, y: number, c: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    pixels[y * width + x] = c;
  };

  const n = r.left.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * ((r.left[i] as number) + (r.right[i] as number));
  const binHz = r.sampleRate / FFT;
  const columns: Float64Array[] = [];
  let top = -Infinity;
  for (let x = 0; x < PLOT_W; x++) {
    const centre = Math.round(((x + 0.5) / PLOT_W) * n);
    const start = Math.max(0, Math.min(n - FFT, centre - FFT / 2));
    const mags = magnitudeSpectrum(mono, start, FFT, FFT);
    const db = new Float64Array(mags.length);
    for (let k = 0; k < mags.length; k++) {
      const v = 20 * Math.log10((mags[k] as number) + 1e-12);
      db[k] = v;
      if (v > top) top = v;
    }
    columns.push(db);
  }
  for (let x = 0; x < PLOT_W; x++) {
    const db = columns[x] as Float64Array;
    for (let y = 0; y < PLOT_H; y++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, 1 - (y + 0.5) / PLOT_H);
      const pos = f / binHz;
      const k = Math.floor(pos);
      const u = pos - k;
      const v = (db[k] as number) * (1 - u) + (db[k + 1] as number) * u;
      const t = Math.max(0, Math.min(1, (v - (top - RANGE_DB)) / RANGE_DB));
      put(LEFT + x, TOP + y, Math.round(t * (LEVELS - 1)));
    }
  }

  // Commanded firing frequency, dashed.
  const traceAt = (frame: number): TracePoint | undefined => {
    let found: TracePoint | undefined;
    for (const p of r.trace) {
      if (p.frame > frame) break;
      found = p;
    }
    return found;
  };
  for (let x = 0; x < PLOT_W; x++) {
    if (x % 8 >= 3) continue;
    const p = traceAt(Math.round(((x + 0.5) / PLOT_W) * n));
    if (!p || !p.engineOn || p.rpm < 1000) continue;
    const y = Math.round(yOf(p.rpm / 20));
    if (y >= 0 && y < PLOT_H) put(LEFT + x, TOP + y, MARK);
  }

  // Frequency axis.
  for (const [f, label] of [
    [50, '50'],
    [100, '100'],
    [200, '200'],
    [500, '500'],
    [1000, '1K'],
    [2000, '2K'],
    [5000, '5K'],
    [10_000, '10K'],
  ] as const) {
    const y = TOP + Math.round(yOf(f));
    for (let x = LEFT - 6; x < LEFT; x++) put(x, y, GRID);
    drawText(pixels, width, height, LEFT - 10 - textWidth(label, 2), y - 5, label, TEXT);
  }
  drawText(pixels, width, height, 6, TOP - 4, 'HZ', TEXT);

  // Time axis.
  const seconds = n / r.sampleRate;
  const tick = Math.max(1, 5 * Math.ceil(seconds / 100));
  for (let s = 0; s <= Math.floor(seconds); s += tick) {
    const x = LEFT + Math.round((s / seconds) * PLOT_W);
    for (let y = TOP + PLOT_H; y < TOP + PLOT_H + 6; y++) put(x, y, GRID);
    drawText(
      pixels,
      width,
      height,
      x - textWidth(String(s), 2) / 2,
      TOP + PLOT_H + 10,
      String(s),
      TEXT,
    );
  }
  drawText(pixels, width, height, LEFT + PLOT_W - textWidth('S', 2), TOP + PLOT_H + 22, 'S', TEXT);

  drawText(pixels, width, height, LEFT, 10, title, TEXT);
  const key = 'DASHED: RPM/20 (FIRING FREQUENCY)   80 DB RANGE';
  drawText(pixels, width, height, LEFT + PLOT_W - textWidth(key, 2), 10, key, MARK);
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < LEVELS; i++) palette.set(colourAt(i / (LEVELS - 1)), i * 3);
  FIXED.forEach((c, i) => palette.set(c, (LEVELS + i) * 3));
  return encodeIndexedPng(width, height, pixels, palette);
}
