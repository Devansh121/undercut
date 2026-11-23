import { describe, it } from 'vitest';
import { expectQuickRace } from './lib/expect-race';
import { runFollowupRace } from './lib/followup-proof';

for (const circuit of ['monza', 'spa', 'singapore'] as const) {
  describe(`Quick Race at ${circuit}, tyre and fuel start sweep`, () => {
    for (let seed = 101; seed <= 120; seed++) {
      it(`seed ${seed}: clean lap one, every car classified, no spins`, () => {
        expectQuickRace(runFollowupRace(circuit, seed), 1);
      });
    }
  });
}
