// Licence chain of the committed track files: each has a manifest entry with the right sha256
// and licence, and the data folder carries the OpenStreetMap and Copernicus notices.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(root, 'packages/track/data');
const tracks = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/MANIFEST.json'), 'utf8'));

describe('track data licence chain', () => {
  it('lists every committed track file in the asset manifest with its sha256', () => {
    expect(tracks.length).toBeGreaterThan(0);
    for (const f of tracks) {
      const rel = `packages/track/data/${f}`;
      const entry = manifest.find((e) => e.file === rel);
      expect(entry, rel).toBeDefined();
      expect(entry.licence).toBe('ODbL-1.0');
      const sha = crypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(root, rel)))
        .digest('hex');
      expect(entry.sha256, rel).toBe(sha);
    }
  });

  it('keeps the attribution and liability texts beside the data and in the files', () => {
    const notice = fs
      .readFileSync(path.join(dataDir, 'LICENSE-DATA.md'), 'utf8')
      .replace(/\s+/g, ' ');
    const credits = fs.readFileSync(path.join(root, 'CREDITS.md'), 'utf8').replace(/\s+/g, ' ');
    const texts = [
      '© OpenStreetMap contributors',
      'https://www.openstreetmap.org/copyright',
      'Open Database License',
      'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    ];
    const liability =
      'The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30';
    for (const t of [...texts, liability]) expect(notice).toContain(t);
    for (const t of texts) expect(credits).toContain(t);
    for (const f of tracks) {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      expect(data.source.licence).toBe('ODbL-1.0');
      expect(data.source.attribution.join(' ')).toContain('OpenStreetMap contributors');
      expect(data.source.attribution.join(' ')).toContain(liability);
    }
  });
});
