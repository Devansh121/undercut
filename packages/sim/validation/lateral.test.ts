import { describe, it } from 'vitest';
import { LATERAL_CASES, measureLateral } from './lib/index';
import { expectTarget, targetName } from './expect-target';

// Doc 2.5: sustained lateral acceleration (0.5 s window) at constant speed on flat asphalt,
// qualifying fuel, the circuit's air. Corners with grade or compression (Raidillon) wait for
// the track surface.
describe('validation: sustained lateral acceleration (doc 2.5)', () => {
  for (const c of LATERAL_CASES) {
    it(targetName(c.id), () => expectTarget(c.id, measureLateral(c).value));
  }
});
