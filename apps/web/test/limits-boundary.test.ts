import { InputSystem } from '@undercut/input';
import type { CarState } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { AutopilotControlSource, KeyboardAutopilot } from '../src/game/autopilot';
import { DriveSession, type SessionEvent, type WheelsOffCounter } from '../src/game/session';
import { loadMonza } from './fixtures';

const track = loadMonza();

/** Wheels off as scripted per world tick; everything else is on track. */
class ScriptedLimits implements WheelsOffCounter {
  constructor(
    private readonly tick: () => number,
    private readonly script: Map<number, number>,
  ) {}
  wheelsOff(_car: CarState): number {
    return this.script.get(this.tick()) ?? 0;
  }
  reset(): void {}
}

/** Drive one autopilot lap tick by tick; return every event with the tick it came from. */
function drive(script: Map<number, number>) {
  let session: DriveSession | null = null;
  const tick = (): number => session?.world.tick ?? 0;
  session = new DriveSession({ track, seed: 1, limits: new ScriptedLimits(tick, script) });
  const s = session;
  const source = new AutopilotControlSource(
    new InputSystem(),
    new KeyboardAutopilot(track, s.params),
    () => s.car.state,
  );
  s.start();
  const events: { tick: number; e: SessionEvent }[] = [];
  for (let i = 0; i < 240 * 150 && !events.some((x) => x.e.type === 'lap'); i++) {
    const frame = source.sample(s.world.step, s.car.state.vx);
    for (const e of s.tick(frame.control, frame.device)) events.push({ tick: s.world.tick, e });
  }
  return { session: s, events };
}

describe('track limits at the finish line', () => {
  // The tick on which the first timed lap completes, from a clean run (the sim is deterministic).
  const clean = drive(new Map());
  const lapTick = clean.events.find((x) => x.e.type === 'lap')?.tick ?? -1;

  it('invalidates the outgoing lap when four wheels go off in the tick that crosses the line', () => {
    const { session, events } = drive(
      new Map([
        [lapTick - 1, 3],
        [lapTick, 4],
      ]),
    );
    const types = events.filter((x) => x.tick >= lapTick - 1).map((x) => x.e.type);
    const lap = events.find((x) => x.e.type === 'lap')?.e;
    if (lap?.type !== 'lap') throw new Error('no lap');
    expect(lap.result.valid).toBe(false);
    expect(lap.result.record).toBe(false);
    expect(events.some((x) => x.e.type === 'record')).toBe(false);
    // Policy: a four-off reading at the end of a tick counts for every lap running during that
    // tick, so the outgoing lap is invalid before it is committed, and so is the new one.
    expect(types.indexOf('invalidated')).toBeLessThan(types.indexOf('lap'));
    expect(types.filter((t) => t === 'invalidated')).toHaveLength(2);
    expect(session.timer.valid).toBe(false);
  });

  it('keeps both laps valid when only three wheels are off across the line', () => {
    const { session, events } = drive(
      new Map([
        [lapTick - 1, 3],
        [lapTick, 3],
      ]),
    );
    const lap = events.find((x) => x.e.type === 'lap')?.e;
    if (lap?.type !== 'lap') throw new Error('no lap');
    expect(lap.result.valid).toBe(true);
    expect(events.some((x) => x.e.type === 'invalidated')).toBe(false);
    expect(session.timer.valid).toBe(true);
  });

  it('a four-off tick before the line invalidates only the lap it happened in', () => {
    const { session, events } = drive(new Map([[lapTick - 2, 4]]));
    const lap = events.find((x) => x.e.type === 'lap')?.e;
    if (lap?.type !== 'lap') throw new Error('no lap');
    expect(lap.result.valid).toBe(false);
    expect(session.timer.valid).toBe(true);
  });
});

describe('ghost recording on an invalid lap', () => {
  it('stops recording when the lap is invalidated, while lap timing carries on', () => {
    let session: DriveSession | null = null;
    const tick = (): number => session?.world.tick ?? 0;
    // Four off for one tick about 10 s into the session (well after the line).
    session = new DriveSession({
      track,
      seed: 1,
      limits: new ScriptedLimits(tick, new Map([[2400, 4]])),
    });
    const s = session;
    const source = new AutopilotControlSource(
      new InputSystem(),
      new KeyboardAutopilot(track, s.params),
      () => s.car.state,
    );
    s.start();
    let recordingBefore = false;
    for (let i = 0; i < 2600; i++) {
      const f = source.sample(s.world.step, s.car.state.vx);
      s.tick(f.control, f.device);
      if (s.world.tick === 2399) recordingBefore = s.ghostRecording;
    }
    expect(recordingBefore).toBe(true);
    expect(s.timer.running).toBe(true);
    expect(s.timer.valid).toBe(false);
    expect(s.ghostRecording).toBe(false);
  });
});
