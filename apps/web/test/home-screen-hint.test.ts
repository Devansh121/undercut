import { describe, expect, it } from 'vitest';
import { needsHomeScreen } from '../src/pwa/home-screen-hint';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const env = (o: Partial<Parameters<typeof needsHomeScreen>[0]> = {}) => ({
  userAgent: IPHONE,
  platform: 'iPhone',
  maxTouchPoints: 5,
  standalone: false,
  displayMode: () => false,
  ...o,
});

describe('Add to Home Screen hint', () => {
  it('shows in an iPhone browser tab', () => {
    expect(needsHomeScreen(env())).toBe(true);
  });
  it('shows on an iPad that reports itself as a Mac', () => {
    expect(needsHomeScreen(env({ userAgent: 'Macintosh', platform: 'MacIntel' }))).toBe(true);
  });
  it('not once opened from the Home Screen', () => {
    expect(needsHomeScreen(env({ standalone: true }))).toBe(false);
    expect(needsHomeScreen(env({ displayMode: (m) => m === 'fullscreen' }))).toBe(false);
  });
  it('not on Android or a desktop, which have fullscreen or install of their own', () => {
    expect(needsHomeScreen(env({ userAgent: ANDROID, platform: 'Linux armv8l' }))).toBe(false);
    expect(
      needsHomeScreen(env({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 })),
    ).toBe(false);
  });
});
