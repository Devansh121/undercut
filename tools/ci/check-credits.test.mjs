import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCredits, creditKey, namedPaths } from './check-credits.mjs';

const allowed = { shipped: ['MIT'], tools: ['MIT', 'MPL-2.0'] };
const dirs = [];

const texture = {
  file: 'apps/web/public/assets/tex/asphalt/arm_1024.webp',
  source_url:
    'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_track/asphalt_track_arm_2k.jpg',
  author: 'Someone (Poly Haven)',
  licence: 'CC0-1.0',
};
const props = {
  file: 'apps/web/public/assets/props/cone.glb',
  source_url: 'tools/props/props.py (this repository)',
  author: 'Project contributors',
  licence: 'MIT',
};
const lockfile = (extra = {}) => ({
  packages: {
    '': { dependencies: {}, devDependencies: { vite: '1.0.0' } },
    'apps/web': { dependencies: { three: '1.0.0', '@undercut/core': '0.0.0' } },
    'node_modules/three': { version: '1.0.0', license: 'MIT' },
    'node_modules/vite': { version: '1.0.0', license: 'MIT', dev: true },
    'node_modules/@undercut/core': { resolved: 'packages/core', link: true },
    ...extra,
  },
});
const CREDITS = [
  '# Credits',
  '## Third-party code shipped in the client',
  '| three.js | `three` | MIT |',
  '## Tools',
  '| Vite | `vite` | MIT |',
  '## Assets',
  '| Asphalt | https://polyhaven.com/a/asphalt_track |',
  'Props in `apps/web/public/assets/props/` are MIT.',
].join('\n');

function repo({ credits = CREDITS, manifest = [texture, props], lock = lockfile() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-check-'));
  dirs.push(root);
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  write('CREDITS.md', credits);
  write('assets/MANIFEST.json', JSON.stringify(manifest));
  write('package-lock.json', JSON.stringify(lock));
  for (const e of manifest) write(e.file, 'x');
  return root;
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('creditKey', () => {
  it('maps each known source to the page CREDITS.md must link', () => {
    expect(creditKey(texture)).toBe('https://polyhaven.com/a/asphalt_track');
    expect(
      creditKey({
        source_url:
          'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/kloofendal_overcast_puresky_4k.hdr',
      }),
    ).toBe('https://polyhaven.com/a/kloofendal_overcast_puresky');
    expect(creditKey({ source_url: 'https://ambientcg.com/get?file=Grass001_1K-JPG.zip' })).toBe(
      'https://ambientcg.com/view?id=Grass001',
    );
    expect(
      creditKey({ source_url: 'https://raw.githubusercontent.com/jpt/barlow/main/OFL.txt' }),
    ).toBe('https://github.com/jpt/barlow');
    expect(
      creditKey({
        file: 'packages/track/data/monza.json',
        licence: 'ODbL-1.0',
        source_url: 'https://www.openstreetmap.org/relation/284565',
      }),
    ).toBe('packages/track/data/LICENSE-DATA.md');
    expect(creditKey({ source_url: 'https://example.org/model.glb' })).toBeNull();
  });
});

describe('namedPaths', () => {
  it('keeps repository paths and skips package names, URLs and served paths', () => {
    expect(
      namedPaths('`apps/web/x/` `@types/node` `three` `https://a/b` /assets/draco/ `docs/a.md`'),
    ).toEqual(['apps/web/x/', 'docs/a.md']);
  });
});

describe('checkCredits', () => {
  it('passes when the credits, the manifest and the lockfile agree', () => {
    expect(checkCredits(repo(), { allowed })).toEqual([]);
  });

  it('reports a third-party asset whose source page is not credited', () => {
    const credits = CREDITS.replace('https://polyhaven.com/a/asphalt_track', 'Poly Haven');
    expect(checkCredits(repo({ credits }), { allowed })).toEqual([
      `${texture.file}: CREDITS.md does not name https://polyhaven.com/a/asphalt_track`,
    ]);
  });

  it('reports an asset from a source it does not know', () => {
    const odd = { ...texture, file: 'apps/web/public/assets/x.png', source_url: 'https://x.org/a' };
    const problems = checkCredits(repo({ manifest: [odd, props] }), { allowed });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/unknown source/);
  });

  it('reports first-party files no credited path covers, or with another author', () => {
    const stray = {
      ...props,
      file: 'apps/web/public/assets/ui/x.webp',
      author: 'GAME contributors',
    };
    expect(checkCredits(repo({ manifest: [texture, props, stray] }), { allowed })).toEqual([
      'apps/web/public/assets/ui/x.webp: first-party author should read "Project contributors"',
      'apps/web/public/assets/ui/x.webp: no path in CREDITS.md covers this first-party file',
    ]);
  });

  it('reports a credited path that does not exist', () => {
    const credits = `${CREDITS}\nFonts in \`design/mock/fonts/X-*.woff2\`.`;
    expect(checkCredits(repo({ credits }), { allowed })).toEqual([
      'CREDITS.md names design/mock/fonts/X-*.woff2, which does not exist',
    ]);
  });

  it('wants production dependencies under the shipped heading and tools anywhere', () => {
    const credits = CREDITS.replace('| three.js | `three` | MIT |', '').replace(
      '| Vite | `vite` | MIT |',
      '| three.js | `three` | MIT |',
    );
    expect(checkCredits(repo({ credits }), { allowed })).toEqual([
      'CREDITS.md: direct dependency vite is not named (as `vite`)',
      'CREDITS.md: production dependency three is not under "## Third-party code shipped"',
    ]);
  });

  it('holds shipped packages to the shipped licence list', () => {
    const lock = lockfile({
      'node_modules/css-min': { version: '2.0.0', license: 'MPL-2.0', dev: true },
      'node_modules/copyleft': { version: '3.0.0', license: 'MPL-2.0' },
      'node_modules/unlicensed': { version: '4.0.0', dev: true },
    });
    expect(checkCredits(repo({ lock }), { allowed })).toEqual([
      'node_modules/copyleft@3.0.0: licence "MPL-2.0" is not allowed for shipped packages (tools/ci/dependency-licences.json)',
      'node_modules/unlicensed@4.0.0: licence "none" is not allowed for tools packages (tools/ci/dependency-licences.json)',
    ]);
  });
});
