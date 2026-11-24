import {
  ANALOG_ACTIONS,
  DRIVING_BUTTONS,
  controlsFor,
  defaultBindings,
  keyControl,
  padButton,
} from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { REBINDABLE, actionName, rebindSlot, unboundActions } from './settings-model';

describe('rebinding in Settings', () => {
  it('binds a free key and says so', () => {
    const r = rebindSlot(defaultBindings(), 'keyboard', 'gearUp', 1, keyControl('KeyR'));
    expect(r.kind).toBe('done');
    if (r.kind !== 'done') return;
    expect(controlsFor(r.map, 'keyboard', 'gearUp')).toEqual(['key:KeyE', 'key:KeyR']);
    expect(r.message).toBe('R now does Gear up.');
    expect(r.newlyUnbound).toEqual([]);
  });

  it('takes a key off the action that had it, and names what was left unbound', () => {
    // Q is gear down's only key.
    const r = rebindSlot(defaultBindings(), 'keyboard', 'gearUp', 0, keyControl('KeyQ'));
    if (r.kind !== 'done') throw new Error(r.message);
    expect(controlsFor(r.map, 'keyboard', 'gearUp')).toEqual(['key:KeyQ']);
    expect(controlsFor(r.map, 'keyboard', 'gearDown')).toEqual([]);
    expect(r.message).toBe('Q now does Gear up. It was taken off Gear down.');
    expect(r.newlyUnbound).toEqual(['gearDown']);
    expect(unboundActions(r.map, 'keyboard')).toEqual(['gearDown']);
  });

  it('keeps a second key when the first moves elsewhere', () => {
    const r = rebindSlot(defaultBindings(), 'keyboard', 'drs', 0, keyControl('KeyS'));
    if (r.kind !== 'done') throw new Error(r.message);
    expect(controlsFor(r.map, 'keyboard', 'brake')).toEqual(['key:ArrowDown']);
    expect(r.newlyUnbound).toEqual([]);
  });

  it('clears a slot', () => {
    const r = rebindSlot(defaultBindings(), 'keyboard', 'brake', 0, null);
    if (r.kind !== 'done') throw new Error(r.message);
    expect(controlsFor(r.map, 'keyboard', 'brake')).toEqual(['key:ArrowDown']);
    expect(r.message).toBe('Brake: slot cleared.');
    const again = rebindSlot(r.map, 'keyboard', 'brake', 0, null);
    if (again.kind !== 'done') throw new Error(again.message);
    expect(again.newlyUnbound).toEqual(['brake']);
  });

  it('never leaves pause without a control', () => {
    // The pad's only pause button, given to another action.
    const r = rebindSlot(defaultBindings(), 'gamepad', 'overtake', 0, padButton(9));
    expect(r).toMatchObject({
      kind: 'refused',
      message: 'Pause needs a control, so that change was not made.',
    });
    const keys = rebindSlot(defaultBindings(), 'keyboard', 'pause', 1, null);
    expect(keys.kind).toBe('done');
    if (keys.kind !== 'done') return;
    expect(rebindSlot(keys.map, 'keyboard', 'pause', 0, null).kind).toBe('refused');
  });

  it('lists every driving action the input layer has, and the defaults bind them all', () => {
    expect(REBINDABLE).toEqual([...ANALOG_ACTIONS, ...DRIVING_BUTTONS]);
    for (const a of REBINDABLE) expect(actionName(a)).toMatch(/^[A-Z][A-Za-z ]+$/);
    // An action without a label of its own still reads as words.
    expect(actionName('boxThisLap' as never)).toBe('Box this lap');
    expect(unboundActions(defaultBindings(), 'keyboard')).toEqual([]);
    expect(unboundActions(defaultBindings(), 'gamepad')).toEqual([]);
  });
});
