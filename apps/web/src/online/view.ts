/**
 * Plain readings of the room for the screens: which stage the game is in, why a room ended, and
 * the one-line notices worth showing when the member list changes. Pure.
 */
import { CLOSE, type ClosedEvent, type RoomView } from '@undercut/protocol';

/**
 * What the game shows for a room phase. `countdown`: everyone is ready and the grid forms when it
 * ends. `loading`: the grid is forming (each client loads the circuit). `starting`: formation and
 * start lights. `racing` includes the finish window after the chequered flag.
 */
export type Stage = 'lobby' | 'countdown' | 'loading' | 'starting' | 'racing' | 'results' | 'closed';

export function stageOf(room: RoomView): Stage {
  switch (room.phase) {
    case 'lobby':
      return room.phaseEndsAt === null ? 'lobby' : 'countdown';
    case 'grid':
      return 'loading';
    case 'formation':
    case 'lights':
      return 'starting';
    case 'racing':
    case 'finished':
      return 'racing';
    case 'results':
      return 'results';
    case 'closed':
      return 'closed';
  }
}

export type EndReason =
  | 'left'
  | 'kicked'
  | 'expired'
  | 'closed'
  | 'removed'
  | 'full'
  | 'in_progress'
  | 'version'
  | 'replaced'
  | 'resume'
  | 'name'
  | 'not_found'
  | 'lost';

export interface Ended {
  reason: EndReason;
  title: string;
  detail: string;
}

const ENDINGS: Record<EndReason, Omit<Ended, 'reason'>> = {
  left: { title: 'You left the room', detail: 'Create a room or join another with a code.' },
  kicked: { title: 'Removed by the host', detail: 'The host took you out of the room.' },
  expired: {
    title: 'Seat given up',
    detail: 'You were away too long to take your seat back.',
  },
  closed: { title: 'The room has closed', detail: 'Everyone left, or it sat empty too long.' },
  removed: {
    title: 'Removed from the room',
    detail: 'Too many messages from this game were refused by the room. Reload and join again.',
  },
  full: { title: 'The room is full', detail: 'A room takes eight players.' },
  in_progress: {
    title: 'A race is under way',
    detail: 'Rooms take new players in the lobby and at the results. Try again when it ends.',
  },
  version: {
    title: 'Different version',
    detail: 'This room runs another version of the game. Reload the page to update.',
  },
  replaced: {
    title: 'Opened in another tab',
    detail: 'Your seat in this room is now in another tab or window.',
  },
  resume: { title: 'Seat not found', detail: 'This seat is no longer in the room. Join again.' },
  name: { title: 'Name not accepted', detail: 'Use 1 to 24 letters, digits or spaces.' },
  not_found: {
    title: 'No room with that code',
    detail: 'Check the code, or ask for a new invite. Rooms close when everyone has left.',
  },
  lost: {
    title: 'Connection lost',
    detail: 'The room could not be reached. Check the network and join again.',
  },
};

const BY_CODE: Record<number, EndReason> = {
  [CLOSE.left]: 'left',
  [CLOSE.normal]: 'left',
  [CLOSE.kicked]: 'kicked',
  [CLOSE.resumeExpired]: 'expired',
  [CLOSE.roomClosed]: 'closed',
  [CLOSE.tooManyStrikes]: 'removed',
  [CLOSE.roomFull]: 'full',
  [CLOSE.raceInProgress]: 'in_progress',
  [CLOSE.versionMismatch]: 'version',
  [CLOSE.replaced]: 'replaced',
  [CLOSE.resumeInvalid]: 'resume',
  [CLOSE.nameInvalid]: 'name',
};

export function ending(reason: EndReason): Ended {
  return { reason, ...ENDINGS[reason] };
}

/** Why the room connection ended, for the screen that says so. */
export function endedBy(e: ClosedEvent): Ended {
  return ending(BY_CODE[e.code] ?? 'lost');
}

/** Notices for the change from `before` to `after`, as seen by member `me`. */
export function roomNotices(before: RoomView | null, after: RoomView, me: string | null): string[] {
  if (!before) return [];
  const out: string[] = [];
  const was = new Map(before.members.map((m) => [m.id, m]));
  const now = new Map(after.members.map((m) => [m.id, m]));
  for (const m of before.members) if (!now.has(m.id)) out.push(`${m.name} left`);
  for (const m of after.members) {
    const old = was.get(m.id);
    if (!old) out.push(`${m.name} joined`);
    else if (old.connected && !m.connected) out.push(`${m.name} lost the connection`);
    else if (!old.connected && m.connected) out.push(`${m.name} is back`);
  }
  if (after.host !== null && after.host !== before.host) {
    if (after.host === me) out.push('You are now the host');
    else {
      const name = now.get(after.host)?.name;
      if (name) out.push(`${name} is now the host`);
    }
  }
  return out;
}
