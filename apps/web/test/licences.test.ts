import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NOTICE_PARTS, licenceNotices } from '../licences.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (file: string): string => fs.readFileSync(root + file, 'utf8');
const count = (text: string, part: string): number => text.split(part).length - 1;

describe('licences.txt', () => {
  it('reads only files that exist', () => {
    for (const part of NOTICE_PARTS) {
      for (const file of part.files) expect(fs.existsSync(root + file), file).toBe(true);
    }
  });

  it('carries the full text of every licence the build ships', () => {
    const text = licenceNotices('Game', read);
    // The game's own licence, three.js's and SMAA's (its area and search textures ship inside
    // three's SMAAPass): all MIT.
    expect(count(text, 'THE SOFTWARE IS PROVIDED "AS IS"')).toBe(3);
    expect(text).toContain('three.js authors');
    expect(text).toContain('Copyright (C) 2013 Jorge Jimenez');
    expect(text).toContain('https://github.com/iryoku/smaa');
    // The Draco decoder: Apache-2.0 in full, with its copyright line.
    expect(text).toContain('Copyright 2016 The Draco Authors');
    expect(text).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
    expect(text).toContain('END OF TERMS AND CONDITIONS');
    // Both font families, each with its own copyright line.
    expect(count(text, 'SIL OPEN FONT LICENSE Version 1.1')).toBe(2);
    expect(text).toContain('The Archivo Project Authors');
    expect(text).toContain('The Barlow Project Authors');
    // The circuit data's attribution and the Copernicus notices.
    expect(text).toContain('© OpenStreetMap contributors');
    expect(text).toContain('https://www.openstreetmap.org/copyright');
    expect(text.replace(/\s+/g, ' ')).toContain(
      'Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    );
  });

  it('names the game from the constant it is given', () => {
    expect(licenceNotices('Game', read).startsWith('Game: licences\n')).toBe(true);
  });
});
