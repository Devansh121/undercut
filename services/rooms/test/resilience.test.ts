import { afterAll, afterEach, describe, expect, inject, it } from 'vitest';
import { CLOSE } from '@undercut/protocol';
import { HeadlessDriver } from '../../../tools/netsim/driver';
import { realTimers } from '../../../tools/netsim/node';
import { loopTrack } from '../../../tools/netsim/track';
import { Recorder, createRoom, joined, serviceErrors, until } from './headless';

const timings = inject('roomTimings');
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

function drive(r: Recorder): HeadlessDriver {
  const d = new HeadlessDriver(r.client, track, realTimers);
  d.start();
  cleanup.push(() => d.stop());
  return d;
}

async function raceWith(names: string[], laps: number) {
  const code = await createRoom();
  const rs = names.map((n) => later(new Recorder(code, n)));
  await joined(...rs);
  const host = rs[0]!;
  host.client.changeSettings({ circuit: track.circuit, laps, aiCount: 2, gridOrder: 'join' });
  await until('settings', () => rs.every((r) => r.client.room?.settings.laps === laps));
  const drivers = rs.map(drive);
  for (const r of rs) r.client.setReady(true);
  await until('racing', () => rs.every((r) => r.client.room?.phase === 'racing'), 10_000);
  return { code, rs, drivers };
}

describe('leaving, reconnecting and host migration', () => {
  it('frees a guest seat in the lobby when the guest leaves', async () => {
    const code = await createRoom();
    const a = later(new Recorder(code, 'Ana'));
    const b = new Recorder(code, 'Ben');
    await joined(a, b);
    b.client.leave();
    await until('one member', () => a.client.room?.members.length === 1);
    expect(b.client.status).toBe('closed');
    const c = later(new Recorder(code, 'Cy'));
    await joined(c);
    expect(c.client.seat).toBe(1);
  });

  it('migrates the host mid-race and hands over the AI, and the race finishes', async () => {
    const { rs, drivers } = await raceWith(['Ana', 'Ben', 'Cy'], 2);
    const [a, b, c] = rs as [Recorder, Recorder, Recorder];
    await new Promise((r) => setTimeout(r, 2500));
    drivers[0]!.stop();
    a.client.leave();
    await until('new host', () => b.of('host').some((h) => h.member === b.client.me));
    const handover = b.of('host').find((h) => h.member === b.client.me)!;
    expect(handover.ai.map((x) => x.seat)).toEqual([3, 4]);
    for (const ai of handover.ai) {
      expect(ai.car).not.toBeNull();
      expect(ai.car!.seat).toBe(ai.seat);
      expect(ai.state).toBe('racing');
    }
    expect(b.client.ownedSeats()).toEqual([1, 3, 4]);
    expect(c.client.room?.host).toBe(b.client.me);

    await until('results', () => b.of('results').length > 0 && c.of('results').length > 0, 40_000);
    const rb = b.last('results')!;
    expect(JSON.stringify(c.last('results'))).toBe(JSON.stringify(rb));
    const byseat = new Map(rb.results.rows.map((r) => [r.seat, r]));
    expect(byseat.get(0)).toMatchObject({ status: 'dnf', name: 'Ana' });
    for (const seat of [1, 2, 3, 4])
      expect(byseat.get(seat)).toMatchObject({ status: 'finished', laps: 2 });
    expect(rb.results.rows.at(-1)?.seat).toBe(0);
  });

  it('resumes the same seat after a drop mid-race and finishes', async () => {
    const { rs } = await raceWith(['Ana', 'Ben'], 2);
    const [a, b] = rs as [Recorder, Recorder];
    await new Promise((r) => setTimeout(r, 1500));
    const token = b.client.resumeToken;
    b.client.dropConnection();
    await until('reconnected', () => b.of('status').filter((s) => s === 'joined').length === 2);
    expect(b.of('status')).toEqual(['connecting', 'joined', 'reconnecting', 'joined']);
    expect(b.client.seat).toBe(1);
    expect(b.client.me).toBe('m2');
    expect(b.client.resumeToken).toBe(token);
    const welcome = b.last('welcome')!;
    expect(welcome.progress).not.toBeNull();
    await until('results', () => a.of('results').length > 0, 40_000);
    const row = a.last('results')!.results.rows.find((r) => r.seat === 1)!;
    expect(row).toMatchObject({ status: 'finished', laps: 2 });
  });

  it('refuses to resume after the grace period', async () => {
    const code = await createRoom();
    const a = later(new Recorder(code, 'Ana'));
    const b = new Recorder(code, 'Ben', { backoff: { maxAttempts: 0 } });
    await joined(a, b);
    const token = b.client.resumeToken!;
    b.client.dropConnection();
    await until('b closed', () => b.client.status === 'closed');
    await until(
      'b away',
      () => a.client.room?.members.find((m) => m.name === 'Ben')?.connected === false,
    );
    await new Promise((r) => setTimeout(r, (timings.graceMs ?? 0) + 500));
    await until('seat given up', () => a.client.room?.members.length === 1);
    const back = new Recorder(code, 'Ben', { resume: token });
    back.client.connect();
    await until('refused', () => back.client.status === 'closed');
    expect(back.last('closed')).toMatchObject({
      code: CLOSE.resumeExpired,
      error: { code: 'resume_expired' },
    });
  });
});
