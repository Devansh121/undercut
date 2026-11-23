import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BLOCKED, groupAssets, inline, parseCredits, type ManifestEntry } from './credits-model';

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

  it('groups the manifest by author and licence and counts every file', () => {
    const groups = groupAssets(manifest);
    expect(groups.reduce((n, g) => n + g.files, 0)).toBe(manifest.length);
    const fonts = groups.find((g) => g.licence === 'OFL-1.1' && g.author.includes('Barlow'));
    expect(fonts?.sources).toEqual(['raw.githubusercontent.com']);
    for (const g of groups) expect(g.licence).toMatch(/^(MIT|CC0-1\.0|CC-BY|OFL-1\.1|ODbL-1\.0)/);
  });
});
