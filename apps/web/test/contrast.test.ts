import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Text tokens against the surfaces they sit on, WCAG 2 contrast. Body text, labels and every
 * timing colour must reach 4.5:1 (AA for small text), in the default and the colour-blind-safe
 * sets. Disabled controls are exempt, as in WCAG.
 */
const tokens = fs.readFileSync(new URL('../../../design/mock/tokens.css', import.meta.url), 'utf8');
const kit = fs.readFileSync(new URL('../src/styles/kit.css', import.meta.url), 'utf8');

function read(css: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m?.[1]) throw new Error(`no --${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const surfaces = ['c-ink-0', 'c-ink-1', 'c-ink-2', 'c-ink-3', 'hud-panel-solid'].map((n) => ({
  n,
  hex: read(tokens, n),
}));
const cbBlock = kit.slice(kit.indexOf("[data-cb='on']"));

describe('contrast of text tokens', () => {
  it('body, secondary and label text reach 4.5:1 on every surface', () => {
    for (const t of ['c-text-1', 'c-text-2', 'c-text-3']) {
      for (const s of surfaces) {
        expect(contrast(read(tokens, t), s.hex), `${t} on ${s.n}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('timing and state colours reach 4.5:1 on HUD panels and cards, in both colour sets', () => {
    const names = ['c-time-overall', 'c-time-personal', 'c-time-slower', 'c-time-invalid'];
    for (const set of [tokens, cbBlock]) {
      for (const t of names) {
        for (const s of surfaces.filter((x) => x.n === 'hud-panel-solid' || x.n === 'c-ink-1')) {
          expect(contrast(read(set, t), s.hex), `${t} on ${s.n}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    for (const t of ['c-ers', 'c-brand', 'c-flag-yellow', 'c-drs']) {
      expect(contrast(read(tokens, t), read(tokens, 'hud-panel-solid'))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('dark text on light fills (selected options, primary buttons, timing chips) reads', () => {
    const inverse = read(tokens, 'c-text-inverse');
    for (const fill of [
      'c-text-1',
      'c-brand',
      'c-time-personal',
      'c-time-slower',
      'c-flag-yellow',
    ]) {
      expect(contrast(inverse, read(tokens, fill)), `inverse on ${fill}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
