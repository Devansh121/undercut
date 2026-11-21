import { describe, expect, it } from 'vitest';
import { contactShadowOpacity } from '../src/car/contact-shadows';
import { QUALITY } from '../src/quality';

describe('contact shadows', () => {
  it('High in daylight relies on the cascaded sun shadows: none', () => {
    expect(contactShadowOpacity(QUALITY.high, true)).toBe(0);
    expect(contactShadowOpacity(QUALITY.ultra, true)).toBe(0);
  });

  it('any preset without a shadow-casting key light (night, sun off) gets a full contact shadow', () => {
    for (const q of [QUALITY.ultra, QUALITY.high, QUALITY.medium, QUALITY.mobile, QUALITY.lite]) {
      expect(contactShadowOpacity(q, false)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('Mobile keeps a lighter one under its short shadow cascade', () => {
    const o = contactShadowOpacity(QUALITY.mobile, true);
    expect(o).toBeGreaterThan(0);
    expect(o).toBeLessThan(0.6);
  });
});
