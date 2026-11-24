import {
  defaultBindings,
  keyControl,
  padAxis,
  padButton,
  rebind,
  touchControl,
} from '@undercut/input';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  applyAssists,
  createAssistState,
  createCarState,
  createEnvironment,
  stepCar,
  type CarState,
  type ControlInput,
} from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { controlRows, controlsHint, controlsTabs, pairLabel, reverseNote } from './controls-help';

const row = (rows: ReturnType<typeof controlRows>, id: string) => rows.find((r) => r.id === id);

describe('controls list', () => {
  it('reads every row from the bindings for the device', () => {
    const rows = controlRows(defaultBindings(), 'keyboard');
    expect(rows.map((r) => r.action)).toEqual([
      'Steer',
      'Throttle',
      'Brake',
      'Gear up',
      'Gear down',
      'DRS',
      'Overtake',
      'Box this lap / cancel',
      'Next tyre compound',
      'Pit limiter',
      'Camera',
      'Look back',
      'Reset to track',
      'Pause',
    ]);
    expect(row(rows, 'brake')?.input).toBe('S or Down arrow');
    expect(row(rows, 'steer')?.input).toBe('A/D or arrow keys');
    const pad = controlRows(defaultBindings(), 'gamepad');
    expect(row(pad, 'brake')?.input).toBe('LT');
    expect(row(pad, 'steer')?.input).toBe('Left stick');
    const touch = controlRows(defaultBindings(), 'touch');
    expect(row(touch, 'brake')?.input).toBe('Brake pedal');
    expect(row(touch, 'steer')?.input).toBe('Stick');
    expect(row(touch, 'pitLimiter')?.input).toBe('Limiter button');
  });

  it('lists the bound controls of each device, one slot per alternative', () => {
    const map = defaultBindings();
    const pad = controlRows(map, 'gamepad');
    expect(row(pad, 'brake')?.slots).toEqual([[padButton(6)]]);
    expect(row(pad, 'throttle')?.slots).toEqual([[padButton(7)]]);
    expect(row(pad, 'gearDown')?.slots).toEqual([[padButton(4)]]);
    expect(row(pad, 'steer')?.slots[0]).toEqual([padAxis(0, -1), padAxis(0, 1)]);
    const keys = controlRows(map, 'keyboard');
    expect(row(keys, 'brake')?.slots).toEqual([[keyControl('KeyS')], [keyControl('ArrowDown')]]);
    expect(row(keys, 'steer')?.slots).toEqual([
      [keyControl('KeyA'), keyControl('KeyD')],
      [keyControl('ArrowLeft'), keyControl('ArrowRight')],
    ]);
    // Nothing bound: no slots, and the text says where it is instead.
    const touch = controlRows(map, 'touch');
    expect(row(touch, 'pitLimiter')?.slots).toEqual([[touchControl('pitLimiter')]]);
    expect(row(touch, 'lookBack')?.slots).toEqual([]);
    expect(row(touch, 'resetToTrack')?.slots).toEqual([]);
    // Every row of every device has a text form, for the accessible name.
    for (const d of ['keyboard', 'gamepad', 'touch'] as const)
      for (const r of controlRows(map, d)) expect(r.input.length).toBeGreaterThan(0);
  });

  it('has a tab for each device on the machine, the controller always', () => {
    const none = new Set<never>();
    expect(controlsTabs('keyboard', { touch: false, used: none })).toEqual(['keyboard', 'gamepad']);
    // A pad in use on a desktop: still the keyboard, which is always there.
    expect(controlsTabs('gamepad', { touch: false, used: none })).toEqual(['keyboard', 'gamepad']);
    // A phone: no keyboard until a key is pressed.
    expect(controlsTabs('touch', { touch: true, used: none })).toEqual(['gamepad', 'touch']);
    expect(controlsTabs('touch', { touch: true, used: new Set(['keyboard'] as const) })).toEqual([
      'keyboard',
      'gamepad',
      'touch',
    ]);
    expect(controlsTabs('keyboard', { touch: true, used: none })).toEqual([
      'keyboard',
      'gamepad',
      'touch',
    ]);
  });

  it('points to the pause menu for reset on touch, which has no reset button', () => {
    expect(row(controlRows(defaultBindings(), 'touch'), 'resetToTrack')?.input).toBe('Pause menu');
  });

  it('pairs left and right controls into one steering entry', () => {
    expect(pairLabel('A', 'D')).toBe('A/D');
    expect(pairLabel('Left arrow', 'Right arrow')).toBe('arrow keys');
    expect(pairLabel('Left stick left', 'Left stick right')).toBe('Left stick');
    expect(pairLabel('Left Shift', 'D')).toBe('Left Shift/D');
  });

  it('follows a rebinding', () => {
    const { map } = rebind(defaultBindings(), 'keyboard', 'brake', 0, keyControl('KeyJ'));
    expect(row(controlRows(map, 'keyboard'), 'brake')?.input).toBe('J or Down arrow');
    expect(controlsHint(map, 'keyboard')).toBe(
      'Brake: J · Throttle: W · Esc, then Controls for all inputs',
    );
    const steer = rebind(defaultBindings(), 'keyboard', 'steerLeft', 0, keyControl('KeyZ')).map;
    expect(row(controlRows(steer, 'keyboard'), 'steer')?.input).toBe('Z/D or arrow keys');
  });

  it('names the bound gear controls in the reverse note, and follows a rebinding', () => {
    expect(reverseNote(defaultBindings(), 'keyboard')).toBe(
      'Reverse, with automatic gears: stop, then press Q twice. Press E twice to return to first.',
    );
    expect(reverseNote(defaultBindings(), 'gamepad')).toBe(
      'Reverse, with automatic gears: stop, then press LB twice. Press RB twice to return to first.',
    );
    const { map } = rebind(defaultBindings(), 'gamepad', 'gearDown', 0, padButton(13));
    expect(reverseNote(map, 'gamepad')).toContain('press D-pad down twice');
  });
});

/**
 * The reverse note's claim, run through the real automatic-gearbox assist and gearbox: from a
 * standstill in first, two gear-down presses select reverse and two gear-up presses return to
 * first; rolling, gear down in first does not select reverse.
 */
describe('reverse with automatic gears, as the note describes it', () => {
  const DT = 1 / 240;
  const env = createEnvironment();
  const settings = { tractionControl: 0, abs: 0, autoGears: true };

  function press(car: CarState, memory: ReturnType<typeof createAssistState>, shift: -1 | 1) {
    const out: ControlInput = { ...NEUTRAL_INPUT };
    const held: ControlInput = { ...NEUTRAL_INPUT, brake: 1 };
    // One tick with the request (an edge from the input layer), then hold the brake for 0.5 s
    // so the shift completes and the car stays stopped.
    applyAssists(settings, memory, car, { ...held, gearShift: shift }, DT, out);
    stepCar(car, out, FLAT_SURFACE, DT, env);
    for (let i = 0; i < 120; i++) {
      applyAssists(settings, memory, car, held, DT, out);
      stepCar(car, out, FLAT_SURFACE, DT, env);
    }
  }

  it('goes 1 → N → R on two gear-downs at a standstill and R → N → 1 on two gear-ups', () => {
    const car = createCarState(REFERENCE_CAR, { gear: 1 });
    const memory = createAssistState();
    const gears: number[] = [car.gear];
    press(car, memory, -1);
    gears.push(car.gear);
    press(car, memory, -1);
    gears.push(car.gear);
    press(car, memory, 1);
    gears.push(car.gear);
    press(car, memory, 1);
    gears.push(car.gear);
    expect(gears).toEqual([1, 0, -1, 0, 1]);
  });

  it('keeps first when gear down is pressed while rolling', () => {
    const car = createCarState(REFERENCE_CAR, { gear: 1, speed: 8 });
    const out: ControlInput = { ...NEUTRAL_INPUT };
    applyAssists(settings, createAssistState(), car, { ...NEUTRAL_INPUT, gearShift: -1 }, DT, out);
    stepCar(car, out, FLAT_SURFACE, DT, env);
    expect(car.gear).toBe(1);
  });
});
