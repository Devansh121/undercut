import { describe, expect, it } from 'vitest';
import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import line from '../../../../packages/ai/data/monza-low.line.json';
import envelope from '../../../../packages/ai/data/monza-low.envelope.json';
import { OnlineAiField } from '../../src/online/ai-field';

const track = Track.fromJSON(monza);
const grid = [
  { seat: 0, kind: 'human' as const, member: 'a', aiIndex: null, state: 'racing' as const },
  { seat: 1, kind: 'ai' as const, member: null, aiIndex: 0, state: 'racing' as const },
];
const make = () => new OnlineAiField(track, { line, envelope }, grid, 'low');

describe('host AI field', () => {
  it('holds on the grid, launches when released and emits real sim snapshots', () => {
    const field = make();
    const before = field.snapshots(1000)[0]!;
    for (let i = 0; i < 240; i++) field.step(false, []);
    const held = field.snapshots(2000)[0]!;
    expect(Math.hypot(held.x - before.x, held.z - before.z)).toBeLessThan(0.1);
    for (let i = 0; i < 240 * 5; i++) field.step(true, []);
    const after = field.snapshots(7000)[0]!;
    expect(after.seat).toBe(1);
    expect(after.rpm).toBeGreaterThan(4000);
    expect(Math.hypot(after.vx, after.vz)).toBeGreaterThan(10);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(20);
    expect(Number.isFinite(after.y)).toBe(true);
  });

  it('launches a full field without a stationary queue', () => {
    const field = new OnlineAiField(
      track,
      { line, envelope },
      Array.from({ length: 20 }, (_, seat) => ({
        seat,
        kind: 'ai',
        member: null,
        aiIndex: seat,
        state: 'racing',
      })),
      'low',
    );
    const before = field.snapshots(0);
    for (let i = 0; i < 240 * 20; i++) field.step(true, []);
    const after = field.snapshots(20000);
    expect(
      after.filter((p, i) => Math.hypot(p.x - before[i]!.x, p.z - before[i]!.z) > 30).length,
    ).toBe(20);
    expect(after.filter((p) => Math.hypot(p.vx, p.vz) < 1).map((p) => p.seat)).toEqual([]);
  }, 20000);

  it('takes over AI pose, velocity, gear, counted laps and race time', () => {
    const old = make();
    for (let i = 0; i < 240 * 5; i++) old.step(true, []);
    const car = old.snapshots(6000)[0]!;
    const next = make();
    next.takeover([{ seat: 1, aiIndex: 0, lap: 2, raceMs: 170000, state: 'racing', car }]);
    const restored = next.snapshots(6000)[0]!;
    expect(restored.tick).toBeGreaterThanOrEqual(car.tick);
    expect(restored.x).toBeCloseTo(car.x, 6);
    expect(restored.z).toBeCloseTo(car.z, 6);
    expect(restored.gear).toBe(car.gear);
    expect(restored.lap).toBe(2);
    expect(Math.hypot(restored.vx - car.vx, restored.vz - car.vz)).toBeLessThan(0.1);
    next.step(true, []);
    const moved = next.snapshots(6010)[0]!;
    expect(Math.hypot(moved.x - car.x, moved.z - car.z)).toBeLessThan(1);
    expect(moved.lap).toBe(2);
    expect(moved.tick).toBeGreaterThan(car.tick);
    expect(next.progress(1)?.raceMs).toBe(170000);
  });
});
