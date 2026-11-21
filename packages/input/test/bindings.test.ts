import { describe, expect, it } from 'vitest';
import { ACTIONS, DEVICE_KINDS } from '../src/actions';
import {
  PROFILE_VERSION,
  clearBinding,
  controlsFor,
  defaultBindings,
  defaultProfile,
  deserializeProfile,
  findConflicts,
  rebind,
  serializeProfile,
} from '../src/bindings';
import { DEFAULT_KEYBOARD_SHAPING } from '../src/shaping';
import { controlLabel, deviceOfControl } from '../src/controls';

describe('default bindings', () => {
  it('bind every driving action on keyboard and gamepad, with no conflicts', () => {
    const map = defaultBindings();
    for (const device of ['keyboard', 'gamepad'] as const) {
      for (const action of ACTIONS) {
        expect(controlsFor(map, device, action).length, `${device} ${action}`).toBeGreaterThan(0);
      }
    }
    expect(findConflicts(map)).toEqual([]);
  });

  it('only use controls of their own device', () => {
    const map = defaultBindings();
    for (const device of DEVICE_KINDS) {
      for (const action of ACTIONS) {
        for (const control of controlsFor(map, device, action)) {
          expect(deviceOfControl(control)).toBe(device);
        }
      }
    }
  });

  it('use layout-independent key codes and analog triggers for the pedals', () => {
    const map = defaultBindings();
    expect(controlsFor(map, 'keyboard', 'throttle')).toEqual(['key:KeyW', 'key:ArrowUp']);
    expect(controlsFor(map, 'gamepad', 'throttle')).toEqual(['pad:b7']);
    expect(controlsFor(map, 'gamepad', 'brake')).toEqual(['pad:b6']);
    expect(controlsFor(map, 'gamepad', 'steerLeft')).toEqual(['pad:a0-']);
    expect(controlsFor(map, 'touch', 'gearUp')).toEqual(['touch:gearUp']);
  });
});

describe('findConflicts', () => {
  it('reports one control bound to two actions in the same context', () => {
    const map = defaultBindings();
    map.keyboard.drs = ['key:KeyE'];
    expect(findConflicts(map)).toEqual([
      { device: 'keyboard', context: 'driving', control: 'key:KeyE', actions: ['gearUp', 'drs'] },
    ]);
  });

  it('allows the same control in different contexts', () => {
    const map = defaultBindings();
    // Escape pauses while driving and goes back in menus.
    expect(controlsFor(map, 'keyboard', 'pause')).toContain('key:Escape');
    expect(controlsFor(map, 'keyboard', 'menuBack')).toContain('key:Escape');
    expect(findConflicts(map)).toEqual([]);
  });
});

describe('rebind', () => {
  it('sets a slot and leaves the input map untouched', () => {
    const before = defaultBindings();
    const { map, displaced } = rebind(before, 'keyboard', 'drs', 0, 'key:KeyG');
    expect(controlsFor(map, 'keyboard', 'drs')[0]).toBe('key:KeyG');
    expect(controlsFor(before, 'keyboard', 'drs')[0]).toBe('key:KeyF');
    expect(displaced).toEqual([]);
  });

  it('moves a control off the action that held it in the same context', () => {
    const { map, displaced } = rebind(defaultBindings(), 'keyboard', 'drs', 0, 'key:KeyE');
    expect(displaced).toEqual([{ action: 'gearUp', control: 'key:KeyE' }]);
    expect(controlsFor(map, 'keyboard', 'gearUp')).toEqual([]);
    expect(controlsFor(map, 'keyboard', 'drs')).toEqual(['key:KeyE']);
    expect(findConflicts(map)).toEqual([]);
  });

  it('does not displace a binding in the other context', () => {
    const { map, displaced } = rebind(defaultBindings(), 'keyboard', 'drs', 0, 'key:Enter');
    expect(displaced).toEqual([]);
    expect(controlsFor(map, 'keyboard', 'menuAccept')).toContain('key:Enter');
  });

  it('appends to the secondary slot and moves within one action without duplicates', () => {
    let map = rebind(defaultBindings(), 'keyboard', 'drs', 1, 'key:KeyH').map;
    expect(controlsFor(map, 'keyboard', 'drs')).toEqual(['key:KeyF', 'key:KeyH']);
    map = rebind(map, 'keyboard', 'drs', 0, 'key:KeyH').map;
    expect(controlsFor(map, 'keyboard', 'drs')).toEqual(['key:KeyH']);
  });

  it('rejects a control from another device', () => {
    expect(() => rebind(defaultBindings(), 'keyboard', 'drs', 0, 'pad:b0')).toThrow(/gamepad/);
  });

  it('clears a slot', () => {
    const map = clearBinding(defaultBindings(), 'keyboard', 'throttle', 0);
    expect(controlsFor(map, 'keyboard', 'throttle')).toEqual(['key:ArrowUp']);
  });
});

describe('profile serialisation', () => {
  it('round-trips bindings and shaping with a version field', () => {
    const profile = defaultProfile();
    profile.bindings = rebind(profile.bindings, 'gamepad', 'drs', 0, 'pad:b3').map;
    profile.bindings = clearBinding(profile.bindings, 'keyboard', 'lookBack', 0);
    profile.shaping.gamepad.stick.deadZone = 0.12;
    profile.shaping.drsMode = 'hold';
    const text = serializeProfile(profile);
    expect(JSON.parse(text).version).toBe(PROFILE_VERSION);
    expect(deserializeProfile(text)).toEqual({ profile, problem: null });
  });

  it('falls back to defaults for missing, corrupt or future data', () => {
    expect(deserializeProfile(null)).toEqual({ profile: defaultProfile(), problem: null });
    expect(deserializeProfile('{not json').problem).toMatch(/parse/);
    expect(deserializeProfile('{not json').profile).toEqual(defaultProfile());
    const future = deserializeProfile(JSON.stringify({ version: 99, bindings: {} }));
    expect(future.problem).toMatch(/version 99/);
    expect(future.profile).toEqual(defaultProfile());
  });

  it('drops invalid entries, fills actions added since the save, and repairs conflicts', () => {
    const saved = JSON.parse(serializeProfile(defaultProfile()));
    saved.bindings.keyboard.drs = ['key:KeyE', 'pad:b1', 42, 'key:KeyE'];
    delete saved.bindings.keyboard.resetToTrack;
    saved.bindings.keyboard.notAnAction = ['key:KeyZ'];
    saved.shaping.gamepad.stick.gamma = 'steep';
    saved.shaping.keyboard.returnRate = -4;
    const { profile } = deserializeProfile(JSON.stringify(saved));
    // KeyE stays with gear up (earlier in action order); DRS loses it.
    expect(controlsFor(profile.bindings, 'keyboard', 'drs')).toEqual([]);
    expect(controlsFor(profile.bindings, 'keyboard', 'gearUp')).toContain('key:KeyE');
    expect(controlsFor(profile.bindings, 'keyboard', 'resetToTrack')).toEqual(['key:Backspace']);
    expect(profile.shaping.gamepad.stick.gamma).toBe(1.5);
    expect(profile.shaping.keyboard.returnRate).toBe(DEFAULT_KEYBOARD_SHAPING.returnRate);
    expect(findConflicts(profile.bindings)).toEqual([]);
  });
});

describe('controlLabel', () => {
  it('names keys, pad controls and touch controls', () => {
    expect(controlLabel('key:KeyW')).toBe('W');
    expect(controlLabel('key:ArrowLeft')).toBe('Left arrow');
    expect(controlLabel('key:Digit3')).toBe('3');
    expect(controlLabel('pad:b7')).toBe('RT');
    expect(controlLabel('pad:a0-')).toBe('Left stick left');
    expect(controlLabel('pad:b20')).toBe('Button 20');
    expect(controlLabel('touch:drs')).toBe('DRS button');
  });
});
