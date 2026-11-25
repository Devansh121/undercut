import { collideFootprints, type FootprintHit } from '@undercut/sim';
import { expect, test } from './base';
import { onlinePair as pair, onlineStart as start, onlineState as state } from './online-helpers';

// DOM/network traces avoid stalling two software renderers during the start schedule.
test.use({ trace: { mode: 'retain-on-failure', screenshots: false } });

interface TraceSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  d: number;
  aboveRoad: number;
  cx: number;
  cz: number;
  fx: number;
  fz: number;
  halfLength: number;
  halfWidth: number;
  contacts: number;
}

function lerpAngle(a: number, b: number, u: number): number {
  let diff = b - a;
  diff -= 2 * Math.PI * Math.round(diff / (2 * Math.PI));
  return a + diff * u;
}

function sampleTraceAt(trace: readonly TraceSample[], t: number): TraceSample | null {
  if (trace.length < 2 || t < trace[0]!.t || t > trace[trace.length - 1]!.t) return null;
  let lo = 0;
  let hi = trace.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (trace[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = trace[lo]!;
  const b = trace[hi]!;
  const u = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  const yaw = lerpAngle(a.yaw, b.yaw, u);
  return {
    t,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u,
    yaw,
    s: a.s + (b.s - a.s) * u,
    d: a.d + (b.d - a.d) * u,
    aboveRoad: a.aboveRoad + (b.aboveRoad - a.aboveRoad) * u,
    cx: a.cx + (b.cx - a.cx) * u,
    cz: a.cz + (b.cz - a.cz) * u,
    fx: Math.cos(yaw),
    fz: -Math.sin(yaw),
    halfLength: a.halfLength,
    halfWidth: a.halfWidth,
    contacts: u < 0.5 ? a.contacts : b.contacts,
  };
}

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

test('online running order agrees at 150 ms latency with two percent loss', async ({
  browser,
  baseURL,
}, info) => {
  test.skip(info.project.name !== 'online');
  test.setTimeout(150000);
  const { host, guest, close } = await pair(browser, baseURL!, '&netSim=150,20,0.02,150');
  try {
    await start(host, guest);
    // Wait for active orders and live peer snapshots before placing the moving pair.
    // A fixed post-start sleep can expire while either renderer is still warming up.
    await expect
      .poll(
        async () => {
          const snapshots = await Promise.all([state(host), state(guest)]);
          return snapshots.every(
            ({ race }) =>
              race?.orderEpoch !== undefined &&
              race.orderEpoch !== null &&
              race.remote[0]?.opacity === 1 &&
              race.remote[0]?.mode !== 'held',
          );
        },
        { timeout: 6000 },
      )
      .toBe(true);
    await Promise.all(
      [host, guest].map((page, i) =>
        page.evaluate((i) => {
          window.__undercut!.teleport(250, i === 0 ? 1.8 : -1.8, 180);
          window.__undercut!.drive({ throttle: 0, brake: 0, steer: 0 });
        }, i),
      ),
    );
    // Wait until both browsers render the teleported peer alongside them at full opacity.
    await expect
      .poll(
        async () => {
          const [h, g] = await Promise.all([state(host), state(guest)]);
          const hr = h.race?.remote[0];
          const gr = g.race?.remote[0];
          const hp = h.race?.pose;
          const gp = g.race?.pose;
          if (!hr || !gr || !hp || !gp) return false;
          return (
            Math.hypot(hr.x - hp.x, hr.z - hp.z) < 60 &&
            Math.hypot(gr.x - gp.x, gr.z - gp.z) < 60 &&
            hr.opacity === 1 &&
            gr.opacity === 1 &&
            hr.mode !== 'held' &&
            gr.mode !== 'held'
          );
        },
        { timeout: 6000 },
      )
      .toBe(true)
      .catch(async (error: unknown) => {
        console.log(
          'Order setup state',
          JSON.stringify(await Promise.all([state(host), state(guest)])),
        );
        throw error;
      });
    const readSharedOrder = async () => {
      const [h, g] = await Promise.all([state(host), state(guest)]);
      // Freeze one active epoch, then wait for receipt AND activation on both clients.
      // A renderer stall may delay reliable control messages past their scheduled activation.
      const at = h.race!.orderEpoch;
      expect(at).not.toBeNull();
      await expect
        .poll(
          async () => {
            const snapshots = await Promise.all([state(host), state(guest)]);
            const orders = await Promise.all(
              [host, guest].map((page) =>
                page.evaluate((at) => window.__undercut!.onlineOrder(at!), at),
              ),
            );
            return orders.every(
              (order, i) =>
                order?.at === at && (snapshots[i]!.race!.orderEpoch ?? -Infinity) >= at!,
            );
          },
          { timeout: 6000 },
        )
        .toBe(true);
      const [ho, go] = await Promise.all(
        [host, guest].map((page) => page.evaluate((at) => window.__undercut!.onlineOrder(at!), at)),
      );
      expect(ho).not.toBeNull();
      expect(go).not.toBeNull();
      expect(ho!.at).toBe(go!.at);
      expect(ho!.order).toEqual(go!.order);
      if (h.race!.orderEpoch === g.race!.orderEpoch) expect(h.race!.order).toEqual(g.race!.order);
      return { h, g, ho: ho!, go: go! };
    };
    const paired: {
      hostOrder: number[];
      guestOrder: number[];
      hostPos: number;
      guestPos: number;
    }[] = [];
    for (let k = 0; k < 20; k++) {
      const { h, g, ho, go } = await readSharedOrder();
      expect(h.state!.room!.members.every((m) => m.connected)).toBe(true);
      expect(g.state!.room!.members.every((m) => m.connected)).toBe(true);
      expect([...ho.order].sort((a, b) => a - b)).toEqual([0, 1]);
      expect([ho.position, go.position].sort((a, b) => a - b)).toEqual([1, 2]);
      paired.push({
        hostOrder: ho.order,
        guestOrder: go.order,
        hostPos: ho.position,
        guestPos: go.position,
      });
      await host.waitForTimeout(100);
    }

    // Now make the trailing car overtake cleanly and verify both clients flip together.
    const initialLeader = paired[paired.length - 1]!.hostOrder[0]!;
    const trailer = initialLeader === 0 ? 1 : 0;
    await Promise.all(
      [host, guest].map((page, i) =>
        page.evaluate(
          (accel) => window.__undercut!.drive({ throttle: accel ? 1 : 0, brake: 0, steer: 0 }),
          i === trailer,
        ),
      ),
    );
    await expect
      .poll(
        async () => {
          const [h, g] = await Promise.all([state(host), state(guest)]);
          return h.race!.order[0] === trailer && g.race!.order[0] === trailer;
        },
        { timeout: 10000 },
      )
      .toBe(true);
    for (let k = 0; k < 10; k++) {
      const { ho, go } = await readSharedOrder();
      expect(ho.order[0]).toBe(trailer);
      expect([ho.position, go.position].sort((a, b) => a - b)).toEqual([1, 2]);
      await host.waitForTimeout(100);
    }
    console.log(
      'Order proof 150ms',
      JSON.stringify({ samples: paired.length, initialLeader, overtakenBy: trailer }),
    );
  } finally {
    await close();
  }
});

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
      // Let post-contact separation finish inside the synchronized trace window.
      await host.waitForTimeout(900);
      const reports = await Promise.all(
        [host, guest].map((page) => page.evaluate(() => window.__undercut!.online(true))),
      );
      for (const r of reports) {
        expect(r.race!.contacts.maxImpulse).toBeGreaterThan(10);
        expect(r.race!.contacts.maxImpulse).toBeLessThan(10000);
        expect(r.race!.contacts.maxSpeed).toBeGreaterThan(0.1);
        expect(r.race!.contacts.maxSpeed).toBeLessThan(15);
      }

      const hostTrace = reports[0]!.race!.trace;
      const guestTrace = reports[1]!.race!.trace;
      expect(hostTrace.length).toBeGreaterThan(20);
      expect(guestTrace.length).toBeGreaterThan(20);
      expect(hostTrace[0]!.contacts).toBe(0);
      expect(guestTrace[0]!.contacts).toBe(0);
      const firstHitHost = hostTrace.find((s) => s.contacts > 0)?.t ?? Infinity;
      const firstHitGuest = guestTrace.find((s) => s.contacts > 0)?.t ?? Infinity;
      const firstContactT = Math.min(firstHitHost, firstHitGuest);
      expect(Number.isFinite(firstContactT)).toBe(true);

      const tStart = Math.max(hostTrace[0]!.t, guestTrace[0]!.t, firstContactT - 300);
      const tEnd = Math.min(
        hostTrace[hostTrace.length - 1]!.t,
        guestTrace[guestTrace.length - 1]!.t,
      );
      expect(tEnd - tStart).toBeGreaterThan(300);

      const hit: FootprintHit = { depth: 0, nx: 0, nz: 0, px: 0, pz: 0 };
      let synchronizedSamples = 0;
      let alongsideSamples = 0;
      let maxPenetration = 0;
      let maxAbsAboveRoad = 0;
      let minAlongsideD = Infinity;
      let finalDepth = 0;
      let finalDs = 0;
      let finalDd = 0;
      let finalDist = 0;

      for (let t = tStart; t <= tEnd; t += 10) {
        const h = sampleTraceAt(hostTrace, t);
        const g = sampleTraceAt(guestTrace, t);
        if (!h || !g) continue;
        synchronizedSamples++;
        expect(Number.isFinite(h.y) && Number.isFinite(g.y)).toBe(true);
        maxAbsAboveRoad = Math.max(maxAbsAboveRoad, Math.abs(h.aboveRoad), Math.abs(g.aboveRoad));
        expect(Math.abs(h.aboveRoad)).toBeLessThan(0.5);
        expect(Math.abs(g.aboveRoad)).toBeLessThan(0.5);

        const overlap = collideFootprints(h, g, hit);
        const depth = overlap ? hit.depth : 0;
        if (depth > maxPenetration) maxPenetration = depth;

        const ds = Math.abs(h.s - g.s);
        const combinedHalfLen = h.halfLength + g.halfLength;
        if (ds < combinedHalfLen) {
          alongsideSamples++;
          const dd = h.d - g.d;
          if (dd < minAlongsideD) minAlongsideD = dd;
          // Side ordering must survive every synchronized instant while alongside (no pass-through).
          expect(h.d).toBeGreaterThan(g.d);
        }

        finalDepth = depth;
        finalDs = ds;
        finalDd = h.d - g.d;
        finalDist = Math.hypot(h.cx - g.cx, h.cz - g.cz);
      }

      console.log(
        'Contact proof',
        latency,
        JSON.stringify({
          synchronizedSamples,
          alongsideSamples,
          maxPenetration: Number(maxPenetration.toFixed(3)),
          minAlongsideD: Number(minAlongsideD.toFixed(3)),
          maxAbsAboveRoad: Number(maxAbsAboveRoad.toFixed(3)),
          finalDepth: Number(finalDepth.toFixed(3)),
          finalDs: Number(finalDs.toFixed(3)),
          finalDd: Number(finalDd.toFixed(3)),
          finalDist: Number(finalDist.toFixed(3)),
          contacts: reports.map((r) => r.race!.contacts),
        }),
      );

      expect(synchronizedSamples).toBeGreaterThan(25);
      expect(alongsideSamples).toBeGreaterThan(5);
      // Bounded penetration throughout the touch: footprints never pass through each other.
      expect(maxPenetration).toBeLessThan(0.5);
      // Separation is geometric: yaw and longitudinal offset can separate rectangles even
      // when their lateral CoG distance is below a car width. Require zero final penetration.
      expect(finalDepth).toBe(0);
      expect(finalDist).toBeGreaterThan(1.8);
    } finally {
      await close();
    }
  });
}
