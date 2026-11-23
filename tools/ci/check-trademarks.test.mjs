// Invented terms throughout: this file is scanned too, so it may not spell a real name. The last
// test takes its real names from the list at run time.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIST_FILE, findNames, termPattern } from './check-trademarks.mjs';

const list = {
  terms: { teams: ['Acme Racing', '=Zephyr'], suppliers: ['Globex'], bodies: ['XRF'] },
  allow: [{ files: '^packages/sim/validation/', term: 'Globex', reason: 'citation' }],
};
const check = (files) => findNames(Object.keys(files), (f) => files[f], list);

describe('termPattern', () => {
  it('matches whole words in any case', () => {
    expect(termPattern('Acme Racing').test('an ACME RACING car')).toBe(true);
    expect(termPattern('XRF').test('xrf map')).toBe(true);
    expect(termPattern('XRF').test('xrfa')).toBe(false);
    expect(termPattern('XRF').test('axrf')).toBe(false);
  });

  it("matches only the exact case for a term starting with '='", () => {
    expect(termPattern('=Zephyr').test('Zephyr 72')).toBe(true);
    expect(termPattern('=Zephyr').test('a zephyr blew')).toBe(false);
  });

  it('treats accented letters as part of a word', () => {
    expect(termPattern('Globex').test('Globexé')).toBe(false);
  });
});

describe('findNames', () => {
  it('reports each hit with its file, line and group', () => {
    expect(check({ 'apps/web/src/a.ts': 'ok\nconst t = "Acme Racing";' })).toEqual([
      'apps/web/src/a.ts:2: names Acme Racing (teams)',
    ]);
  });

  it('allows a listed citation only in its files', () => {
    expect(check({ 'packages/sim/validation/lib/t.ts': '// Globex T1 figures' })).toEqual([]);
    expect(check({ 'packages/sim/src/brakes.ts': '// Globex T1 figures' })).toHaveLength(1);
  });

  it('skips the two research docs, the lockfile, binary files and the list itself', () => {
    expect(
      check({
        'docs/physics-validation.md': 'XRF',
        'docs/track-data.md': 'XRF',
        'package-lock.json': 'XRF',
        'apps/web/public/assets/car/car_high.glb': 'XRF',
        [LIST_FILE]: 'XRF',
      }),
    ).toEqual([]);
  });

  it('scans the rest of docs', () => {
    expect(
      check({
        'docs/STATUS.md': 'XRF',
        'docs/adr/0001-x.md': 'Acme Racing',
        'docs/evidence/m1/log.md': 'Globex',
      }),
    ).toEqual([
      'docs/STATUS.md:1: names XRF (bodies)',
      'docs/adr/0001-x.md:1: names Acme Racing (teams)',
      'docs/evidence/m1/log.md:1: names Globex (suppliers)',
    ]);
  });

  it('catches a driver and a supplier in an OpenStreetMap name', () => {
    const real = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
    const driver = real.terms.drivers.find((t) => !t.startsWith('='));
    const supplier = real.terms['sponsors and suppliers'].find((t) => !t.startsWith('='));
    const data =
      `{ "t": { "name": "Tribuna ${driver}", "building": "grandstand" } }\n` +
      `{ "t": { "name": "Ex Circuito ${supplier}", "highway": "raceway" } }`;
    expect(findNames(['packages/render/data/x.dressing.json'], () => data, real)).toEqual([
      `packages/render/data/x.dressing.json:1: names ${driver} (drivers)`,
      `packages/render/data/x.dressing.json:2: names ${supplier} (sponsors and suppliers)`,
    ]);
  });
});
