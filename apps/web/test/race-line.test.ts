import { expect, it } from 'vitest';
import { raceLineFile, raceLineTrim } from '../src/game/race-line';

// One rule for which racing line a circuit races on, shared by the menus (built by the Vite
// config from the files on disk) and the drive screen (from the build's glob of them).

it('picks the circuit’s own line, the same one from bare names and from paths', () => {
  const names = ['monza-low.line.json', 'spa-medium.line.json', 'spa-high.line.json'];
  const paths = names.map((n) => `../../../packages/ai/data/${n}`);
  expect(raceLineFile('spa', names)).toBe('spa-high.line.json');
  expect(raceLineFile('spa', paths)).toBe('../../../packages/ai/data/spa-high.line.json');
  expect(raceLineFile('monza', names)).toBe('monza-low.line.json');
  // A circuit whose id starts another's is not given that one's line.
  expect(raceLineFile('spa', ['spa2-low.line.json'])).toBeNull();
  expect(raceLineFile('singapore', names)).toBeNull();
});

it('reads the trim from the file name', () => {
  expect(raceLineTrim('spa', '../../../packages/ai/data/spa-medium.line.json')).toBe('medium');
  expect(raceLineTrim('monza', 'monza-low.line.json')).toBe('low');
});
