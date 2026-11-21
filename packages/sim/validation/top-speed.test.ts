import { describe, expect, it } from 'vitest';
import { measureTopSpeed, topSpeed } from './lib/index';
import { expectTarget, targetName } from './expect-target';

// Doc 2.2: low-drag trim, DRS open, MGU-K deploying, no tow, Monza air, long flat straight.
describe('validation: top speed (doc 2.2)', () => {
  const { values, run } = measureTopSpeed();
  it(targetName('top-speed-low-drs'), () =>
    expectTarget('top-speed-low-drs', values['top-speed-low-drs']!),
  );

  it('stays within the per-lap deployment limit on the way', () => {
    expect(run.deployUsed).toBeLessThanOrEqual(4e6);
  });

  it('gains speed from DRS and loses it with more wing', () => {
    const closed = topSpeed({ trim: 'low', drs: false }).maxSpeed;
    const high = topSpeed({ trim: 'high', drs: true }).maxSpeed;
    expect(run.maxSpeed - closed).toBeGreaterThan(5 / 3.6);
    expect(high).toBeLessThan(run.maxSpeed - 10 / 3.6);
  });
});
