import { expect, test } from './base';
import { onlinePair, onlineStart, onlineState } from './online-helpers';

// Real elapsed-time races, opt-in so PR CI keeps its short acceptance budget.
test.use({ trace: { mode: 'retain-on-failure', screenshots: false } });
for (const circuit of ['monza', 'spa', 'singapore']) {
  test(`online five-lap soak: ${circuit}, two scripted humans and eighteen AI`, async ({
    browser,
    baseURL,
  }, info) => {
    test.skip(process.env.ONLINE_SOAK !== '1' || info.project.name !== 'desktop');
    test.setTimeout(25 * 60_000);
    const { host, guest, close } = await onlinePair(browser, baseURL!, '&netSim=100,20,0.02,17');
    const errors: string[] = [];
    for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message));
    try {
      await host.locator(`#online-circuit-${circuit}`).click();
      await host.getByLabel('Laps', { exact: true }).fill('5');
      await host.getByRole('button', { name: 'Fill grid', exact: true }).click();
      await onlineStart(host, guest);
      for (const page of [host, guest])
        await page.evaluate(() => window.__undercut!.raceDriver(true));
      const stoppedSince = new Map<number, number>();
      const anchors = new Map<number, { x: number; z: number }>();
      let samples = 0;
      const failures: string[] = [];
      await expect
        .poll(
          async () => {
            const [a, b] = await Promise.all([onlineState(host), onlineState(guest)]);
            samples++;
            const seconds = a.race!.elapsedRaceMs / 1000;
            const grid = a.state!.room!.grid!;
            const poses = [{ seat: a.state!.seat!, ...a.race!.pose }, ...a.race!.remote];
            for (const pose of poses) {
              if (grid.find((g) => g.seat === pose.seat)?.state !== 'racing' || seconds < 20)
                continue;
              const previous = anchors.get(pose.seat);
              if (!previous || Math.hypot(pose.x - previous.x, pose.z - previous.z) >= 10) {
                anchors.set(pose.seat, pose);
                stoppedSince.set(pose.seat, seconds);
              }
              if (seconds - (stoppedSince.get(pose.seat) ?? seconds) >= 20)
                failures.push(`seat ${pose.seat} stuck at ${circuit} at ${seconds.toFixed(1)} s`);
            }
            for (const r of [a, b]) {
              if (r.race!.timing.some((t) => t.status === 'rejected'))
                failures.push(JSON.stringify(r.race!.timing));
              if (r.state!.ended) failures.push(JSON.stringify(r.state!.ended));
            }
            return failures.length > 0 || (a.state!.results !== null && b.state!.results !== null);
          },
          { timeout: 24 * 60_000, intervals: [5000] },
        )
        .toBe(true);
      expect(failures).toEqual([]);
      const [a, b] = await Promise.all([onlineState(host), onlineState(guest)]);
      expect(a.state!.results).toEqual(b.state!.results);
      expect(a.state!.results!.rows).toHaveLength(20);
      expect(a.state!.results!.rows.every((r) => r.status === 'finished' && r.laps === 5)).toBe(
        true,
      );
      expect(errors).toEqual([]);
      console.log(
        'Online soak proof',
        JSON.stringify({
          circuit,
          samples,
          results: a.state!.results,
          host: a.race,
          guest: b.race,
        }),
      );
      await info.attach(`online-soak-${circuit}.json`, {
        body: JSON.stringify({ circuit, samples, host: a, guest: b, errors }, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await close();
    }
  });
}
