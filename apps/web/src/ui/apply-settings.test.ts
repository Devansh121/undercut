import { describe, expect, it } from 'vitest';
import { applyPlayerSettings, type SettingsTarget } from './apply-settings';
import { defaultPrefs } from './data/prefs';

function target(): SettingsTarget & { props: Record<string, string> } {
  const props: Record<string, string> = {};
  return {
    dataset: {},
    props,
    style: { setProperty: (k, v) => void (props[k] = v) },
  };
}

describe('applying the player settings to the page', () => {
  it('sets nothing but the HUD scale for the defaults', () => {
    const t = target();
    applyPlayerSettings(defaultPrefs().settings, t);
    expect(t.dataset).toEqual({});
    expect(t.props).toEqual({ '--hud-scale': '1' });
  });

  it('marks each choice, and clears it again when turned off', () => {
    const t = target();
    const s = {
      ...defaultPrefs().settings,
      colourBlind: true,
      reducedMotion: 'on' as const,
      textSize: 'larger' as const,
      touchLayout: 'mirrored' as const,
      hudScale: 0.85,
    };
    applyPlayerSettings(s, t);
    expect(t.dataset).toEqual({
      cb: 'on',
      motion: 'reduce',
      text: 'larger',
      touchLayout: 'mirrored',
    });
    expect(t.props['--hud-scale']).toBe('0.85');
    applyPlayerSettings(defaultPrefs().settings, t);
    expect(t.dataset).toEqual({});
  });
});
