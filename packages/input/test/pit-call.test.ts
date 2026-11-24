import { expect, it } from 'vitest';
import { InputSystem } from '../src/system';
import { FakePads } from './fakes';
for (const device of ['keyboard', 'gamepad', 'touch'] as const) {
  it(`${device}: box and compound controls emit once per press in driving context`, () => {
    const pads = new FakePads();
    const input = new InputSystem({ readGamepads: pads.read, touchCapable: device === 'touch' });
    pads.connect();
    input.touch.setLayout({
      steer: { left: 0, top: 200, width: 100, height: 100 },
      throttle: { left: 200, top: 200, width: 50, height: 100 },
      brake: { left: 260, top: 200, width: 50, height: 100 },
      buttons: {
        boxThisLap: { left: 0, top: 0, width: 48, height: 48 },
        nextCompound: { left: 60, top: 0, width: 48, height: 48 },
      },
    });
    input.sample(0.01, 0);
    for (const [action, key, button, x] of [
      ['boxThisLap', 'KeyI', 12, 20],
      ['nextCompound', 'KeyO', 13, 80],
    ] as const) {
      if (device === 'keyboard') input.keyboard.keyDown(key);
      else if (device === 'gamepad') pads.button(button, 1);
      else input.touch.pointerDown(1, x, 20);
      expect(input.sample(0.01, 30).events).toContainEqual({ type: 'action', action });
      expect(input.sample(0.01, 30).events).not.toContainEqual({ type: 'action', action });
      if (device === 'keyboard') input.keyboard.keyUp(key);
      else if (device === 'gamepad') pads.button(button, 0);
      else input.touch.pointerUp(1);
      input.sample(0.01, 30);
    }
  });
}
