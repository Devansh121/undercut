import { describe, expect, it } from 'vitest';
import { NoticeQueue } from '../src/game/notices';

describe('NoticeQueue', () => {
  it('shows queued notices one after another, in the order they were queued', () => {
    const q = new NoticeQueue<string>();
    q.say('storage', 5);
    q.queue('offline', 6);
    q.queue('hint', 6);
    const seen: (string | null)[] = [];
    for (let t = 0; t < 20; t++) {
      seen.push(q.current);
      q.tick(1);
    }
    expect(seen.slice(0, 5)).toEqual(Array(5).fill('storage'));
    expect(seen.slice(5, 11)).toEqual(Array(6).fill('offline'));
    expect(seen.slice(11, 17)).toEqual(Array(6).fill('hint'));
    expect(seen.slice(17)).toEqual([null, null, null]);
  });

  it('shows a queued notice at once when nothing is up', () => {
    const q = new NoticeQueue<string>();
    q.queue('hint', 6);
    expect(q.current).toBe('hint');
  });

  it('lets say() interrupt the current notice without dropping the queue', () => {
    const q = new NoticeQueue<string>();
    q.say('storage', 5);
    q.queue('hint', 6);
    q.say('record kept', 4);
    expect(q.current).toBe('record kept');
    q.tick(4);
    expect(q.current).toBe('hint');
  });

  it('clear() drops the current notice and everything waiting', () => {
    const q = new NoticeQueue<string>();
    q.say('storage', 5);
    q.queue('hint', 6);
    q.clear();
    q.tick(1);
    expect(q.current).toBeNull();
  });
});
