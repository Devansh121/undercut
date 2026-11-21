import { InputSystem } from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { AutopilotControlSource, KeyboardAutopilot } from '../src/game/autopilot';
import type { CircuitRecord, RecordUpdate } from '../src/game/records';
import { DriveSession, type SessionEvent } from '../src/game/session';
import type { LapResult } from '../src/game/timing';
import { loadMonza } from './fixtures';

const track = loadMonza();

/** One autopilot lap from the rolling start with `record` loaded; the lap and record events. */
function lapWith(record: CircuitRecord | null): {
  lap: LapResult;
  updates: RecordUpdate[];
  session: DriveSession;
} {
  const session = new DriveSession({ track, seed: 1, record, today: '2026-11-21' });
  const source = new AutopilotControlSource(
    new InputSystem(),
    new KeyboardAutopilot(track, session.params),
    () => session.car.state,
  );
  session.start();
  const events: SessionEvent[] = [];
  for (let i = 0; i < 240 * 150 && !events.some((e) => e.type === 'lap'); i++) {
    const f = source.sample(session.world.step, session.car.state.vx);
    events.push(...session.tick(f.control, f.device));
  }
  const lap = events.find((e) => e.type === 'lap');
  if (lap?.type !== 'lap') throw new Error('no lap');
  const updates = events.flatMap((e) => (e.type === 'record' ? [e.update] : []));
  return { lap: lap.result, updates, session };
}

describe('record updates from the session', () => {
  it('a faster lap carries its own splits; the sector minima come separately', () => {
    // A slow stored lap whose middle sector is unbeatable.
    const { lap, updates } = lapWith({
      lap: 200,
      lapSectors: [60, 1, 139],
      bestSectors: [60, 1, 139],
      ghost: null,
      date: '',
    });
    expect(lap.record).toBe(true);
    expect(updates).toHaveLength(1);
    const u = updates[0] as RecordUpdate;
    expect(u.lap?.time).toBeCloseTo(lap.time, 9);
    expect(u.lap?.sectors).toEqual(lap.sectors);
    expect(u.lap?.ghost).toEqual(expect.any(String));
    // Sector 2 stays at the stored 1 s even though this lap's own split is slower.
    expect(u.bestSectors).toEqual([lap.sectors[0], 1, lap.sectors[2]]);
  });

  it('a slower lap with a better sector still produces a sector-only update', () => {
    const { lap, updates } = lapWith({
      lap: 50,
      lapSectors: [100, 1, 1],
      bestSectors: [100, 1, 1],
      ghost: null,
      date: '',
    });
    expect(lap.record).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.lap).toBeNull();
    expect(updates[0]?.bestSectors).toEqual([lap.sectors[0], 1, 1]);
  });

  it('a lap that improves nothing stays out of storage', () => {
    const { updates } = lapWith({
      lap: 50,
      lapSectors: [1, 1, 1],
      bestSectors: [1, 1, 1],
      ghost: null,
      date: '',
    });
    expect(updates).toEqual([]);
  });
});
