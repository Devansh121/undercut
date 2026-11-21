/** Helpers for runtime tests: headless clients against the real service. */
import fs from 'node:fs';
import { inject } from 'vitest';
import {
  RoomClient,
  roomSocketUrl,
  type RoomClientEvents,
  type RoomClientOptions,
  type ServerMessage,
} from '@undercut/protocol';
import type { HeadlessDriver } from '../../../tools/netsim/driver';
import { realTimers, wsTransport } from '../../../tools/netsim/node';
import './context';

export const base = inject('roomsUrl');
export const roomsUrl = `${base}/rooms`;

let addressNo = 0;

/**
 * Create a room. Each call comes from its own client address unless one is given, so
 * tests running in parallel never share a creation limit.
 */
export async function createRoom(
  address = `test-${process.pid}-${Date.now()}-${addressNo++}`,
): Promise<string> {
  const res = await fetch(roomsUrl, {
    method: 'POST',
    headers: { 'cf-connecting-ip': address },
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  const body = (await res.json()) as { code: string };
  return body.code;
}

/** A RoomClient that also records every event it emits, in order. */
export class Recorder {
  readonly client: RoomClient;
  readonly events: { type: keyof RoomClientEvents; value: unknown }[] = [];

  constructor(code: string, name: string, extra: Partial<RoomClientOptions> = {}) {
    this.client = new RoomClient({
      url: roomSocketUrl(roomsUrl, code),
      name,
      transport: wsTransport,
      timers: realTimers,
      random: Math.random,
      ...extra,
    });
    const types: (keyof RoomClientEvents)[] = [
      'status',
      'welcome',
      'room',
      'start',
      'timing',
      'penalty',
      'limits',
      'pit',
      'host',
      'results',
      'error',
      'closed',
    ];
    for (const type of types) {
      this.client.on(type, (value: unknown) => this.events.push({ type, value }));
    }
  }

  of<K extends keyof RoomClientEvents>(type: K): RoomClientEvents[K][] {
    return this.events.filter((e) => e.type === type).map((e) => e.value as RoomClientEvents[K]);
  }

  last<K extends keyof RoomClientEvents>(type: K): RoomClientEvents[K] | undefined {
    const all = this.of(type);
    return all[all.length - 1];
  }
}

export async function until(
  what: string,
  predicate: () => boolean,
  ms = 10_000,
  stepMs = 10,
  explain?: () => string,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}${explain ? `: ${explain()}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** What a stuck race looks like from the clients: for timeout messages. */
export function raceState(rs: Recorder[], drivers: HeadlessDriver[]): string {
  const room = rs[0]?.client.room;
  return JSON.stringify({
    phase: room?.phase,
    chequeredAt: room?.chequeredAt,
    lightsOutAt: room?.start?.lightsOutAt,
    grid: room?.grid?.map((g) => `${g.seat}:${g.kind}:${g.state}`),
    reported: drivers.map((d) => Object.fromEntries(d.reported)),
    rejected: drivers.flatMap((d) =>
      d.rejections.map((t) => `${t.seat}/${t.lap}/${t.raceMs}:${t.reason}`),
    ),
    timing: rs.map((r) => r.of('timing').length),
    status: rs.map((r) => r.client.status),
    clock: rs.map((r) => {
      const c = r.client.clock;
      return { offset: c.offset, error: c.error, rtt: c.rtt };
    }),
    host: room?.host,
    members: room?.members.map((m) => `${m.id}:${m.status}:${m.connected}`),
  });
}

/** Wait for every recorder to have the results, explaining the race if they never come. */
export async function untilResults(rs: Recorder[], drivers: HeadlessDriver[], ms = 40_000) {
  await until(
    'results',
    () => rs.every((r) => r.of('results').length > 0 && r.client.room?.phase === 'results'),
    ms,
    20,
    () => raceState(rs, drivers),
  );
}

/** Connect in the order given (join order decides seats and the host). */
export async function joined(...rs: Recorder[]): Promise<void> {
  for (const r of rs) {
    r.client.connect();
    await until('joined', () => r.client.status === 'joined');
  }
  // Let the clock estimates warm up.
  await until('clock samples', () => rs.every((r) => r.client.clock.sampleCount >= 6), 5000);
}

/** Lines in the service log that mean something went wrong inside the service. */
export function serviceErrors(): string[] {
  const text = fs.readFileSync(inject('roomsLog'), 'utf8');
  return text.split('\n').filter((line) => /ERROR|Uncaught|exception/i.test(line));
}

export type { ServerMessage };
