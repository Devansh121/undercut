import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLOCKED,
  groupAssets,
  inline,
  parseCredits,
  sourceHosts,
  type ManifestEntry,
} from './credits-model';

const root = new URL('../../../../../', import.meta.url);
const md = fs.readFileSync(new URL('CREDITS.md', root), 'utf8');
const manifest = JSON.parse(
  fs.readFileSync(new URL('assets/MANIFEST.json', root), 'utf8'),
) as ManifestEntry[];

describe('credits from CREDITS.md and the manifest', () => {
  it('reads every section and table of CREDITS.md', () => {
    const blocks = parseCredits(md);
    const headings = blocks.filter((b) => b.kind === 'heading').map((b) => b.text);
    expect(headings).toContain('Third-party code shipped in the client');
    expect(headings).toContain('Assets');
    const tables = blocks.filter((b) => b.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(4);
    const text = JSON.stringify(blocks);
    expect(text).toContain('three.js');
    expect(text).toContain('Poly Haven');
    expect(text).toContain('OpenStreetMap');
  });

  it('shows no real series or governing-body names', () => {
    const text = JSON.stringify([parseCredits(md), groupAssets(manifest)]);
    expect(text).not.toMatch(BLOCKED);
    // The filter is live: CREDITS.md does mention the governing body's maps, and that is left out.
    expect(BLOCKED.test(md)).toBe(true);
  });

  it('turns Markdown links into links and keeps repository paths as text', () => {
    expect(inline('[three.js](https://github.com/mrdoob/three.js) | MIT')).toEqual([
      { text: 'three.js', href: 'https://github.com/mrdoob/three.js' },
      { text: ' | MIT' },
    ]);
    expect(inline('see [`LICENSE-DATA.md`](packages/track/data/LICENSE-DATA.md)')).toEqual([
      { text: 'see ' },
      { text: 'LICENSE-DATA.md' },
    ]);
  });

  it('lists the host of every link in a free-text source, and nothing else', () => {
    // The circuit dressing's source, as the manifest gives it.
    expect(
      sourceHosts(
        'https://www.openstreetmap.org (Overpass query via https://overpass.private.coffee/api/interpreter, fetched 2026-11-21T12:36:09Z); https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N45_00_E009_00_DEM/Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif',
      ),
    ).toEqual([
      'openstreetmap.org',
      'overpass.private.coffee',
      'copernicus-dem-30m.s3.amazonaws.com',
    ]);
    expect(sourceHosts('tools/car/build.mjs (this repository)')).toEqual([]);
    const osm = groupAssets(manifest).find((g) => g.licence === 'ODbL-1.0');
    expect(osm?.sources).toContain('copernicus-dem-30m.s3.amazonaws.com');
    for (const g of groupAssets(manifest))
      for (const h of g.sources) expect(h).toMatch(/^[a-z0-9.-]+$/);
  });

  it('groups the manifest by author and licence and counts every file', () => {
    const groups = groupAssets(manifest);
    expect(groups.reduce((n, g) => n + g.files, 0)).toBe(manifest.length);
    const fonts = groups.find((g) => g.licence === 'OFL-1.1' && g.author.includes('Barlow'));
    expect(fonts?.sources).toEqual(['raw.githubusercontent.com']);
    for (const g of groups) expect(g.licence).toMatch(/^(MIT|CC0-1\.0|CC-BY|OFL-1\.1|ODbL-1\.0)/);
  });
});
