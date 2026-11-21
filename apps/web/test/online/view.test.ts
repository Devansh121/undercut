import { describe, expect, it } from 'vitest';
import { CLOSE, DEFAULT_SETTINGS, type MemberView, type RoomView } from '@undercut/protocol';
import { endedBy, roomNotices, stageOf } from '../../src/online/view';

function member(id: string, name: string, seat: number, over: Partial<MemberView> = {}): MemberView {
  return {
    id,
    name,
    seat,
    ready: false,
    loaded: false,
    connected: true,
    status: 'active',
    ...over,
  };
}

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    code: 'BCDFGH',
    phase: 'lobby',
    phaseEndsAt: null,
    host: 'm1',
    settings: DEFAULT_SETTINGS,
    members: [member('m1', 'Ana', 0), member('m2', 'Ben', 1)],
    aiSeats: [],
    grid: null,
    start: null,
    chequeredAt: null,
    ...over,
  };
}

describe('stageOf', () => {
  it('maps room phases onto what the game shows', () => {
    expect(stageOf(room())).toBe('lobby');
    expect(stageOf(room({ phaseEndsAt: 123 }))).toBe('countdown');
    expect(stageOf(room({ phase: 'grid' }))).toBe('loading');
    expect(stageOf(room({ phase: 'formation' }))).toBe('starting');
    expect(stageOf(room({ phase: 'lights' }))).toBe('starting');
    expect(stageOf(room({ phase: 'racing' }))).toBe('racing');
    expect(stageOf(room({ phase: 'finished' }))).toBe('racing');
    expect(stageOf(room({ phase: 'results' }))).toBe('results');
    expect(stageOf(room({ phase: 'closed' }))).toBe('closed');
  });
});

describe('endedBy', () => {
  it('explains every terminal close in plain words', () => {
    const codes = [
      CLOSE.left,
      CLOSE.kicked,
      CLOSE.resumeExpired,
      CLOSE.roomClosed,
      CLOSE.tooManyStrikes,
      CLOSE.roomFull,
      CLOSE.raceInProgress,
      CLOSE.versionMismatch,
      CLOSE.replaced,
      CLOSE.resumeInvalid,
      CLOSE.nameInvalid,
    ];
    const titles = new Set<string>();
    for (const code of codes) {
      const e = endedBy({ code, reason: '', error: null });
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.detail).not.toMatch(/!/);
      titles.add(e.reason);
    }
    expect(titles.size).toBe(codes.length);
  });

  it('names the room-full, kicked and closed cases', () => {
    expect(endedBy({ code: CLOSE.roomFull, reason: '', error: null }).reason).toBe('full');
    expect(endedBy({ code: CLOSE.kicked, reason: '', error: null }).reason).toBe('kicked');
    expect(endedBy({ code: CLOSE.tooManyStrikes, reason: '', error: null }).reason).toBe('removed');
    expect(endedBy({ code: CLOSE.roomClosed, reason: '', error: null }).reason).toBe('closed');
  });

  it('treats anything else as a lost connection', () => {
    expect(endedBy({ code: 1006, reason: '', error: null }).reason).toBe('lost');
  });
});

describe('roomNotices', () => {
  it('reports who joined and who left', () => {
    const before = room();
    const after = room({ members: [member('m1', 'Ana', 0), member('m3', 'Cy', 2)] });
    expect(roomNotices(before, after, 'm1')).toEqual(['Ben left', 'Cy joined']);
  });

  it('reports a new host, and says so when it is you', () => {
    const before = room();
    const after = room({ host: 'm2', members: [member('m2', 'Ben', 1)] });
    expect(roomNotices(before, after, 'm2')).toEqual(['Ana left', 'You are now the host']);
    expect(roomNotices(before, after, 'm9')).toEqual(['Ana left', 'Ben is now the host']);
  });

  it('reports a member dropping and coming back', () => {
    const before = room();
    const gone = room({ members: [member('m1', 'Ana', 0), member('m2', 'Ben', 1, { connected: false })] });
    expect(roomNotices(before, gone, 'm1')).toEqual(['Ben lost the connection']);
    expect(roomNotices(gone, before, 'm1')).toEqual(['Ben is back']);
  });

  it('says nothing on the first view', () => {
    expect(roomNotices(null, room(), 'm1')).toEqual([]);
  });
});
