import { DurableObject } from 'cloudflare:workers';
import {
  DEFAULT_TIMINGS,
  RoomMachine,
  normalizeRoomCode,
  parseTimings,
  type Outbound,
  type RoomEvent,
  type RoomState,
  type RoomTimings,
} from '@undercut/protocol';
import type { Env } from './env';
import { cryptoDeps } from './random';

/** Stored on each socket so it is recognised after the object wakes from hibernation. */
interface Attachment {
  conn: string;
}

const STATE_KEY = 'room';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * One room. A thin shell around the pure RoomMachine from @undercut/protocol: it turns
 * WebSocket events and alarms into machine events, sends what the machine returns,
 * persists the machine's state after control events (so a room survives eviction in
 * the lobby and results) and keeps one alarm set for the machine's next deadline.
 *
 * Sockets use the hibernation API, so an idle lobby costs nothing; while cars are on
 * track the snapshot traffic and a 500 ms alarm keep the object awake.
 */
export class Room extends DurableObject<Env> {
  private machine: RoomMachine | null = null;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly timings: RoomTimings;
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const parsed = parseTimings(env.ROOM_TIMINGS);
    if (!parsed.ok) console.error(`ROOM_TIMINGS ignored: ${parsed.detail}`);
    this.timings = parsed.ok ? parsed.value : DEFAULT_TIMINGS;
    for (const ws of ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.conn) this.sockets.set(a.conn, ws);
    }
    void ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>(STATE_KEY);
      if (saved) this.machine = RoomMachine.restore(saved, cryptoDeps, this.timings);
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const live = this.machine !== null && !this.machine.closed;
    if (pathname === '/init' && request.method === 'POST') {
      if (live) return json({ error: 'exists' }, 409);
      const body: unknown = await request.json().catch(() => null);
      const code =
        typeof body === 'object' && body !== null
          ? normalizeRoomCode((body as { code?: unknown }).code)
          : null;
      if (code === null) return json({ error: 'bad_code' }, 400);
      await this.ctx.storage.deleteAll();
      this.machine = RoomMachine.create(code, Date.now(), cryptoDeps, this.timings);
      this.alarmAt = null;
      await this.settle();
      return json(this.machine.info(), 201);
    }
    if (!live) return json({ error: 'not_found' }, 404);
    if (pathname === '/info') return json(this.machine?.info());
    if (pathname === '/ws') {
      const { 0: client, 1: server } = new WebSocketPair();
      const conn = crypto.randomUUID();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ conn } satisfies Attachment);
      this.sockets.set(conn, server);
      await this.run({ type: 'open', conn });
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: 'not_found' }, 404);
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const conn = this.connOf(ws);
    if (conn === null) return;
    await this.run(
      typeof data === 'string'
        ? { type: 'text', conn, data }
        : { type: 'binary', conn, data: new Uint8Array(data) },
    );
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // 1005 and 1006 are reserved and cannot be sent back.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closing');
    } catch {
      // Already closed.
    }
    await this.socketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.socketGone(ws);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    await this.run({ type: 'tick' });
  }

  private async socketGone(ws: WebSocket): Promise<void> {
    const conn = this.connOf(ws);
    if (conn === null) return;
    this.sockets.delete(conn);
    await this.run({ type: 'close', conn });
  }

  private connOf(ws: WebSocket): string | null {
    try {
      const a = ws.deserializeAttachment() as Attachment | null;
      return typeof a?.conn === 'string' ? a.conn : null;
    } catch {
      return null;
    }
  }

  /** Feed one event to the machine and carry out the result. Never throws. */
  private async run(event: RoomEvent): Promise<void> {
    const machine = this.machine;
    if (!machine) return;
    try {
      this.deliver(machine.handle(event, Date.now()));
      await this.settle();
    } catch (error) {
      console.error('room event failed', event.type, error);
    }
  }

  private deliver(out: Outbound[]): void {
    for (const o of out) {
      if (o.kind === 'binary') {
        for (const to of o.to) this.trySend(to, o.data);
      } else if (o.kind === 'text') {
        this.trySend(o.to, o.text);
      } else {
        const ws = this.sockets.get(o.to);
        this.sockets.delete(o.to);
        try {
          ws?.close(o.code, o.reason);
        } catch {
          // Already closed.
        }
      }
    }
  }

  private trySend(conn: string, data: string | Uint8Array): void {
    const ws = this.sockets.get(conn);
    if (!ws) return;
    try {
      ws.send(data);
    } catch {
      // Closing; the close event will follow.
    }
  }

  /** Persist after control events and keep the alarm at the machine's next deadline. */
  private async settle(): Promise<void> {
    const machine = this.machine;
    if (!machine) return;
    if (machine.closed) {
      this.machine = null;
      this.alarmAt = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    if (machine.takeDirty()) await this.ctx.storage.put(STATE_KEY, machine.state);
    const next = machine.nextWakeAt();
    const now = Date.now();
    if (next === null) {
      if (this.alarmAt !== null) {
        this.alarmAt = null;
        await this.ctx.storage.deleteAlarm();
      }
    } else if (this.alarmAt === null || next < this.alarmAt || this.alarmAt <= now) {
      // An earlier alarm than needed only costs an extra tick, so later deadlines
      // do not move it: that keeps snapshot traffic from writing the alarm.
      this.alarmAt = next;
      await this.ctx.storage.setAlarm(next);
    }
  }
}
