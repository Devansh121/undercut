import { expect, it } from 'vitest';
import { GapTower } from '../src/timing/tower';

it('interpolates crossing times and the partial live sector on one leader timeline', () => {
  const tower = new GapTower(1, 1000, 100);
  tower.update(0, -10, 300, 0, 10);
  tower.update(0, 300, 400, 10, 30);
  expect(tower.timeAtDistance(0, 350, 450, 40)).toBeCloseTo(20, 9);
  expect(tower.timeAtDistance(0, 425, 450, 40)).toBeCloseTo(35, 9);
  expect(tower.timeAtDistance(0, 450, 450, 40)).toBe(40);
  expect(tower.timeAtDistance(0, 451, 450, 40)).toBeNull();
  const restored = new GapTower(1, 1000, 100);
  restored.setState(tower.getState());
  expect(restored.timeAtDistance(0, 425, 450, 40)).toBe(35);
});

it('leaves gaps unavailable before the line and once crossing history expires', () => {
  const tower = new GapTower(1, 1000, 100);
  expect(tower.timeAtDistance(0, -5, 10, 1)).toBeNull();
  tower.update(0, -10, 2500, 0, 50);
  expect(tower.timeAtDistance(0, 100, 2500, 50)).toBeNull();
  expect(tower.timeAtDistance(0, 2000, 2500, 50)).not.toBeNull();
});
