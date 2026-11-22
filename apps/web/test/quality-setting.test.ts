import { describe, expect, it } from 'vitest';
import { autoSwitchAllowed } from '../src/game/quality-setting';

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
