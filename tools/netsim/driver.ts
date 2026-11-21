/**
 * A headless player: drives the cars a RoomClient owns round a synthetic loop, sends
 * their snapshots through the client's 30 Hz scheduler, reports every line crossing
 * with its evidence, and marks the circuit loaded on the grid. AI handed over by a
 * host migration carries on from the lap count the server sent.
 */
import type { RoomClient, Timers, TimingMessage } from '@undercut/protocol';
import { carAt, distance, type LoopTrack } from './track';

export interface DriverOptions {
  /** Called every `stepMs`, ms. */
  stepMs?: number;
  /** Seats this driver stops reporting laps for (to script a stalled car). */
  silentSeats?: ReadonlySet<number>;
}

export class HeadlessDriver {
  private timer: unknown = null;
  private tick = 0;
  private loadedFor: unknown = null;
  /** Laps reported per seat. */
  readonly reported = new Map<number, number>();
  readonly rejections: TimingMessage[] = [];
  readonly unsubscribe: (() => void)[] = [];

  constructor(
    readonly client: RoomClient,
    readonly track: LoopTrack,
    private readonly timers: Timers,
    private readonly options: DriverOptions = {},
  ) {
    this.unsubscribe.push(
      client.on('host', (m) => {
        if (m.member !== client.me) return;
        for (const ai of m.ai)
          this.reported.set(ai.seat, Math.max(this.reported.get(ai.seat) ?? 0, ai.lap));
      }),
      client.on('timing', (m) => {
        if (m.status === 'rejected') this.rejections.push(m);
      }),
      client.on('welcome', (w) => {
        if (w.progress && client.seat !== null) {
          this.reported.set(
            client.seat,
            Math.max(this.reported.get(client.seat) ?? 0, w.progress.lap),
          );
        }
      }),
      client.on('room', (room) => {
        if (room.phase === 'lobby') this.reported.clear();
      }),
    );
  }

  start(): void {
    const step = this.options.stepMs ?? 10;
    const loop = () => {
      this.step();
      this.timer = this.timers.setTimeout(loop, step);
    };
    loop();
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    for (const u of this.unsubscribe.splice(0)) u();
  }

  step(): void {
    const c = this.client;
    const room = c.room;
    if (!room || c.status !== 'joined') return;
    if (room.phase === 'grid' && this.loadedFor !== room.grid) {
      this.loadedFor = room.grid;
      c.markLoaded();
    }
    const onTrack = ['grid', 'formation', 'lights', 'racing', 'finished'].includes(room.phase);
    const now = c.serverNow();
    if (!onTrack || now === null || !room.grid) return;
    const lightsOutAt = room.start?.lightsOutAt ?? Number.POSITIVE_INFINITY;
    const seats = c.ownedSeats();
    this.tick++;
    if (c.snapshotDue()) {
      c.sendSnapshots(seats.map((seat) => carAt(this.track, seat, now, lightsOutAt, this.tick)));
    }
    if (room.phase !== 'racing' && room.phase !== 'finished') return;
    const L = this.track.circuit.lengthM;
    for (const seat of seats) {
      if (this.options.silentSeats?.has(seat)) continue;
      const slot = room.grid.find((g) => g.seat === seat);
      if (!slot || slot.state !== 'racing') continue;
      const completed = Math.floor(distance(this.track, seat, now - lightsOutAt) / L);
      let done = this.reported.get(seat) ?? 0;
      while (done < completed && done < room.settings.laps) {
        done++;
        const lapMs = this.track.lapMs(seat);
        const third = Math.floor(lapMs / 3);
        c.reportLap({
          seat,
          lap: done,
          lapMs,
          raceMs: done * lapMs,
          sectorsMs: [third, third, lapMs - 2 * third],
          tick: this.tick,
          s: 0.1,
          speed: (L / lapMs) * 1000,
          at: lightsOutAt + done * lapMs,
        });
      }
      this.reported.set(seat, done);
    }
  }
}
