import type { FetchLike } from '@undercut/protocol';
import { describe, expect, it } from 'vitest';
import { OnlineSession } from '../../src/online/session';
import { FakeTimers, Rooms, memoryKv } from './loopback';

function setup() {
  const timers = new FakeTimers();
  const rooms = new Rooms(timers);
  const make = (storage = memoryKv()) => {
    const s = new OnlineSession({
      roomsUrl: 'http://game.test/rooms',
      fetch: rooms.fetch,
      transport: rooms,
      timers,
      random: () => 0.5,
      storage,
    });
    const notices: string[] = [];
    s.on('notice', (n) => notices.push(n));
    return { s, notices, storage };
  };
  return { timers, rooms, make };
}

/** Let promises from the fake fetch settle, then run the rooms for a while. */
async function settle(rooms: Rooms, ms = 500): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  rooms.run(ms);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('OnlineSession', () => {
  it('creates a room, joins it as host and turns AI fill off', async () => {
    const { rooms, make } = setup();
    const { s, storage } = make();
    const created = s.create('Ana');
    await settle(rooms);
    await created;
    await settle(rooms);
    const st = s.state;
    expect(st.status).toBe('joined');
    expect(st.code).toBe('BCDFGH');
    expect(st.isHost).toBe(true);
    expect(st.stage).toBe('lobby');
    expect(st.members.map((m) => m.name)).toEqual(['Ana']);
    expect(st.members[0]?.you).toBe(true);
    expect(st.room?.settings.aiCount).toBe(0);
    expect(storage.getItem('online.resume.BCDFGH')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('joins by code, sees both members, and the host hears about it', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const guest = make();
    void guest.s.join('bcd-fgh', 'Ben');
    await settle(rooms);
    expect(guest.s.state.status).toBe('joined');
    expect(guest.s.state.isHost).toBe(false);
    expect(guest.s.state.members.map((m) => m.name)).toEqual(['Ana', 'Ben']);
    expect(host.notices).toContain('Ben joined');
    expect(host.s.state.members.find((m) => m.name === 'Ben')?.livery.team).toBeTruthy();
  });

  it('says so when no room has the code, without opening a socket', async () => {
    const { rooms, make } = setup();
    const g = make();
    await g.s.join('ZZZZZZ', 'Ben');
    await settle(rooms);
    expect(g.s.state.ended?.reason).toBe('not_found');
    expect(rooms.conns()).toEqual([]);
  });

  it('refuses a bad name or code before going to the network', async () => {
    const { rooms, make } = setup();
    const g = make();
    await g.s.join('BCDFGH', '   ');
    expect(g.s.state.ended?.reason).toBe('name');
    await g.s.join('nope', 'Ben');
    expect(g.s.state.ended?.reason).toBe('not_found');
    expect(rooms.conns()).toEqual([]);
  });

  it('counts down when everyone is ready, then forms the grid', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const guest = make();
    void guest.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    guest.s.setReady(true);
    await settle(rooms, 200);
    expect(host.s.state.allOthersReady).toBe(true);
    host.s.setReady(true);
    await settle(rooms, 200);
    expect(host.s.state.stage).toBe('countdown');
    await settle(rooms, 4000);
    expect(host.s.state.stage).toBe('loading');
    expect(guest.s.state.stage).toBe('loading');
  });

  it('lets the host change laps; a guest cannot', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const guest = make();
    void guest.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    host.s.setLaps(4);
    await settle(rooms);
    expect(guest.s.state.room?.settings.laps).toBe(4);
    expect(guest.s.setLaps(9)).toBe(false);
  });

  it('a guest who leaves is gone for the host, and its seat token is dropped', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const guest = make();
    void guest.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    guest.s.leave();
    await settle(rooms);
    expect(guest.s.state.ended?.reason).toBe('left');
    expect(guest.storage.getItem('online.resume.BCDFGH')).toBeNull();
    expect(host.notices).toContain('Ben left');
    expect(host.s.state.members.map((m) => m.name)).toEqual(['Ana']);
  });

  it('when the host leaves, the guest becomes host', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const guest = make();
    void guest.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    host.s.leave();
    await settle(rooms);
    expect(guest.s.state.isHost).toBe(true);
    expect(guest.notices).toContain('You are now the host');
  });

  it('a kicked guest is told so', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const guest = make();
    void guest.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    const ben = host.s.state.members.find((m) => m.name === 'Ben');
    host.s.kick(ben?.id ?? '');
    await settle(rooms);
    expect(guest.s.state.ended?.reason).toBe('kicked');
  });

  it('takes the same seat back after a reload', async () => {
    const { rooms, make } = setup();
    const host = make();
    void host.s.create('Ana');
    await settle(rooms);
    const storage = memoryKv();
    const guest = make(storage);
    void guest.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    const seat = guest.s.state.seat;
    const id = guest.s.state.you;
    guest.s.dispose();
    const again = make(storage);
    void again.s.join('BCDFGH', 'Ben');
    await settle(rooms);
    expect(again.s.state.you).toBe(id);
    expect(again.s.state.seat).toBe(seat);
  });
});

describe('abandoned room requests', () => {
  it.each(['create', 'join'] as const)(
    'does not open a socket after %s then dispose',
    async (operation) => {
      const timers = new FakeTimers();
      const rooms = new Rooms(timers);
      rooms.createRoom('BCDFGH');
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let opens = 0;
      const delayed: FetchLike = async (url, init) => {
        const response = await rooms.fetch(url, init);
        await pending;
        return response;
      };
      const s = new OnlineSession({
        roomsUrl: 'http://game.test/rooms',
        fetch: delayed,
        transport: {
          open: (url, h) => {
            opens++;
            return rooms.open(url, h);
          },
        },
        timers,
        random: () => 0.5,
        storage: memoryKv(),
      });
      const request = operation === 'create' ? s.create('Ana') : s.join('BCDFGH', 'Ana');
      s.dispose();
      const changes: unknown[] = [];
      s.on('change', (state) => changes.push(state));
      release();
      await request;
      await settle(rooms);
      expect(opens).toBe(0);
      expect(changes).toEqual([]);
      expect(s.state.status).toBe('idle');
      expect(s.state.members).toEqual([]);
      expect(s.client).toBeNull();
    },
  );
});
