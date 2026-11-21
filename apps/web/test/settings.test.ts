import { describe, expect, it } from 'vitest';
import { resolveRoomsUrl, roomSocketUrl } from '../src/settings';

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

describe('roomSocketUrl', () => {
  it('maps http to ws and https to wss', () => {
    expect(roomSocketUrl('http://10.0.0.2:5173/rooms', 'abc')).toBe('ws://10.0.0.2:5173/rooms/abc');
    expect(roomSocketUrl('https://example.test/rooms', 'abc')).toBe('wss://example.test/rooms/abc');
  });

  it('escapes the room id', () => {
    expect(roomSocketUrl('https://example.test/rooms', 'a b')).toBe(
      'wss://example.test/rooms/a%20b',
    );
  });
});
