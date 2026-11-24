import { expect, it } from 'vitest';
import type { SessionResult } from '@undercut/race';
import { WeekendProgress } from './weekend';
import type { SessionChoice } from '../ui/screens/hub';
const choice: SessionChoice = {
  mode: 'championship',
  circuit: 'spa',
  team: 'calder',
  driver: 0,
  timeOfDay: '',
  assists: {},
};
function result(kind: SessionResult['kind'], circuit: string, winner = 0): SessionResult {
  return {
    kind,
    circuit,
    seed: 1,
    laps: 5,
    entries: Array.from({ length: 20 }, (_, i) => ({
      car: (i + winner) % 20,
      id: `driver${(i + winner) % 20}`,
      name: 'Driver',
      code: 'DRV',
      team: i % 10,
      position: i + 1,
      status: 'finished',
      reason: null,
      laps: 5,
      totalTime: 500 + i,
      bestLap: 90 + i,
      bestSectors: [30, 30, 30],
      gap: i ? { time: i } : null,
      interval: null,
      penaltyTime: 0,
      penalties: [],
      pitStops: 1,
      compounds: ['medium', 'hard'],
      points: 0,
    })),
    fastestLap: null,
    anomalies: [],
  } as unknown as SessionResult;
}
it('skips practice, uses qualifying for the grid, restores progress and scores three rounds once', async () => {
  let text: string | null = null;
  const port = {
    load: async () => text,
    save: async (_key: string, value: string) => {
      text = value;
    },
  };
  let p = new WeekendProgress(choice);
  for (const circuit of ['monza', 'spa', 'singapore']) {
    expect(p.weekend.plan.circuit).toBe(circuit);
    p.skipPractice();
    p.complete(result('qualifying', circuit, 3));
    expect(p.weekend.grid()[0]).toBe(3);
    await p.save(port);
    p = (await WeekendProgress.load(port))!;
    expect(p.weekend.next()?.kind).toBe('race');
    p.complete(result('race', circuit));
    expect(() => p.complete(result('race', circuit))).toThrow();
    p.nextRound();
  }
  expect(p.championship!.done).toBe(true);
  expect(p.championship!.drivers()[0]!.points).toBe(75);
  await p.save(port);
  expect((await WeekendProgress.load(port))!.championship!.drivers()).toEqual(
    p.championship!.drivers(),
  );
});
it('rejects corrupt saves and stays usable when storage fails', async () => {
  expect(await WeekendProgress.load({ load: async () => '{', save: async () => {} })).toBeNull();
  const p = new WeekendProgress(choice);
  await p.save({
    load: async () => null,
    save: async () => {
      throw new Error('full');
    },
  });
  expect(p.durable).toBe(false);
  expect(p.weekend.next()?.kind).toBe('practice');
});
