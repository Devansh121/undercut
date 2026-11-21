import { describe, expect, it } from 'vitest';
import { resolveRoomsUrl } from '../src/settings';

describe('resolveRoomsUrl', () => {
  it('defaults to same-origin /rooms', () => {
    expect(resolveRoomsUrl('http://192.168.1.20:5173/', undefined)).toBe(
      'http://192.168.1.20:5173/rooms',
    );
    expect(resolveRoomsUrl('https://example.test/play/index.html', '')).toBe(
      'https://example.test/rooms',
    );
  });

  it('accepts an absolute override', () => {
    expect(resolveRoomsUrl('https://example.test/', 'https://rooms.example.test/rooms/')).toBe(
      'https://rooms.example.test/rooms',
    );
  });

  it('resolves a relative override against the page', () => {
    expect(resolveRoomsUrl('https://example.test/game/', '/api/rooms')).toBe(
      'https://example.test/api/rooms',
    );
  });
});

describe('room sockets', () => {
  it('are not built here: the protocol library owns the path (/rooms/<code>/ws)', async () => {
    const settings: Record<string, unknown> = await import('../src/settings');
    expect(settings.roomSocketUrl).toBeUndefined();
  });
});
