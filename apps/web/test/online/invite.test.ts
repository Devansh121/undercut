import { describe, expect, it } from 'vitest';
import { codeFromUrl, displayCode, inviteLink, networkOrigin } from '../../src/online/invite';
import { seatLivery } from '../../src/online/liveries';

describe('invite links', () => {
  it('reads the room code in any case or with a dash', () => {
    expect(codeFromUrl('http://h/?room=bcd-fgh')).toBe('BCDFGH');
    expect(codeFromUrl('http://h/?room=BCDFGH&debug=1')).toBe('BCDFGH');
    expect(codeFromUrl('http://h/?room=AEIOU1')).toBeNull();
    expect(codeFromUrl('http://h/')).toBeNull();
  });

  it('builds the link on the same origin and drops other parameters', () => {
    expect(inviteLink('http://10.0.0.5:5173/?debug=1#x', 'BCDFGH')).toBe(
      'http://10.0.0.5:5173/?room=BCDFGH',
    );
    expect(inviteLink('http://localhost:5173/', 'BCDFGH', 'http://192.168.1.4:5173')).toBe(
      'http://192.168.1.4:5173/?room=BCDFGH',
    );
  });

  it('shows the code in two halves', () => {
    expect(displayCode('BCDFGH')).toBe('BCD-FGH');
  });

  it('offers the network address unless the page is already on it', () => {
    const lan = ['http://192.168.1.4:5173', 'https://192.168.1.4:5174'];
    expect(networkOrigin('http://localhost:5173/', lan)).toBe('http://192.168.1.4:5173');
    expect(networkOrigin('https://localhost:5174/', lan)).toBe('https://192.168.1.4:5174');
    expect(networkOrigin('http://192.168.1.4:5173/', lan)).toBeNull();
    expect(networkOrigin('http://localhost:5173/', [])).toBeNull();
  });
});

describe('seatLivery', () => {
  it('gives the eight human seats eight different teams', () => {
    const teams = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((s) => seatLivery(s).team));
    expect(teams.size).toBe(8);
  });

  it('gives every seat of a full grid its own number', () => {
    const numbers = new Set(Array.from({ length: 20 }, (_, s) => seatLivery(s).number));
    expect(numbers.size).toBe(20);
  });
});
