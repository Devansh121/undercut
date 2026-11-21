import { describe, expect, it } from 'vitest';
import { parseCreateLimit, slide } from '../src/window';

describe('slide (the creation limiter window)', () => {
  it('allows up to the limit inside the window, then refuses without recording', () => {
    let stamps: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = slide(stamps, 1000 + i, 3, 60_000);
      expect(r.allowed).toBe(true);
      stamps = r.stamps;
    }
    const refused = slide(stamps, 2000, 3, 60_000);
    expect(refused).toEqual({ allowed: false, stamps: [1000, 1001, 1002], changed: false });
  });

  it('forgets attempts older than the window', () => {
    const r = slide([0, 10, 59_999], 60_010, 3, 60_000);
    expect(r).toEqual({ allowed: true, stamps: [59_999, 60_010], changed: true });
  });

  it('drops corrupt stored values instead of throwing', () => {
    const r = slide(['x', null, 5] as unknown as number[], 10, 1, 60_000);
    expect(r).toEqual({ allowed: false, stamps: [5], changed: true });
  });
});

describe('parseCreateLimit', () => {
  it('reads count/windowMs and falls back to the default', () => {
    expect(parseCreateLimit('10/600000')).toEqual({ limit: 10, windowMs: 600_000 });
    expect(parseCreateLimit(undefined)).toEqual({ limit: 30, windowMs: 600_000 });
    expect(parseCreateLimit('nonsense')).toEqual({ limit: 30, windowMs: 600_000 });
  });

  it('can have no default, for the optional global limit', () => {
    expect(parseCreateLimit(undefined, null)).toBeNull();
    expect(parseCreateLimit('', null)).toBeNull();
    expect(parseCreateLimit('10/0', null)).toBeNull();
    expect(parseCreateLimit('0/60000', null)).toEqual({ limit: 0, windowMs: 60_000 });
    expect(parseCreateLimit('60/3600000', null)).toEqual({ limit: 60, windowMs: 3_600_000 });
  });
});
