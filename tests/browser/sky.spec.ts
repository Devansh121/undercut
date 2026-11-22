import { expect, test } from './fixtures';
import { viewPixels } from './helpers';

/**
 * The sky on the direct render path (no float targets) must come out tone-mapped and sRGB-encoded
 * like on the HDR path. The probe draws only the sky dome through each path in the shared Lite
 * session and reads the composited top band: no second session, no circuit, no cars, no shadow
 * maps, so it costs under a second on software WebGL. The full-frame comparison on High runs on
 * the GPU (`npm run shots -- monza --sky-check`).
 */
test('the sky is exposed and tone-mapped the same on the direct path as on the HDR path', async ({
  drive: { page },
}, info) => {
  // Sky tone-mapping is renderer logic and does not depend on the viewport: one project covers it.
  test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
  await page.evaluate(() => {
    const u = window.__undercut;
    u?.camera('chase-near');
    u?.restartLap();
    u?.setTimeScale(0);
    u?.resetFrameTimes();
  });
  await page.waitForFunction(() => (window.__undercut?.frameTimes().length ?? 0) >= 1);

  const measure = async (path: 'hdr' | 'direct'): Promise<number> => {
    await page.evaluate((p) => {
      const u = window.__undercut;
      u?.skyProbe(p);
      u?.resetFrameTimes();
    }, path);
    await page.waitForFunction(() => (window.__undercut?.frameTimes().length ?? 0) >= 2);
    const { meanLuma } = await viewPixels(page, { from: 0, to: 0.15 });
    return meanLuma;
  };

  let hdr: number;
  let direct: number;
  try {
    hdr = await measure('hdr');
    direct = await measure('direct');
  } finally {
    await page.evaluate(() => window.__undercut?.skyProbe(null));
  }

  console.log(`sky luma: hdr ${hdr.toFixed(1)}, direct ${direct.toFixed(1)}`);
  // A sky is drawn (not black) through both paths.
  expect(hdr).toBeGreaterThan(40);
  // Same tone map (Khronos PBR Neutral), same exposure, same dome: the paths differ only by the
  // HDR path's half-float target and 8-bit rounding, well under 5 % of the mean. A sky written
  // linear to the canvas (no tone map, no sRGB) is 25-60 % darker in this band.
  expect(Math.abs(direct - hdr) / hdr).toBeLessThan(0.05);
});
