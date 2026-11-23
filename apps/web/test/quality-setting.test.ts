import { describe, expect, it } from 'vitest';
import { autoSwitchAllowed, launchFallback } from '../src/game/quality-setting';

describe('Auto graphics switching', () => {
  it('moves to the benchmark pick online', () => {
    expect(autoSwitchAllowed('medium', 'mobile', true)).toBe(true);
    expect(autoSwitchAllowed('mobile', 'high', true)).toBe(true);
  });

  it('offline, only moves to the preset the offline cache holds', () => {
    expect(autoSwitchAllowed('medium', 'mobile', false)).toBe(false);
    expect(autoSwitchAllowed('high', 'medium', false)).toBe(false);
    expect(autoSwitchAllowed('mobile', 'medium', false)).toBe(true);
  });

  it('never rebuilds the view for the preset already running', () => {
    expect(autoSwitchAllowed('mobile', 'mobile', true)).toBe(false);
  });
});

describe('a preset that fails to load at the start of a session', () => {
  it('on Auto, falls back to the cached preset whatever the reason', () => {
    expect(launchFallback('medium', true, true)).toBe('mobile');
    expect(launchFallback('high', true, false)).toBe('mobile');
  });

  it('chosen by the player, falls back to the cached preset only offline', () => {
    expect(launchFallback('high', false, false)).toBe('mobile');
    expect(launchFallback('ultra', false, false)).toBe('mobile');
    // Online a failed download is worth another try: the player is asked (Try again or Back).
    expect(launchFallback('high', false, true)).toBeNull();
  });

  it('has nothing to fall back to on the cached preset itself', () => {
    expect(launchFallback('mobile', true, false)).toBeNull();
    expect(launchFallback('mobile', false, false)).toBeNull();
  });
});
