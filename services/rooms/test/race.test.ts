import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { HeadlessDriver } from '../../../tools/netsim/driver';
import { realTimers } from '../../../tools/netsim/node';
import { loopTrack } from '../../../tools/netsim/track';
import { Recorder, createRoom, joined, roomsUrl, serviceErrors, until } from './headless';

const track = loopTrack(450);
const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

afterAll(() => {
  expect(serviceErrors()).toEqual([]);
});

function drive(...rs: Recorder[]): HeadlessDriver[] {
  return rs.map((r) => {
    const d = new HeadlessDriver(r.client, track, realTimers);
    d.start();
    cleanup.push(
      () => d.stop(),
      () => r.client.leave(),
    );
    return d;
  });
}

describe('a race on the local Workers runtime', () => {
  it('joins by code, starts in sync, fans out snapshots, classifies identically and rematches', async () => {
    const code = await createRoom();
    const a = new Recorder(code, 'Ana');
    // Join by the code as typed, in lower case.
    const b = new Recorder(code.toLowerCase(), 'Ben');
    await joined(a, b);
    expect(a.client.isHost).toBe(true);
    expect(b.client.seat).toBe(1);

    a.client.changeSettings({ circuit: track.circuit, laps: 3, aiCount: 2, gridOrder: 'join' });
    await until('settings', () => b.client.room?.settings.laps === 3);
    const drivers = drive(a, b);
    a.client.setReady(true);
    b.client.setReady(true);

    // Synchronised start: one schedule, and both clients put lights out at the same
    // local instant within their clock-sync error bounds.
    await until('start', () => a.of('start').length > 0 && b.of('start').length > 0);
    const [sa, sb] = [a.last('start')!, b.last('start')!];
    expect(sb).toEqual(sa);
    const la = a.client.localTimeOf(sa.lightsOutAt)!;
    const lb = b.client.localTimeOf(sb.lightsOutAt)!;
    const bound = a.client.clock.error! + b.client.clock.error!;
    expect(Math.abs(la - lb)).toBeLessThanOrEqual(bound);
    const hold = sa.lightsOutAt - sa.lightsStartAt - (sa.lightCount - 1) * sa.lightIntervalMs;
    expect(hold).toBeGreaterThanOrEqual(100);
    expect(hold).toBeLessThanOrEqual(400);

    // Snapshots fan out: each sees every car the other drives.
    await until(
      'remote cars',
      () =>
        a.client.remoteCars.seatList.join() === '1' &&
        b.client.remoteCars.seatList.join() === '0,2,3',
    );
    await until('racing', () => a.client.room?.phase === 'racing');
    const info = (await (await fetch(`${roomsUrl}/${code}`)).json()) as { joinable: boolean };
    expect(info.joinable).toBe(false);

    await until('results', () => a.of('results').length > 0 && b.of('results').length > 0, 40_000);
    const ra = a.last('results')!;
    const rb = b.last('results')!;
    expect(JSON.stringify(rb)).toBe(JSON.stringify(ra));
    expect(ra.results.reason).toBe('complete');
    // Faster seats lap quicker: seat 3 wins, then 2, 1, 0; every car ran three laps.
    expect(ra.results.rows.map((r) => [r.seat, r.kind, r.status, r.laps])).toEqual([
      [3, 'ai', 'finished', 3],
      [2, 'ai', 'finished', 3],
      [1, 'human', 'finished', 3],
      [0, 'human', 'finished', 3],
    ]);
    for (const row of ra.results.rows) {
      expect(row.timeMs).toBe(3 * track.lapMs(row.seat));
      expect(row.bestLapMs).toBe(track.lapMs(row.seat));
      expect(row.flags).toEqual([]);
    }
    expect(drivers.flatMap((d) => d.rejections)).toEqual([]);

    // Rematch: back to the lobby with the same members and settings, nobody ready.
    a.client.rematch();
    await until('lobby', () => b.client.room?.phase === 'lobby');
    const room = b.client.room!;
    expect(room.members.map((m) => [m.name, m.seat, m.ready])).toEqual([
      ['Ana', 0, false],
      ['Ben', 1, false],
    ]);
    expect(room.settings.laps).toBe(3);
    expect(room.settings.circuit).toEqual(track.circuit);
  });
});
