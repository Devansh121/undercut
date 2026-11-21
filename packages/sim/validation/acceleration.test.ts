import { describe, it } from 'vitest';
import { measureAcceleration } from './lib/index';
import { expectTarget, targetName } from './expect-target';

// Doc 2.3: launch on flat asphalt, race fuel 105 kg, no launch control, best of 5 runs.
describe('validation: standing start (doc 2.3)', () => {
  const { values } = measureAcceleration();
  for (const id of ['accel-0-100', 'accel-0-200', 'accel-0-300']) {
    it(targetName(id), () => expectTarget(id, values[id]!));
  }
});
