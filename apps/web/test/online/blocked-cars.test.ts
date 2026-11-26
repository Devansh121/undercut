import { describe, expect, it } from 'vitest';
import type { RemoteContactBody } from '@undercut/sim';
import { BlockedCars } from '../../src/online/blocked-cars';
const car = (seat: number, x: number, vx = 0): RemoteContactBody => ({
  seat,
  x,
  z: 0,
  yaw: 0,
  vx,
  vz: 0,
  yawRate: 0,
});

describe('blocked online cars', () => {
  it('ghosts a blocked car after six seconds without useful progress', () => {
    const recovery = new BlockedCars();
    const cars = [car(0, 0), car(1, -8)];
    expect(recovery.update(cars, 5.9).size).toBe(0);
    expect([...recovery.update(cars, 0.2)]).toEqual([0, 1]);
  });

  it('keeps a recovering car ghosted until moving and clear of overlapping or closing traffic', () => {
    const recovery = new BlockedCars();
    const cars = [car(0, 0), car(1, -4)];
    recovery.update(cars, 6.1);
    cars[0]!.vx = 8;
    expect(recovery.update(cars, 0.1).has(0)).toBe(true);
    cars[1] = car(1, -30, 30);
    expect(recovery.update(cars, 0.1).has(0)).toBe(true);
    cars[1] = car(1, -100, 8);
    expect(recovery.update(cars, 0.1).has(0)).toBe(false);
  });

  it('does not ghost a field making progress at racing speed', () => {
    const recovery = new BlockedCars();
    const cars = [car(0, 0, 40), car(1, -12, 40)];
    for (let i = 0; i < 20; i++) {
      for (const c of cars) c.x += c.vx;
      expect(recovery.update(cars, 1).size).toBe(0);
    }
  });
});
