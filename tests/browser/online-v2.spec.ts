import { expect, test } from './base';
import { onlinePair as pair, onlineStart as start, onlineState as state } from './online-helpers';

// DOM/network traces avoid stalling two software renderers during the start schedule.
test.use({ trace: { mode: 'retain-on-failure', screenshots: false } });

for (const circuit of ['monza', 'spa', 'singapore']) {
  test(`online ${circuit}: full AI grid, live timing and host takeover`, async ({
    browser,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'online');
    test.setTimeout(180000);
    const { host, guest, close } = await pair(browser, baseURL!);
    try {
      await host.locator(`#online-circuit-${circuit}`).click();
      await host.getByRole('button', { name: 'Fill grid', exact: true }).click();
      await expect.poll(async () => (await state(guest)).state?.room?.settings.aiCount).toBe(18);
      await start(host, guest);
      for (const page of [host, guest])
        await page.evaluate(() => window.__undercut!.raceDriver(true));
      for (const page of [host, guest]) {
        await expect.poll(async () => (await state(page)).race?.remote.length).toBe(19);
        await expect
          .poll(async () => (await state(page)).race?.lapTimeSec ?? 0)
          .toBeGreaterThan(0.5);
        expect((await state(page)).race?.circuit).toBe(circuit);
      }
      const positions = () =>
        guest.evaluate(() => window.__undercut!.online().race!.remote.filter((c) => c.seat >= 2));
      const before = await positions();
      await expect
        .poll(
          async () => {
            const after = await positions();
            return after.filter((p) => {
              const old = before.find((c) => c.seat === p.seat);
              return old && Math.hypot(p.x - old.x, p.z - old.z) > 10;
            }).length;
          },
          { timeout: 15000 },
        )
        .toBe(18);
      await host.goto('about:blank');
      await expect
        .poll(async () => (await state(guest)).state?.isHost, { timeout: 15000 })
        .toBe(true);
      const handover = await positions();
      await expect
        .poll(
          async () => {
            const after = await positions();
            return after.filter((p) => {
              const old = handover.find((c) => c.seat === p.seat);
              return old && Math.hypot(p.x - old.x, p.z - old.z) > 10;
            }).length;
          },
          { timeout: 15000 },
        )
        .toBe(18);
      console.log('AI takeover', circuit, JSON.stringify(await state(guest)));
    } finally {
      await close();
    }
  });
}

for (const latency of [50, 100, 150]) {
  test(`online contact at ${latency} ms with two percent loss`, async ({
    browser,
    baseURL,
  }, info) => {
    test.skip(info.project.name !== 'online');
    test.setTimeout(150000);
    const { host, guest, close } = await pair(
      browser,
      baseURL!,
      `&netSim=${latency},20,0.02,${latency}`,
    );
    try {
      await start(host, guest);
      await Promise.all(
        [host, guest].map((page, i) =>
          page.evaluate((i) => {
            window.__undercut!.teleport(100, i === 0 ? 1.35 : -1.35, 0);
            window.__undercut!.drive({ throttle: 0, brake: 1, steer: 0 });
          }, i),
        ),
      );
      // Let the 2 s post-teleport contact grace expire while both cars stay aligned at s = 100.
      await host.waitForTimeout(2300);
      await Promise.all(
        [host, guest].map((page, i) =>
          page.evaluate((i) => {
            window.__undercut!.drive({ throttle: 0.65, brake: 0, steer: i === 0 ? -0.04 : 0.04 });
          }, i),
        ),
      );
      for (const page of [host, guest])
        await expect
          .poll(async () => (await state(page)).race?.contacts.count ?? 0, { timeout: 10000 })
          .toBeGreaterThan(0);
      await Promise.all(
        [host, guest].map((page) =>
          page.evaluate(() => window.__undercut!.drive({ throttle: 0, brake: 0, steer: 0 })),
        ),
      );
      const reports = await Promise.all([host, guest].map(state));
      for (const r of reports) {
        expect(r.race!.contacts.maxImpulse).toBeGreaterThan(10);
        expect(r.race!.contacts.maxImpulse).toBeLessThan(10000);
        expect(r.race!.contacts.maxSpeed).toBeGreaterThan(0.1);
        expect(r.race!.contacts.maxSpeed).toBeLessThan(15);
      }
      const poses = await Promise.all(
        [host, guest].map((page) => page.evaluate(() => window.__undercut!.state())),
      );
      console.log('Contact proof', latency, JSON.stringify({ reports, poses }));
      // Lateral order must survive the touch: neither car passes through the other.
      expect(Number(poses[0]!.d)).toBeGreaterThan(Number(poses[1]!.d));
      expect(Number(poses[0]!.d) - Number(poses[1]!.d)).toBeGreaterThan(1.8);
      for (const page of [host, guest]) {
        const aboveRoad = await page.evaluate(() => {
          const s = window.__undercut!.state();
          const ground = window.__undercut!.trackPoint(Number(s.s), Number(s.d)).y;
          return Number(window.__undercut!.telemetry().y) - ground;
        });
        expect(Math.abs(aboveRoad)).toBeLessThan(0.5);
      }
      const own = reports.map((r) => r.race!.pose);
      expect(own.every((p) => Number.isFinite(p.y))).toBe(true);
      expect(Math.hypot(own[0]!.x - own[1]!.x, own[0]!.z - own[1]!.z)).toBeGreaterThan(1.8);
    } finally {
      await close();
    }
  });
}
