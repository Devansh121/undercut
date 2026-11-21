import { expect, test } from '@playwright/test';

/**
 * Re-entering sessions must not leak GPU resources or leave the WebGL context in a state that
 * makes the next session's uploads invalid. GL objects are counted at the API: every create
 * minus every delete, per kind.
 */
/*
 * Mobile here. The same check on High (GTAO, bloom, SMAA, three cascades) runs on the GPU in
 * `npm run shots -- monza --lifecycle` (tools/screenshots/shots.mjs): five High sessions on
 * CI's software renderer take minutes and starve the other browser tests.
 */
// Small canvas: the renderer's lifetime does not depend on it, and software WebGL pays per pixel.
test.use({ viewport: { width: 480, height: 300 } });

for (const quality of ['mobile'] as const) {
  test(`starting and quitting five sessions on one page leaks nothing and warns about nothing (${quality})`, async ({
    page,
  }, info) => {
    // The renderer's lifetime does not depend on the viewport: one project covers it.
    test.skip(info.project.name !== 'desktop', 'runs on the desktop project');
    test.setTimeout(240_000);
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning')
        problems.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const balance: Record<string, number> = {};
      (window as unknown as { __glBalance: Record<string, number> }).__glBalance = balance;
      const proto = WebGL2RenderingContext.prototype as unknown as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      for (const kind of [
        'Texture',
        'Framebuffer',
        'Program',
        'Shader',
        'Buffer',
        'Renderbuffer',
        'VertexArray',
      ]) {
        const create = proto[`create${kind}`];
        const remove = proto[`delete${kind}`];
        if (!create || !remove) continue;
        balance[kind] = 0;
        proto[`create${kind}`] = function (this: unknown, ...a: unknown[]) {
          balance[kind] = (balance[kind] ?? 0) + 1;
          return create.apply(this, a);
        };
        proto[`delete${kind}`] = function (this: unknown, ...a: unknown[]) {
          if (a[0]) balance[kind] = (balance[kind] ?? 0) - 1;
          return remove.apply(this, a);
        };
      }
    });
    await page.goto(`/?debug=1&quality=${quality}`);
    await page.waitForFunction(() => Boolean(window.__undercut));

    const after: { gl: Record<string, number>; info: Record<string, number> }[] = [];
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__undercut?.start());
      await expect(page.locator('html')).toHaveAttribute('data-ready', '', { timeout: 60_000 });
      // Let a few frames render so every material is compiled and every texture uploaded.
      await page.waitForFunction(() => (window.__undercut?.state().tick as number) > 20, null, {
        timeout: 60_000,
      });
      await page.evaluate(() => window.__undercut?.quit());
      await expect(page.getByRole('button', { name: /Start/ })).toBeVisible();
      after.push(
        await page.evaluate(() => ({
          gl: { ...(window as unknown as { __glBalance: Record<string, number> }).__glBalance },
          info: window.__undercut?.rendererInfo() as Record<string, number>,
        })),
      );
    }
    // Whatever the first session leaves allocated for the page (the renderer's own state) stays
    // the same through every later session: no growth per session.
    for (let i = 1; i < 5; i++) {
      expect(after[i]?.gl, `GL objects after session ${i + 1}`).toEqual(after[0]?.gl);
      expect(after[i]?.info, `renderer.info after session ${i + 1}`).toEqual(after[0]?.info);
    }
    // Between sessions only the page renderer's own state is left (its cached shadow depth
    // material and internal placeholder textures): no scene geometry at all, and a handful of
    // textures and programs at most.
    expect(after[0]?.info.geometries).toBe(0);
    expect(after[0]?.info.textures).toBeLessThanOrEqual(2);
    expect(after[0]?.info.programs).toBeLessThanOrEqual(2);
    expect(problems).toEqual([]);
  });
}
