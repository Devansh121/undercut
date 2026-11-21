import { describe, expect, it } from 'vitest';
import { GAME_NAME } from '../src/index';

describe('GAME_NAME', () => {
  it('is a non-empty display string', () => {
    expect(typeof GAME_NAME).toBe('string');
    expect(GAME_NAME.trim().length).toBeGreaterThan(0);
  });
});
