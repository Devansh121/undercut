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

  it('clears the opening chicane with every car making progress', () => {
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
    const anchors = field.snapshots(0).map((p) => ({ x: p.x, z: p.z, since: 0 }));
    for (let tick = 0; tick < 240 * 120; tick++) {
      field.step(true, []);
      if (tick % (240 * 5) !== 0) continue;
      const seconds = tick / 240;
      const snapshots = field.snapshots(seconds * 1000);
      for (let i = 0; i < snapshots.length; i++) {
        const p = snapshots[i]!;
        const a = anchors[i]!;
        if (seconds < 20 || Math.hypot(p.x - a.x, p.z - a.z) >= 10)
          Object.assign(a, { x: p.x, z: p.z, since: seconds });
        expect(seconds - a.since, `seat ${p.seat} stopped`).toBeLessThan(20);
      }
    }
    expect(field.snapshots(120000).every((p) => p.lap >= 1)).toBe(true);
  }, 60000);

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

  it('ignores finished AI cars parked ahead when sensing traffic', () => {
    const twoAi = [
      { seat: 0, kind: 'ai' as const, member: null, aiIndex: 0, state: 'finished' as const },
      { seat: 1, kind: 'ai' as const, member: null, aiIndex: 1, state: 'racing' as const },
    ];
    const field = new OnlineAiField(track, { line, envelope }, twoAi, 'low');
    const before = field.snapshots(0)[1]!;
    for (let i = 0; i < 240 * 4; i++) field.step(true, []);
    const after = field.snapshots(4000);
    // Seat 0 is finished and stays parked; seat 1 accelerates cleanly past it without stopping.
    expect(Math.hypot(after[0]!.vx, after[0]!.vz)).toBeLessThan(0.5);
    expect(Math.hypot(after[1]!.x - before.x, after[1]!.z - before.z)).toBeGreaterThan(40);
    expect(Math.hypot(after[1]!.vx, after[1]!.vz)).toBeGreaterThan(20);
  });
});

describe('bounded stalled-car recovery', () => {
  it('recovers the reviewed seat 15 trap without changing counted progress, and migrates its reset state', () => {
    const recoveryGrid = Array.from({ length: 16 }, (_, seat) => ({
      seat,
      kind: seat === 15 ? ('ai' as const) : ('human' as const),
      member: seat === 15 ? null : `m${seat}`,
      aiIndex: seat === 15 ? 13 : null,
      state: 'racing' as const,
    }));
    const build = () => new OnlineAiField(track, { line, envelope }, recoveryGrid, 'low');
    const field = build();
    const start = field.snapshots(0)[0]!;
    const p = track.pointAt(677.17, -2.26, { x: 0, y: 0, z: 0 });
    field.takeover([
      {
        seat: 15,
        aiIndex: 13,
        lap: 1,
        raceMs: 90000,
        state: 'racing',
        behindLine: false,
        car: { ...start, x: p.x, z: p.z, vx: 0, vz: 0, resets: 2, lap: 1 },
      },
    ]);
    let reset = false;
    for (let tick = 0; tick < 240 * 12; tick++) {
      // Reproduce a car held in place even after the ordinary ghost grace.
      const st = field.world.cars[0]!.state;
      st.x = p.x;
      st.z = p.z;
      st.vx = 0;
      st.vy = 0;
      st.yawRate = 0;
      field.step(true, []);
      if (field.snapshots(0)[0]!.resets !== 2) {
        reset = true;
        break;
      }
    }
    expect(reset).toBe(true);
    const recovered = field.snapshots(10000)[0]!;
    expect(recovered.lap).toBe(1);
    expect(recovered.resets).toBe(3);
    expect(field.progress(15)?.raceMs).toBe(90000);
    const before = { x: recovered.x, z: recovered.z };
    for (let i = 0; i < 240 * 4; i++) field.step(true, []);
    const moving = field.snapshots(14000)[0]!;
    expect(Math.hypot(moving.x - before.x, moving.z - before.z)).toBeGreaterThan(10);
    const next = build();
    next.takeover([
      {
        seat: 15,
        aiIndex: 13,
        lap: 1,
        raceMs: 90000,
        state: 'racing',
        behindLine: false,
        car: moving,
      },
    ]);
    expect(next.snapshots(14000)[0]).toMatchObject({ lap: 1, resets: 3 });
    expect(next.progress(15)?.raceMs).toBe(90000);
  });
});

const SOAK_CIRCUITS = [
  {
    id: 'monza' as const,
    trim: 'low' as const,
    loadTrack: () => import('@undercut/track/data/monza.json'),
    loadLine: () => import('../../../../packages/ai/data/monza-low.line.json'),
    loadEnv: () => import('../../../../packages/ai/data/monza-low.envelope.json'),
  },
  {
    id: 'spa' as const,
    trim: 'medium' as const,
    loadTrack: () => import('@undercut/track/data/spa.json'),
    loadLine: () => import('../../../../packages/ai/data/spa-medium.line.json'),
    loadEnv: () => import('../../../../packages/ai/data/spa-medium.envelope.json'),
  },
  {
    id: 'singapore' as const,
    trim: 'high' as const,
    loadTrack: () => import('@undercut/track/data/singapore.json'),
    loadLine: () => import('../../../../packages/ai/data/singapore-high.line.json'),
    loadEnv: () => import('../../../../packages/ai/data/singapore-high.envelope.json'),
  },
];

describe.skipIf(process.env.ONLINE_AI_SOAK !== '1')(
  'three-circuit five-lap full-grid AI soak',
  () => {
    for (const cfg of SOAK_CIRCUITS) {
      it(`completes five laps with all twenty cars at ${cfg.id} without stalls`, async () => {
        const [{ default: trackJson }, { default: lineJson }, { default: envJson }] =
          await Promise.all([cfg.loadTrack(), cfg.loadLine(), cfg.loadEnv()]);
        const t = Track.fromJSON(trackJson);
        const fullGrid = Array.from({ length: 20 }, (_, seat) => ({
          seat,
          kind: 'ai' as const,
          member: null,
          aiIndex: seat,
          state: 'racing' as 'racing' | 'finished',
        }));
        const field = new OnlineAiField(
          t,
          { line: lineJson, envelope: envJson },
          fullGrid,
          cfg.trim,
        );
        const anchors = field.snapshots(0).map((p) => ({ x: p.x, z: p.z, since: 0 }));
        const prevResets = new Array<number>(20).fill(0);
        let recoveries = 0;
        const lapsDone = new Array<number>(20).fill(0);
        const maxTicks = 240 * 750;
        for (let tick = 0; tick < maxTicks; tick++) {
          const crossings = field.step(true, []);
          for (const { seat } of crossings) {
            lapsDone[seat] = (lapsDone[seat] ?? 0) + 1;
            if (lapsDone[seat]! >= 5) {
              fullGrid[seat]!.state = 'finished';
              field.states(fullGrid);
            }
          }
          if (tick % (240 * 5) !== 0) continue;
          const seconds = tick / 240;
          const snaps = field.snapshots(seconds * 1000);
          for (let i = 0; i < snaps.length; i++) {
            const p = snaps[i]!;
            if (p.resets !== prevResets[i]) {
              recoveries++;
              prevResets[i] = p.resets;
            }
            if (lapsDone[p.seat]! >= 5) continue;
            const a = anchors[i]!;
            if (seconds < 20 || Math.hypot(p.x - a.x, p.z - a.z) >= 10) {
              Object.assign(a, { x: p.x, z: p.z, since: seconds });
            }
            expect(seconds - a.since, `${cfg.id} seat ${p.seat} stuck at ${seconds}s`).toBeLessThan(
              20,
            );
          }
          if (lapsDone.every((l) => l >= 5)) {
            console.log(
              `AI 5-lap soak ${cfg.id}:`,
              JSON.stringify({ seconds: Math.round(seconds), recoveries, finishers: 20 }),
            );
            break;
          }
        }
        expect(lapsDone.every((l) => l >= 5)).toBe(true);
      }, 240_000);
    }
  },
);
