import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCAN_DIRS, checkAssets } from './check-licences.mjs';

const allowed = ['CC0-1.0', 'CC-BY-4.0'];
const dirs = [];

function repo(files, manifest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-check-'));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/MANIFEST.json'), JSON.stringify(manifest));
  return root;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const entry = (file, content, licence = 'CC0-1.0') => ({
  file,
  source_url: 'https://example.org/asset',
  author: 'Someone',
  licence,
  changes: 'none',
  sha256: sha(content),
});

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('checkAssets', () => {
  it('passes with an empty manifest and no assets', () => {
    expect(checkAssets(repo({}, []), { allowed })).toEqual([]);
  });

  it('passes when every file has a matching entry', () => {
    const root = repo({ 'assets/a.png': 'A', 'apps/web/public/b.svg': 'B' }, [
      entry('assets/a.png', 'A'),
      entry('apps/web/public/b.svg', 'B', 'CC-BY-4.0'),
    ]);
    expect(checkAssets(root, { allowed })).toEqual([]);
  });

  it('flags a file without an entry', () => {
    const root = repo({ 'apps/web/public/x.png': 'X' }, []);
    expect(checkAssets(root, { allowed })).toEqual([
      'apps/web/public/x.png: not in assets/MANIFEST.json',
    ]);
  });

  it('scans the committed design-mock fonts by default', () => {
    const root = repo({ 'design/mock/fonts/a.woff2': 'F' }, []);
    expect(checkAssets(root, { allowed })).toEqual([
      'design/mock/fonts/a.woff2: not in assets/MANIFEST.json',
    ]);
    const ok = repo({ 'design/mock/fonts/a.woff2': 'F' }, [
      entry('design/mock/fonts/a.woff2', 'F'),
    ]);
    expect(checkAssets(ok, { allowed })).toEqual([]);
  });

  it('flags a changed file, a disallowed licence, a missing field and a dangling entry', () => {
    const root = repo({ 'assets/a.png': 'changed' }, [
      { ...entry('assets/a.png', 'original'), licence: 'CC-BY-NC-4.0', author: '' },
      entry('assets/gone.png', 'G'),
    ]);
    const problems = checkAssets(root, { allowed }).join('\n');
    expect(problems).toContain('missing or empty "author"');
    expect(problems).toContain('licence "CC-BY-NC-4.0" is not in');
    expect(problems).toContain('assets/gone.png does not exist');
    expect(problems).toContain('assets/a.png: sha256 is');
  });

  it('scans the derived databases in the track and render data folders', () => {
    // The committed track and dressing files are ODbL databases: a stale hash must fail.
    expect(SCAN_DIRS).toContain('packages/track/data');
    expect(SCAN_DIRS).toContain('packages/render/data');
  });
});
