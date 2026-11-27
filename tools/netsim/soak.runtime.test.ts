/**
 * Soak: eight headless clients race through the network simulator against the real
 * rooms service on the local Workers runtime, with twelve AI cars driven by the host.
 * The service clock is real time (Durable Objects read the wall clock), so the race
 * runs in real time: a short version in the `rooms` CI job, a longer one nightly
 * (`npm run test:soak`).
 *
 * Asserts: every client sees the same phase sequence and start schedule, the final
 * classification is identical everywhere and matches the cars' known speeds, no lap is
 * rejected, remote-car interpolation error stays within the bound below, buffers and
 * in-flight queues stay bounded, and the service logs no errors.
 */
import fs from 'node:fs';
import { RemoteCarSmoother } from '../../apps/web/src/online/smoother';
import { createRng } from '@undercut/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { Phase, RemoteCarMode } from '@undercut/protocol';
import { CAR_RECORD_BYTES, DEFAULT_REMOTE_CAR_OPTIONS } from '@undercut/protocol';
import {
  Recorder,
  createRoom,
  joined,
  raceState,
  serviceErrors,
  until,
} from '../../services/rooms/test/headless';
import { HeadlessDriver } from './driver';
import { NetsimTransport, type NetConditions } from './netsim';
import { realTimers, wsTransport } from './node';
import { carAt, loopTrack } from './track';

interface Profile {
  name: string;
  lengthM: number;
  laps: number;
  seed: number;
}

const PROFILES: Record<string, Profile> = {
  short: { name: 'short (CI)', lengthM: 450, laps: 3, seed: 1 },
  long: { name: 'long (nightly)', lengthM: 1200, laps: 12, seed: 2 },
};
const profile =
  process.env.SOAK_PLAYERS === '2'
    ? { name: 'two-player', lengthM: 450, laps: 6, seed: 1 }
    : (PROFILES[process.env.SOAK === 'long' ? 'long' : 'short'] as Profile);

const CONDITIONS: NetConditions = {
  latencyMs: 150,
  jitterMs: 50,
  loss: 0.02,
  duplicate: 0.01,
  retransmitMs: 200,
};
// A two-player profile exercises the game's first online slice using the same proxy.
const HUMANS = process.env.SOAK_PLAYERS === '2' ? 2 : 8;
const AI = HUMANS === 2 ? 0 : 12;

/**
 * Error bounds for remote cars, derived rather than fitted. Positions are interpolated
 * with cubic Hermite curves from the snapshot velocities, which on this loop (radius
 * about 75 m, about 85 m/s) is exact to well under a millimetre even across lost
 * snapshots. What remains is the snapshot time, sent in whole milliseconds: up to
 * 0.5 ms of error, 4.3 cm at 85 m/s. So the 99th percentile must stay under 10 cm.
 * The worst case is extrapolation, capped at 250 ms: (v^2 / r) t^2 / 2 is about 3 m.
 * (The synthetic cars also jump from 0 to full speed at lights out, which costs a few
 * samples up to v x 33 ms / 2, about 1.4 m, inside that bound.)
 */
const P99_BOUND_M = 0.1;
const MAX_BOUND_M = 3;

const report: string[] = [];
afterAll(() => {
  if (report.length === 0) return;
  const text = `${report.join('\n')}\n`;
  // The test runner hides console output of passing tests: write the table where it
  // will be seen, and to SOAK_REPORT when set (the nightly job keeps it).
  process.stderr.write(`\n${text}\n`);
  if (process.env.SOAK_REPORT) fs.writeFileSync(process.env.SOAK_REPORT, text);
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

describe(`soak: ${profile.name}`, () => {
  it(`${HUMANS} clients, ${CONDITIONS.latencyMs} +- ${CONDITIONS.jitterMs} ms, ${CONDITIONS.loss * 100}% loss`, async () => {
    const started = Date.now();
    const track = loopTrack(profile.lengthM);
    const code = await createRoom();
    const nets = Array.from(
      { length: HUMANS },
      (_, i) =>
        new NetsimTransport(wsTransport, CONDITIONS, createRng(profile.seed * 100 + i), realTimers),
    );
    const rs = nets.map((transport, i) => new Recorder(code, `Driver ${i + 1}`, { transport }));
    const drivers: HeadlessDriver[] = [];
    let sampler: ReturnType<typeof setInterval> | null = null;
    try {
      await joined(...rs);
      const host = rs[0] as Recorder;
      host.client.changeSettings({
        circuit: track.circuit,
        laps: profile.laps,
        aiCount: AI,
        gridOrder: 'random',
      });
      await until('settings', () => rs.every((r) => r.client.room?.settings.laps === profile.laps));
      for (const r of rs) {
        const d = new HeadlessDriver(r.client, track, realTimers);
        d.start();
        drivers.push(d);
      }
      for (const r of rs) r.client.setReady(true);

      // Sample every client's view of every remote car against the known truth.
      const errors: number[] = [];
      let worstError = -1;
      let worstSample = '';
      const modes: Record<RemoteCarMode, number> = { interpolated: 0, extrapolated: 0, held: 0 };
      let maxRemoteSize = 0;
      const delays: number[] = [];
      // How long this process itself stalled (all eight senders live here), and the
      // longest silence in relayed car frames any client saw.
      let lastTick = 0;
      let maxTickGap = 0;
      const lastFrame = new Map<Recorder, number>();
      // The game's renderer smoothing, measured only in the opt-in two-player run
      // (SOAK_PLAYERS=2): the CI soak keeps its sampler to the interpolation check alone, as
      // this process also hosts every sender.
      const smoothers = HUMANS === 2 ? rs.map(() => new RemoteCarSmoother()) : null;
      const lastSample = new Map<Recorder, number>();
      let maxFrameGap = 0;
      const heldBySeat = new Map<number, number>();
      for (const r of rs) {
        r.client.on('snapshots', () => {
          const now = performance.now();
          const prev = lastFrame.get(r);
          if (prev !== undefined && r.client.room?.phase === 'racing') {
            maxFrameGap = Math.max(maxFrameGap, now - prev);
          }
          lastFrame.set(r, now);
        });
      }
      sampler = setInterval(() => {
        const tick = performance.now();
        if (lastTick > 0) maxTickGap = Math.max(maxTickGap, tick - lastTick);
        lastTick = tick;
        for (const r of rs) {
          const c = r.client;
          const room = c.room;
          const now = c.serverNow();
          if (
            !room?.start ||
            now === null ||
            (room.phase !== 'racing' && room.phase !== 'finished')
          )
            continue;
          const views = c.remoteCars.sample(now);
          if (smoothers) {
            const elapsed = (tick - (lastSample.get(r) ?? tick)) / 1000;
            lastSample.set(r, tick);
            smoothers[rs.indexOf(r)]!.update(views, elapsed);
          }
          const renderTime = now - c.remoteCars.delayMs;
          delays.push(c.remoteCars.delayMs);
          maxRemoteSize = Math.max(maxRemoteSize, c.remoteCars.size);
          for (const v of views) {
            modes[v.mode]++;
            if (v.mode === 'held') heldBySeat.set(v.seat, (heldBySeat.get(v.seat) ?? 0) + 1);
            const truth = carAt(track, v.seat, renderTime, room.start.lightsOutAt, 0);
            const error = Math.hypot(v.x - truth.x, v.z - truth.z);
            errors.push(error);
            if (error > worstError) {
              worstError = error;
              worstSample = JSON.stringify({
                seat: v.seat,
                mode: v.mode,
                aheadMs: v.aheadMs,
                raceMs: renderTime - room.start.lightsOutAt,
                sampleOffsetMs: v.t - renderTime,
                latestOffsetMs: (c.remoteCars.latest(v.seat)?.t ?? renderTime) - renderTime,
              });
            }
          }
        }
      }, 50);

      const raceBudgetMs = profile.laps * track.lapMs(0) + 60_000;
      await until(
        'results everywhere',
        () => rs.every((r) => r.of('results').length > 0 && r.client.room?.phase === 'results'),
        raceBudgetMs,
        50,
        () => raceState(rs, drivers),
      );
      clearInterval(sampler);
      sampler = null;

      // Gather everything first, so the report exists even when an assertion fails.
      const phases = rs.map((r) => {
        const seq: Phase[] = [];
        for (const room of r.of('room'))
          if (seq[seq.length - 1] !== room.phase) seq.push(room.phase);
        return seq.join(' > ');
      });
      const starts = rs.map((r) => JSON.stringify(r.of('start')));
      const results = rs.map((r) => JSON.stringify(r.last('results')));
      const rows = (rs[0] as Recorder).last('results')!.results.rows;
      const rejected = drivers.flatMap((d) => d.rejections);
      const flagged = rows
        .filter((r) => r.flags.length > 0)
        .map((r) => `${r.seat}:${r.flags.join('+')}`);
      errors.sort((a, b) => a - b);
      const p50 = percentile(errors, 0.5);
      const p99 = percentile(errors, 0.99);
      const max = errors[errors.length - 1] ?? Number.NaN;
      const inFlight = Math.max(
        ...nets.flatMap((n) => n.links.flatMap((l) => [l.up.maxInFlight, l.down.maxInFlight])),
      );
      const raceSeconds = (rows[rows.length - 1]!.timeMs ?? 0) / 1000;
      const downBytes = nets.map((n) => n.links.reduce((s, l) => s + l.down.bytes, 0));
      const upBytes = nets.map((n) => n.links.reduce((s, l) => s + l.up.bytes, 0));
      const lost = nets.reduce(
        (s, n) => s + n.links.reduce((t, l) => t + l.up.dropped + l.down.dropped, 0),
        0,
      );
      const total = errors.length;
      const pct = (n: number) => `${((100 * n) / total).toFixed(1)}%`;
      delays.sort((a, b) => a - b);
      const awayEvents = rs[0]!
        .of('room')
        .reduce((n, room) => n + room.members.filter((m) => m.status !== 'active').length, 0);
      report.push(
        `Soak ${profile.name}: ${HUMANS} humans + ${AI} AI, ${profile.laps} laps of ${profile.lengthM} m`,
        `| setting | value |`,
        `| --- | --- |`,
        `| latency / jitter / loss / duplication | ${CONDITIONS.latencyMs} ms / +-${CONDITIONS.jitterMs} ms / ${CONDITIONS.loss * 100}% / ${CONDITIONS.duplicate * 100}% |`,
        `| wall time (join to results) | ${((Date.now() - started) / 1000).toFixed(1)} s, race ${raceSeconds.toFixed(1)} s |`,
        `| phase sequence agreement | ${new Set(phases).size === 1 ? `${phases.length}/${phases.length} clients identical` : JSON.stringify(phases)} |`,
        `| classification agreement | ${new Set(results).size === 1 ? `${results.length}/${results.length} identical` : 'DIFFERENT'}, ${rows.length} cars, rejected laps ${rejected.length}, flagged ${flagged.length ? flagged.join(', ') : 'none'} |`,
        ...(smoothers
          ? [
              `| renderer smoothing snaps / corrections | ${smoothers.map((s) => s.stats.snaps + '/' + s.stats.corrections).join(', ')} |`,
            ]
          : []),
        `| interpolation error p50 / p99 / max | ${(p50 * 100).toFixed(2)} cm / ${(p99 * 100).toFixed(2)} cm / ${(max * 100).toFixed(1)} cm (bounds ${P99_BOUND_M * 100} cm / ${MAX_BOUND_M * 100} cm) |`,
        `| worst interpolation sample | ${worstSample} |`,
        `| samples interpolated / extrapolated / held | ${pct(modes.interpolated)} / ${pct(modes.extrapolated)} / ${pct(modes.held)} of ${total} |`,
        `| interpolation delay p50 / max | ${percentile(delays, 0.5).toFixed(0)} ms / ${delays[delays.length - 1]?.toFixed(0)} ms |`,
        `| longest stall of the test process / of relayed frames | ${maxTickGap.toFixed(0)} ms / ${maxFrameGap.toFixed(0)} ms |`,
        `| member status changes seen (stale or away) | ${awayEvents} |`,
        `| snapshots dropped by the simulator | ${lost} |`,
        `| errors received by clients | ${JSON.stringify(rs.map((r) => r.of('error').map((e) => e.code)).map((codes) => Object.fromEntries([...new Set(codes)].map((c) => [c, codes.filter((x) => x === c).length]))))} |`,
        `| client status, close codes | ${rs.map((r) => `${r.client.status}${r.last('closed') ? `:${r.last('closed')!.code}` : ''}`).join(' ')} |`,
        `| snapshots sent / skipped (backpressure) per client | ${rs.map((r) => `${r.client.snapshotStats.sent}/${r.client.snapshotStats.skipped}`).join(' ')} |`,
        `| held samples by seat | ${JSON.stringify(Object.fromEntries([...heldBySeat].sort((a, b) => a[0] - b[0])))} |`,
        `| max in flight per client, up / down | ${nets.map((n) => `${Math.max(...n.links.map((l) => l.up.maxInFlight))}/${Math.max(...n.links.map((l) => l.down.maxInFlight))}`).join(' ')} |`,
        `| max in flight per direction / remote history | ${inFlight} msgs / ${maxRemoteSize} snapshots |`,
        `| bytes down per client, whole session over race time | ${(downBytes.reduce((a, b) => a + b, 0) / downBytes.length / raceSeconds / 1024).toFixed(1)} KiB/s (record ${CAR_RECORD_BYTES} B) |`,
        `| bytes up, host / guest, per race second | ${(upBytes[0]! / raceSeconds / 1024).toFixed(1)} / ${(upBytes[1]! / raceSeconds / 1024).toFixed(1)} KiB/s |`,
      );

      // Same phases, same start, same results for everyone.
      expect(phases).toEqual(
        rs.map(() => 'lobby > grid > formation > lights > racing > finished > results'),
      );
      expect(new Set(starts).size).toBe(1);
      expect(new Set(results).size).toBe(1);

      // Each car runs at its own constant speed, so the classification is known. The
      // leader (highest seat, fastest) finishes the full distance; every other car takes
      // the flag on its first crossing at or after the leader's race time, which on the
      // long run leaves the slowest cars a lap down.
      const flagMs = profile.laps * track.lapMs(HUMANS + AI - 1);
      const expected = Array.from({ length: HUMANS + AI }, (_, seat) => {
        const laps = Math.min(profile.laps, Math.ceil(flagMs / track.lapMs(seat)));
        return { seat, laps, timeMs: laps * track.lapMs(seat), status: 'finished' };
      }).sort((a, b) => b.laps - a.laps || a.timeMs - b.timeMs);
      expect(
        rows.map((r) => ({ seat: r.seat, laps: r.laps, timeMs: r.timeMs, status: r.status })),
      ).toEqual(expected);
      expect(rejected).toEqual([]);

      // Interpolation error.
      expect(errors.length).toBeGreaterThan(1000);
      expect(p99).toBeLessThan(P99_BOUND_M);
      expect(max).toBeLessThan(MAX_BOUND_M);

      // Bounded queues: remote-car history, in-flight messages, unsent reports.
      expect(maxRemoteSize).toBeLessThanOrEqual(
        DEFAULT_REMOTE_CAR_OPTIONS.capacity * (HUMANS + AI - 1),
      );
      expect(inFlight).toBeLessThan(400);
      for (const r of rs) expect(r.client.snapshotStats.queuedReports).toBe(0);
      expect(serviceErrors()).toEqual([]);
    } finally {
      if (sampler) clearInterval(sampler);
      for (const d of drivers) d.stop();
      for (const r of rs) r.client.leave();
    }
  });
});
