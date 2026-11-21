import { describe, expect, it } from 'vitest';
import { defaultProfile, rebind } from '../src/bindings';
import { applyAxisCurve, DEFAULT_GAMEPAD_SHAPING, DEFAULT_KEYBOARD_SHAPING } from '../src/shaping';
import { InputSystem, type InputEvent } from '../src/system';
import { FakePads } from './fakes';

const DT = 1 / 120;

function setup(options: { touch?: boolean } = {}) {
  const pads = new FakePads();
  const input = new InputSystem({ readGamepads: pads.read, touchCapable: options.touch ?? false });
  if (options.touch) {
    input.touch.setLayout({
      steer: { left: 0, top: 200, width: 200, height: 190 },
      throttle: { left: 760, top: 210, width: 76, height: 172 },
      brake: { left: 674, top: 232, width: 76, height: 150 },
      buttons: {
        gearUp: { left: 210, top: 280, width: 48, height: 48 },
        gearDown: { left: 210, top: 334, width: 48, height: 48 },
        drs: { left: 610, top: 280, width: 56, height: 48 },
        overtake: { left: 610, top: 334, width: 56, height: 48 },
        camera: { left: 650, top: 12, width: 48, height: 48 },
        pause: { left: 650, top: 68, width: 48, height: 48 },
      },
    });
  }
  return { input, pads };
}

function actions(events: readonly InputEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'action' ? [e.action] : []));
}

describe('keyboard', () => {
  it('ramps throttle up and back down at the keyboard rates', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyW');
    expect(input.sample(0.1, 0).control.throttle).toBeCloseTo(0.5, 12);
    expect(input.sample(0.1, 0).control.throttle).toBe(1);
    input.keyboard.keyUp('KeyW');
    expect(input.sample(0.05, 0).control.throttle).toBeCloseTo(0.5, 12);
    expect(input.sample(0.05, 0).control.throttle).toBe(0);
  });

  it('steers left positive, narrowing lock with speed and returning faster', () => {
    const { input } = setup();
    const s = DEFAULT_KEYBOARD_SHAPING;
    input.keyboard.keyDown('KeyA');
    expect(input.sample(0.1, 0).control.steer).toBeCloseTo(s.steerRate * 0.1, 12);
    for (let i = 0; i < 20; i++) input.sample(0.1, 0);
    expect(input.sample(0.1, 0).control.steer).toBe(1);
    // At high speed a held key asks for much less lock.
    for (let i = 0; i < 20; i++) input.sample(0.1, s.highSpeed);
    expect(input.sample(0.1, s.highSpeed).control.steer).toBeCloseTo(s.lockAtHighSpeed, 12);
    input.keyboard.keyUp('KeyA');
    input.keyboard.keyDown('KeyD');
    // From 0.3 toward -0.3: centre in 0.3 / 8 s, then out at the high-speed rate.
    const t = 0.3 / s.returnRate;
    expect(input.sample(t + 0.05, s.highSpeed).control.steer).toBeCloseTo(
      -s.steerRateAtHighSpeed * 0.05,
      12,
    );
  });

  it('cancels opposite keys', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyA');
    input.keyboard.keyDown('KeyD');
    expect(input.sample(0.1, 0).control.steer).toBe(0);
  });

  it('releases everything when focus is lost', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyW');
    input.keyboard.keyDown('KeyA');
    input.sample(0.5, 0);
    input.keyboard.releaseAll();
    const frame = input.sample(0.5, 0);
    expect(frame.control.throttle).toBe(0);
    expect(frame.control.steer).toBe(0);
  });
});

describe('edge latching', () => {
  it('raises gearShift for exactly one tick per press while the key is held', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyE');
    const shifts = Array.from({ length: 10 }, () => input.sample(DT, 0).control.gearShift);
    expect(shifts).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('ignores key repeat', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyE');
    input.sample(DT, 0);
    input.keyboard.keyDown('KeyE', true);
    input.keyboard.keyDown('KeyE', true);
    expect(input.sample(DT, 0).control.gearShift).toBe(0);
  });

  it('keeps a press and release that both happen between two ticks', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyQ');
    input.keyboard.keyUp('KeyQ');
    expect(input.sample(DT, 0).control.gearShift).toBe(-1);
    expect(input.sample(DT, 0).control.gearShift).toBe(0);
  });

  it('delivers several presses between ticks one tick each, in order', () => {
    const { input } = setup();
    for (const code of ['KeyE', 'KeyE', 'KeyQ']) {
      input.keyboard.keyDown(code);
      input.keyboard.keyUp(code);
    }
    const shifts = Array.from({ length: 5 }, () => input.sample(DT, 0).control.gearShift);
    expect(shifts).toEqual([1, 1, -1, 0, 0]);
  });

  it('latches gamepad buttons on the poll edge', () => {
    const { input, pads } = setup();
    pads.connect();
    pads.button(5, 1);
    expect(input.sample(DT, 0).control.gearShift).toBe(1);
    expect(input.sample(DT, 0).control.gearShift).toBe(0);
    pads.button(5, 0);
    input.sample(DT, 0);
    pads.button(5, 1);
    expect(input.sample(DT, 0).control.gearShift).toBe(1);
  });

  it('emits one-shot events for camera, pause and reset', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyC');
    input.keyboard.keyDown('Escape');
    expect(actions(input.sample(DT, 0).events)).toEqual(['nextCamera', 'pause']);
    expect(actions(input.sample(DT, 0).events)).toEqual([]);
  });

  it('toggles DRS and the pit limiter, and braking cancels the DRS request', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyF');
    input.keyboard.keyUp('KeyF');
    input.keyboard.keyDown('KeyL');
    let frame = input.sample(DT, 0);
    expect(frame.control.drs).toBe(true);
    expect(frame.control.pitLimiter).toBe(true);
    input.keyboard.keyDown('KeyS');
    for (let i = 0; i < 10; i++) frame = input.sample(DT, 0);
    expect(frame.control.drs).toBe(false);
    expect(frame.control.pitLimiter).toBe(true);
  });

  it('holds DRS only while pressed in hold mode, and overtake while held', () => {
    const { input } = setup();
    const profile = defaultProfile();
    profile.shaping.drsMode = 'hold';
    input.setProfile(profile);
    input.keyboard.keyDown('KeyF');
    input.keyboard.keyDown('Space');
    let frame = input.sample(DT, 0);
    expect(frame.control.drs).toBe(true);
    expect(frame.control.overtake).toBe(true);
    input.keyboard.keyUp('KeyF');
    input.keyboard.keyUp('Space');
    frame = input.sample(DT, 0);
    expect(frame.control.drs).toBe(false);
    expect(frame.control.overtake).toBe(false);
  });

  it('reads look back as a held state', () => {
    const { input } = setup();
    input.keyboard.keyDown('KeyB');
    expect(input.sample(DT, 0).lookBack).toBe(true);
    input.keyboard.keyUp('KeyB');
    expect(input.sample(DT, 0).lookBack).toBe(false);
  });
});

describe('contexts', () => {
  it('maps menu actions only in the menu context and keeps the car neutral there', () => {
    const { input } = setup();
    input.setContext('menu');
    input.keyboard.keyDown('ArrowUp');
    input.keyboard.keyDown('Enter');
    input.keyboard.keyDown('KeyF');
    input.keyboard.keyDown('KeyL');
    const frame = input.sample(0.5, 0);
    expect(actions(frame.events)).toEqual(['menuUp', 'menuAccept']);
    expect(frame.control.throttle).toBe(0);
    expect(frame.control.gearShift).toBe(0);
    expect(frame.control.drs).toBe(false);
  });

  it('switches menu tabs with Q and E or the shoulder buttons, and gears only while driving', () => {
    const { input, pads } = setup();
    pads.connect();
    input.setContext('menu');
    input.keyboard.keyDown('KeyQ');
    input.keyboard.keyDown('KeyE');
    let frame = input.sample(DT, 0);
    expect(actions(frame.events)).toEqual(['menuTabPrev', 'menuTabNext']);
    expect(frame.control.gearShift).toBe(0);
    input.keyboard.keyUp('KeyQ');
    input.keyboard.keyUp('KeyE');
    pads.button(5, 1);
    frame = input.sample(DT, 0);
    expect(actions(frame.events)).toEqual(['menuTabNext']);
    pads.button(5, 0);
    pads.button(4, 1);
    frame = input.sample(DT, 0);
    expect(actions(frame.events)).toEqual(['menuTabPrev']);
    pads.button(4, 0);
    input.sample(DT, 0);
    input.setContext('driving');
    input.keyboard.keyDown('KeyE');
    frame = input.sample(DT, 0);
    expect(actions(frame.events)).toEqual([]);
    expect(frame.control.gearShift).toBe(1);
  });
});

describe('gamepad', () => {
  it('shapes stick and triggers through their own curves', () => {
    const { input, pads } = setup();
    pads.connect();
    pads.axis(0, -0.5);
    pads.button(7, 0.6);
    pads.button(6, 0.02);
    const frame = input.sample(DT, 0);
    expect(frame.device).toBe('gamepad');
    expect(frame.control.steer).toBeCloseTo(applyAxisCurve(0.5, DEFAULT_GAMEPAD_SHAPING.stick), 12);
    expect(frame.control.throttle).toBeCloseTo(
      applyAxisCurve(0.6, DEFAULT_GAMEPAD_SHAPING.trigger),
      12,
    );
    expect(frame.control.brake).toBe(0);
    pads.axis(0, 0.8);
    expect(input.sample(DT, 0).control.steer).toBeCloseTo(
      -applyAxisCurve(0.8, DEFAULT_GAMEPAD_SHAPING.stick),
      12,
    );
  });

  it('reports hot-plug and falls back to the keyboard when the active pad leaves', () => {
    const { input, pads } = setup();
    expect(input.sample(DT, 0).device).toBe('keyboard');
    pads.connect(0, 'Pad one');
    let frame = input.sample(DT, 0);
    expect(frame.events).toContainEqual({ type: 'connected', device: 'gamepad', id: 'Pad one' });
    // Connecting is not using: the keyboard stays active until the pad is pressed.
    expect(frame.device).toBe('keyboard');
    pads.button(0, 1);
    frame = input.sample(DT, 0);
    expect(frame.device).toBe('gamepad');
    expect(frame.events).toContainEqual({ type: 'activeDevice', device: 'gamepad' });
    pads.disconnect(0);
    frame = input.sample(DT, 0);
    expect(frame.events).toContainEqual({ type: 'disconnected', device: 'gamepad', id: 'Pad one' });
    expect(frame.device).toBe('keyboard');
  });

  it('reads the pad that was used last when two are connected', () => {
    const { input, pads } = setup();
    pads.connect(0, 'Pad one');
    pads.connect(1, 'Pad two');
    pads.axis(0, 0.9, 0);
    pads.button(7, 1, 1);
    const frame = input.sample(DT, 0);
    expect(input.gamepad.activePad?.id).toBe('Pad two');
    expect(frame.control.throttle).toBe(1);
    expect(frame.control.steer).toBe(0);
  });

  it('passes rumble to the active pad and stays silent otherwise', () => {
    const calls: unknown[] = [];
    const pads = new FakePads();
    const input = new InputSystem({
      readGamepads: pads.read,
      rumble: { play: (...args) => calls.push(args), stop: () => calls.push('stop') },
    });
    input.rumble(1, 0.5, 0.2);
    expect(calls).toEqual([]);
    pads.connect(2);
    pads.button(0, 1, 2);
    input.sample(DT, 0);
    input.rumble(1, 0.5, 0.2);
    expect(calls).toEqual([[2, 1, 0.5, 0.2]]);
  });
});

describe('device arbitration', () => {
  it('lets the last device used win, and hands over without a steering jump', () => {
    const { input, pads } = setup();
    pads.connect();
    pads.axis(0, -1);
    expect(input.sample(DT, 0).control.steer).toBe(1);
    // A key press makes the keyboard active; its ramp starts from where the stick left off.
    input.keyboard.keyDown('KeyD');
    const frame = input.sample(0.05, 0);
    expect(frame.device).toBe('keyboard');
    expect(frame.control.steer).toBeCloseTo(1 - DEFAULT_KEYBOARD_SHAPING.returnRate * 0.05, 12);
  });

  it('starts on touch for touch-capable devices', () => {
    const { input } = setup({ touch: true });
    expect(input.sample(DT, 0).device).toBe('touch');
  });
});

describe('rebind capture', () => {
  it('captures the next press from the chosen device instead of acting on it', () => {
    const { input, pads } = setup();
    pads.connect();
    input.startCapture('gamepad');
    input.keyboard.keyDown('KeyE');
    let frame = input.sample(DT, 0);
    expect(frame.events.filter((e) => e.type === 'captured')).toEqual([]);
    expect(frame.control.gearShift).toBe(0);
    pads.axis(2, 0.9);
    frame = input.sample(DT, 0);
    expect(frame.events).toContainEqual({
      type: 'captured',
      device: 'gamepad',
      control: 'pad:a2+',
    });
    expect(input.capturing).toBe(null);
  });

  it('uses a new binding as soon as the profile changes', () => {
    const { input } = setup();
    const profile = defaultProfile();
    profile.bindings = rebind(profile.bindings, 'keyboard', 'gearUp', 0, 'key:KeyK').map;
    input.setProfile(profile);
    input.keyboard.keyDown('KeyK');
    expect(input.sample(DT, 0).control.gearShift).toBe(1);
  });
});

describe('touch', () => {
  it('steers with a floating stick and drives the pedals by finger height, multi-touch', () => {
    const { input } = setup({ touch: true });
    const t = input.touch;
    expect(t.pointerDown(1, 100, 300)).toBe(true); // steer zone: origin here
    expect(t.pointerDown(2, 798, 382 - 172 * 0.8)).toBe(true); // throttle at full height
    t.pointerMove(1, 100 - 28, 310); // half radius to the left
    let frame = input.sample(DT, 0);
    expect(frame.control.steer).toBeCloseTo(
      applyAxisCurve(0.5, input.profile.shaping.touch.stick),
      12,
    );
    expect(frame.control.throttle).toBe(1);
    // A gear tap while steering and on the throttle leaves both alone.
    expect(t.pointerDown(3, 230, 300)).toBe(true);
    t.pointerUp(3);
    frame = input.sample(DT, 0);
    expect(frame.control.gearShift).toBe(1);
    expect(frame.control.steer).toBeGreaterThan(0.3);
    expect(frame.control.throttle).toBe(1);
    // Lifting the throttle finger does not move the stick.
    t.pointerUp(2);
    frame = input.sample(DT, 0);
    expect(frame.control.throttle).toBe(0);
    expect(frame.control.steer).toBeCloseTo(
      applyAxisCurve(0.5, input.profile.shaping.touch.stick),
      12,
    );
  });

  it('reads the pedal floor at the bottom edge and ignores a second finger on a held control', () => {
    const { input } = setup({ touch: true });
    const t = input.touch;
    t.pointerDown(1, 700, 381);
    expect(input.sample(DT, 0).control.brake).toBeCloseTo(0.15 + 0.85 * (1 / (150 * 0.8)), 12);
    expect(t.pointerDown(2, 700, 240)).toBe(false);
    t.pointerUp(2);
    expect(input.sample(DT, 0).control.brake).toBeGreaterThan(0.15);
  });

  it('ignores touches outside every control', () => {
    const { input } = setup({ touch: true });
    expect(input.touch.pointerDown(1, 420, 100)).toBe(false);
  });
});
