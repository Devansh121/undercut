import { defaultBindings, rebind, keyControl } from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { REVERSE_NOTE, controlRows, controlsHint } from './controls-help';

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
      'Pit limiter',
      'Camera',
      'Look back',
      'Reset to track',
      'Pause',
    ]);
    expect(row(rows, 'brake')?.input).toBe('S or Down arrow');
    expect(row(rows, 'steer')?.input).toBe('A or Left arrow / D or Right arrow');
    expect(row(controlRows(defaultBindings(), 'gamepad'), 'brake')?.input).toBe('LT');
    expect(row(controlRows(defaultBindings(), 'touch'), 'brake')?.input).toBe('Brake pedal');
    expect(row(controlRows(defaultBindings(), 'touch'), 'pitLimiter')?.input).toBe('Not bound');
  });

  it('describes reverse as the automatic gearbox does it: two downs to reverse, two ups to first', () => {
    expect(REVERSE_NOTE).toContain('gear down twice at a standstill selects reverse');
    expect(REVERSE_NOTE).toContain('gear up twice returns to first');
  });

  it('follows a rebinding', () => {
    const { map } = rebind(defaultBindings(), 'keyboard', 'brake', 0, keyControl('KeyJ'));
    expect(row(controlRows(map, 'keyboard'), 'brake')?.input).toBe('J or Down arrow');
    expect(controlsHint(map, 'keyboard')).toBe(
      'Brake: J · Throttle: W · Esc, then Controls for all inputs',
    );
  });
});
