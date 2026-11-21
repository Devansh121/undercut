/** Regression tests for the PR #12 review, against the real service. */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { LIMITS } from '@undercut/protocol';
import { HeadlessDriver } from '../../../tools/netsim/driver';
import { realTimers } from '../../../tools/netsim/node';
import { carAt, loopTrack } from '../../../tools/netsim/track';
import { Recorder, base, createRoom, joined, serviceErrors, until, untilResults } from './headless';

const track = loopTrack(450);
const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

afterAll(() => {
  expect(serviceErrors()).toEqual([]);
});

function later(r: Recorder): Recorder {
  cleanup.push(() => r.client.leave());
  return r;
}

async function racing(names: string[], drive: boolean[]) {
  const code = await createRoom();
  const rs = names.map((n) => later(new Recorder(code, n)));
  await joined(...rs);
  rs[0]!.client.changeSettings({ circuit: track.circuit, laps: 3, aiCount: 2, gridOrder: 'join' });
  await until('settings', () => rs.every((r) => r.client.room?.settings.laps === 3));
  const drivers = rs.map((r, i) => {
    const d = new HeadlessDriver(r.client, track, realTimers);
    if (drive[i]) d.start();
    cleanup.push(() => d.stop());
    return d;
  });
  for (const r of rs) r.client.setReady(true);
  // A non-driving client still loads the circuit.
  await until('grid', () => rs.every((r) => r.client.room?.phase !== 'lobby'));
  rs.forEach((r, i) => !drive[i] && r.client.markLoaded());
  await until('racing', () => rs.every((r) => r.client.room?.phase === 'racing'), 10_000);
  return { code, rs, drivers };
}

describe('review findings on the local Workers runtime', () => {
  it('rejects a three-lap finish claimed just after lights out (finding 1)', async () => {
    const { rs } = await racing(['Ana', 'Ben'], [true, false]);
    const b = rs[1]!;
    const room = b.client.room!;
    const out = room.start!.lightsOutAt;
    const now = b.client.serverNow()!;
    const fake = { ...carAt(track, 1, now, out, 1), lap: 3, s: 1 };
    b.client.sendSnapshots([fake]);
    for (let lap = 1; lap <= 3; lap++) {
      b.client.reportLap({
        seat: 1,
        lap,
        lapMs: 5000,
        raceMs: lap * 5000,
        tick: lap,
        s: 1,
        speed: 80,
        at: now,
      });
    }
    await until('verdicts', () => b.of('timing').filter((t) => t.seat === 1).length === 3);
    expect(
      b
        .of('timing')
        .filter((t) => t.seat === 1)
        .map((t) => [t.status, t.reason]),
    ).toEqual([
      ['rejected', 'ahead_of_race_clock'],
      ['rejected', 'ahead_of_race_clock'],
      ['rejected', 'ahead_of_race_clock'],
    ]);
    expect(b.client.room?.phase).toBe('racing');
    expect(b.client.room?.chequeredAt).toBeNull();
  });

  it('hands the AI to a guest when a retired host goes silent but keeps its socket (finding 3)', async () => {
    const { rs, drivers } = await racing(['Ana', 'Ben'], [true, true]);
    const [a, b] = rs as [Recorder, Recorder];
    await new Promise((r) => setTimeout(r, 500));
    a.client.retire(0);
    drivers[0]!.stop(); // the tab is hidden: no snapshots, but the socket and its pings live on
    await until('new host', () => b.of('host').some((h) => h.member === b.client.me), 10_000);
    expect(a.client.status).toBe('joined');
    expect(b.client.ownedSeats()).toEqual([1, 2, 3]);
    await untilResults([b], drivers);
    const rows = b.last('results')!.results.rows;
    for (const seat of [1, 2, 3])
      expect(rows.find((r) => r.seat === seat)).toMatchObject({ status: 'finished', laps: 3 });
  });

  it('bounds unjoined sockets per address and per room (finding 5)', async () => {
    const code = await createRoom();
    const url = `${base.replace(/^http/, 'ws')}/rooms/${code}/ws`;
    const open = (address: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url, { headers: { 'cf-connecting-ip': address } });
        cleanup.push(() => ws.terminate());
        ws.once('open', () => resolve(101));
        ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.once('error', () => resolve(0));
      });
    const one: number[] = [];
    for (let i = 0; i < 10; i++) one.push(await open('flood-a'));
    expect(one.filter((s) => s === 101)).toHaveLength(LIMITS.pendingPerAddress);
    expect(one.slice(LIMITS.pendingPerAddress).every((s) => s === 429)).toBe(true);
    let accepted = LIMITS.pendingPerAddress;
    for (let i = 0; i < 40; i++) if ((await open(`flood-${i}`)) === 101) accepted++;
    expect(accepted).toBe(LIMITS.pendingPerRoom);
    // Room creation and health are unaffected; the room stays usable once pending sockets time out.
    expect((await fetch(`${base}/rooms/${code}`)).status).toBe(200);
  });
});
