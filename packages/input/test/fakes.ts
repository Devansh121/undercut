import type { GamepadSnapshot } from '../src/sources/gamepad';

/** A scriptable gamepad list standing in for navigator.getGamepads(). */
export class FakePads {
  pads: (GamepadSnapshot | null)[] = [];

  connect(index = 0, id = 'Test pad (STANDARD GAMEPAD)'): GamepadSnapshot {
    const pad: GamepadSnapshot = {
      index,
      id,
      connected: true,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    this.pads[index] = pad;
    return pad;
  }

  disconnect(index = 0): void {
    this.pads[index] = null;
  }

  button(index: number, value: number, pad = 0): void {
    const p = this.pads[pad];
    if (!p) throw new Error(`no pad ${pad}`);
    (p.buttons as { pressed: boolean; value: number }[])[index] = { pressed: value > 0.5, value };
  }

  axis(index: number, value: number, pad = 0): void {
    const p = this.pads[pad];
    if (!p) throw new Error(`no pad ${pad}`);
    (p.axes as number[])[index] = value;
  }

  read = (): readonly (GamepadSnapshot | null)[] => this.pads;
}
