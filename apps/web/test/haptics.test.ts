import { describe, expect, it } from 'vitest';
import {
  Haptics,
  padCanRumble,
  phoneCanVibrate,
  KERB_MIN_SPEED,
  IMPACT_MIN_SPEED,
  type HapticsFrame,
  type HapticsPort,
} from '../src/game/haptics';

interface Log {
  rumble: [number, number, number][];
  vibrate: number[];
  stops: number;
}

function rig(device: 'touch' | 'gamepad' | 'keyboard' = 'gamepad', enabled = true) {
  const log: Log = { rumble: [], vibrate: [], stops: 0 };
  const state = { device, enabled };
  const port: HapticsPort = {
    device: () => state.device,
    rumble: (s, w, d) => log.rumble.push([s, w, d]),
    stopRumble: () => log.stops++,
    vibrate: (ms) => log.vibrate.push(ms),
  };
  const haptics = new Haptics(port, () => state.enabled);
  return { haptics, log, state };
}

const frame = (f: Partial<HapticsFrame> = {}): HapticsFrame => ({
  dt: 1 / 60,
  speed: 50,
  kerb: 0,
  wallImpact: 0,
  carImpact: 0,
  ...f,
});

function run(h: Haptics, seconds: number, f: Partial<HapticsFrame>): void {
  for (let t = 0; t < seconds; t += 1 / 60) h.update(frame(f));
}

describe('haptics', () => {
  it('stays still on plain tarmac', () => {
    const { haptics, log } = rig();
    run(haptics, 2, {});
    expect(log.rumble).toEqual([]);
    expect(log.vibrate).toEqual([]);
  });

  it('rumbles a gamepad for as long as the wheels are on a kerb, harder on a rougher kerb', () => {
    const { haptics, log } = rig('gamepad');
    run(haptics, 1, { kerb: 0.3 });
    const soft = log.rumble.slice();
    // Refreshed often enough to feel continuous: each pulse outlasts the gap to the next.
    expect(soft.length).toBeGreaterThanOrEqual(8);
    expect(soft.length).toBeLessThanOrEqual(15);
    const gap = 1 / soft.length;
    for (const [, , duration] of soft) expect(duration).toBeGreaterThan(gap);
    log.rumble.length = 0;
    run(haptics, 1, { kerb: 1 });
    const [s0, w0] = soft[0]!;
    const [s1, w1] = log.rumble[0]!;
    expect(w1).toBeGreaterThan(w0);
    expect(s1).toBeGreaterThan(s0);
    // A kerb is a buzz, mostly the light motor.
    expect(w1).toBeGreaterThan(s1);
    // Off the kerb it stops at once.
    log.rumble.length = 0;
    haptics.update(frame({ kerb: 0 }));
    expect(log.stops).toBe(1);
    run(haptics, 1, {});
    expect(log.rumble).toEqual([]);
  });

  it('ignores kerbs at walking pace, where the sim still reports roughness', () => {
    const { haptics, log } = rig('gamepad');
    run(haptics, 1, { kerb: 1, speed: KERB_MIN_SPEED * 0.5 });
    expect(log.rumble).toEqual([]);
  });

  it('gives one jolt per impact, scaled by its speed, for barriers and cars alike', () => {
    const { haptics, log } = rig('gamepad');
    haptics.update(frame({ wallImpact: 4 }));
    // A scrape that keeps reporting contact at a lower speed is the same impact.
    run(haptics, 0.3, { wallImpact: 2 });
    expect(log.rumble).toHaveLength(1);
    run(haptics, 0.5, {});
    haptics.update(frame({ carImpact: 12 }));
    expect(log.rumble).toHaveLength(2);
    const [small, big] = log.rumble as [[number, number, number], [number, number, number]];
    expect(big[0]).toBeGreaterThan(small[0]);
    expect(big[2]).toBeGreaterThan(small[2]);
    // An impact is a thump, mostly the heavy motor.
    expect(big[0]).toBeGreaterThan(big[1]);
    for (const [s, w, d] of log.rumble) {
      expect(s).toBeLessThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(0.5);
    }
  });

  it('feels a harder hit that lands during a lighter one', () => {
    const { haptics, log } = rig('gamepad');
    haptics.update(frame({ carImpact: 3 }));
    haptics.update(frame({ carImpact: 9 }));
    expect(log.rumble).toHaveLength(2);
  });

  it('skips touches too light to mean anything', () => {
    const { haptics, log } = rig('gamepad');
    run(haptics, 1, { carImpact: IMPACT_MIN_SPEED * 0.9, wallImpact: IMPACT_MIN_SPEED * 0.5 });
    expect(log.rumble).toEqual([]);
  });

  it('lets an impact play out over a kerb rumble', () => {
    const { haptics, log } = rig('gamepad');
    run(haptics, 0.5, { kerb: 0.5 });
    log.rumble.length = 0;
    haptics.update(frame({ kerb: 0.5, wallImpact: 15 }));
    const jolt = log.rumble.at(-1)!;
    run(haptics, jolt[2] * 0.8, { kerb: 0.5 });
    expect(log.rumble).toHaveLength(1);
    run(haptics, 0.3, { kerb: 0.5 });
    expect(log.rumble.length).toBeGreaterThan(1);
  });

  it('vibrates a phone in short pulses on touch controls, never the gamepad API', () => {
    const { haptics, log } = rig('touch');
    run(haptics, 1, { kerb: 1 });
    expect(log.rumble).toEqual([]);
    // Pulses, not a continuous buzz: a few per second, each short.
    expect(log.vibrate.length).toBeGreaterThanOrEqual(3);
    expect(log.vibrate.length).toBeLessThanOrEqual(6);
    for (const ms of log.vibrate) expect(ms).toBeLessThanOrEqual(20);
    log.vibrate.length = 0;
    haptics.update(frame({ wallImpact: 20 }));
    expect(log.vibrate).toHaveLength(1);
    expect(log.vibrate[0]).toBeGreaterThan(20);
    expect(log.vibrate[0]).toBeLessThanOrEqual(100);
  });

  it('does nothing on a keyboard', () => {
    const { haptics, log } = rig('keyboard');
    run(haptics, 1, { kerb: 1, wallImpact: 20 });
    expect(log.rumble).toEqual([]);
    expect(log.vibrate).toEqual([]);
  });

  it('follows the setting, and stops a running rumble when it is turned off', () => {
    const { haptics, log, state } = rig('gamepad', false);
    run(haptics, 1, { kerb: 1, wallImpact: 20 });
    expect(log.rumble).toEqual([]);
    state.enabled = true;
    run(haptics, 0.2, { kerb: 1 });
    expect(log.rumble.length).toBeGreaterThan(0);
    state.enabled = false;
    haptics.update(frame({ kerb: 1 }));
    expect(log.stops).toBe(1);
  });

  it('stops on demand (pause, quit) and starts afresh after', () => {
    const { haptics, log } = rig('gamepad');
    run(haptics, 0.2, { kerb: 1 });
    haptics.stop();
    expect(log.stops).toBe(1);
    // Nothing was playing: no second stop.
    haptics.stop();
    expect(log.stops).toBe(1);
    const before = log.rumble.length;
    haptics.update(frame({ kerb: 1 }));
    expect(log.rumble.length).toBe(before + 1);
  });

  it('survives a port that throws', () => {
    const haptics = new Haptics(
      {
        device: () => 'touch',
        rumble: () => {
          throw new Error('no pad');
        },
        stopRumble: () => {
          throw new Error('no pad');
        },
        vibrate: () => {
          throw new Error('blocked');
        },
      },
      () => true,
    );
    expect(() => run(haptics, 0.5, { kerb: 1, wallImpact: 10 })).not.toThrow();
    expect(() => haptics.stop()).not.toThrow();
  });
});

describe('haptics capability', () => {
  const nav = (n: Record<string, unknown>) => n as unknown as Navigator;
  it('sees a phone motor only where the Vibration API exists', () => {
    expect(phoneCanVibrate(nav({ vibrate: () => true }))).toBe(true);
    // iOS Safari: no navigator.vibrate.
    expect(phoneCanVibrate(nav({}))).toBe(false);
    expect(phoneCanVibrate(undefined)).toBe(false);
  });

  it('sees a pad that can rumble, not one without an actuator or an empty slot', () => {
    const pads = (list: unknown[]) => nav({ getGamepads: () => list });
    expect(padCanRumble(pads([null, { vibrationActuator: {} }]))).toBe(true);
    expect(padCanRumble(pads([null, {}]))).toBe(false);
    expect(padCanRumble(pads([]))).toBe(false);
    expect(padCanRumble(nav({}))).toBe(false);
    expect(
      padCanRumble(
        nav({
          getGamepads: () => {
            throw new Error('blocked by policy');
          },
        }),
      ),
    ).toBe(false);
  });
});
