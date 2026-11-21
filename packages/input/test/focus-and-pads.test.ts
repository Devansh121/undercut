import { describe, expect, it } from 'vitest';
import { InputSystem } from '../src/system';
import { FakePads } from './fakes';

const DT = 1 / 120;

function padSetup() {
  const pads = new FakePads();
  const input = new InputSystem({ readGamepads: pads.read });
  return { pads, input };
}

describe('gamepad focus loss', () => {
  it('drops held pad demand after releaseAll until the control is let go', () => {
    const { pads, input } = padSetup();
    pads.connect();
    pads.button(7, 1);
    expect(input.sample(DT, 0).control.throttle).toBe(1);
    input.releaseAll();
    expect(input.sample(DT, 0).control.throttle).toBe(0);
    expect(input.sample(DT, 0).control.throttle).toBe(0);
    // Easing off but staying past the dead zone is still the old hold.
    pads.button(7, 0.4);
    expect(input.sample(DT, 0).control.throttle).toBe(0);
    pads.button(7, 0);
    input.sample(DT, 0);
    pads.button(7, 0.8);
    expect(input.sample(DT, 0).control.throttle).toBeGreaterThan(0.7);
  });

  it('suspends the pad while unfocused and needs a release after focus returns', () => {
    const { pads, input } = padSetup();
    pads.connect();
    pads.button(7, 1);
    pads.axis(0, -1);
    input.sample(DT, 0);
    input.setFocused(false);
    let frame = input.sample(DT, 0);
    expect(frame.control.throttle).toBe(0);
    expect(frame.control.steer).toBe(0);
    // A press made and let go while unfocused is dropped.
    pads.button(5, 1);
    input.sample(DT, 0);
    pads.button(5, 0);
    input.sample(DT, 0);
    input.setFocused(true);
    frame = input.sample(DT, 0);
    expect(frame.control.gearShift).toBe(0);
    expect(frame.control.throttle).toBe(0);
    expect(frame.control.steer).toBe(0);
    pads.axis(0, 0);
    pads.button(7, 0);
    input.sample(DT, 0);
    pads.axis(0, -1);
    pads.button(7, 1);
    frame = input.sample(DT, 0);
    expect(frame.control.throttle).toBe(1);
    expect(frame.control.steer).toBe(1);
  });

  it('does not count a button held through a blur as a new press', () => {
    const { pads, input } = padSetup();
    pads.connect();
    pads.button(5, 1);
    expect(input.sample(DT, 0).control.gearShift).toBe(1);
    input.setFocused(false);
    input.sample(DT, 0);
    input.setFocused(true);
    expect(input.sample(DT, 0).control.gearShift).toBe(0);
    pads.button(5, 0);
    input.sample(DT, 0);
    pads.button(5, 1);
    expect(input.sample(DT, 0).control.gearShift).toBe(1);
  });

  it('ignores a pad first pressed while unfocused until it is released', () => {
    const { pads, input } = padSetup();
    input.setFocused(false);
    pads.connect();
    pads.button(7, 1);
    input.sample(DT, 0);
    input.setFocused(true);
    const frame = input.sample(DT, 0);
    expect(frame.control.throttle).toBe(0);
  });
});

describe('two gamepads', () => {
  it('hands back to the keyboard when the used pad leaves and the other was never touched', () => {
    const { pads, input } = padSetup();
    pads.connect(0, 'Pad one');
    pads.connect(1, 'Pad two');
    input.sample(DT, 0);
    input.keyboard.keyDown('KeyZ');
    expect(input.sample(DT, 0).device).toBe('keyboard');
    pads.button(0, 1, 0);
    expect(input.sample(DT, 0).device).toBe('gamepad');
    pads.disconnect(0);
    expect(input.sample(DT, 0).device).toBe('keyboard');
    expect(input.gamepad.lastActivity).toBe(0);
  });

  it('acts only on presses from the pad it reads', () => {
    const { pads, input } = padSetup();
    pads.connect(0, 'Pad one');
    pads.connect(1, 'Pad two');
    input.sample(DT, 0);
    pads.button(5, 1, 0); // gear up on pad one
    pads.axis(0, 0.9, 1); // pad two moves later in the same poll and becomes the read pad
    const frame = input.sample(DT, 0);
    expect(input.gamepad.activePad?.id).toBe('Pad two');
    expect(frame.control.gearShift).toBe(0);
    expect(frame.control.steer).toBeLessThan(0);
    expect(input.sample(DT, 0).control.gearShift).toBe(0);
  });
});

describe('touch focus loss', () => {
  it('releases every touch on releaseAll and ignores the old pointers afterwards', () => {
    const input = new InputSystem({ touchCapable: true });
    input.touch.setLayout({
      steer: { left: 0, top: 200, width: 200, height: 190 },
      throttle: { left: 760, top: 210, width: 76, height: 172 },
      brake: { left: 674, top: 232, width: 76, height: 150 },
      buttons: { overtake: { left: 610, top: 334, width: 56, height: 48 } },
    });
    const t = input.touch;
    t.pointerDown(1, 100, 300);
    t.pointerMove(1, 50, 300);
    t.pointerDown(2, 798, 220);
    t.pointerDown(3, 630, 350);
    let frame = input.sample(DT, 0);
    expect(frame.control.steer).toBeGreaterThan(0);
    expect(frame.control.throttle).toBe(1);
    expect(frame.control.overtake).toBe(true);
    input.releaseAll();
    t.pointerMove(1, 10, 300);
    t.pointerMove(2, 798, 215);
    frame = input.sample(DT, 0);
    expect(frame.control.steer).toBe(0);
    expect(frame.control.throttle).toBe(0);
    expect(frame.control.overtake).toBe(false);
    expect(t.activePointers()).toBe(0);
    // A fresh finger can take the control again.
    expect(t.pointerDown(4, 798, 220)).toBe(true);
    expect(input.sample(DT, 0).control.throttle).toBe(1);
  });

  it('releases touches while unfocused', () => {
    const input = new InputSystem({ touchCapable: true });
    input.touch.setLayout({
      steer: { left: 0, top: 200, width: 200, height: 190 },
      throttle: { left: 760, top: 210, width: 76, height: 172 },
      brake: { left: 674, top: 232, width: 76, height: 150 },
      buttons: {},
    });
    input.touch.pointerDown(1, 798, 220);
    expect(input.sample(DT, 0).control.throttle).toBe(1);
    input.setFocused(false);
    expect(input.sample(DT, 0).control.throttle).toBe(0);
    expect(input.touch.activePointers()).toBe(0);
  });
});
