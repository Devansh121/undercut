import { expect, it } from 'vitest';
import { racingLineOffsets } from '@undercut/ai';
import { MONZA, loadLine } from '../../ai/validation/lib';
import { aiSession } from './lib/runner';
for (const seed of [3141, 2718]) {
  it(`seed ${seed}: follower sees the slowing pit entrant before lane entry`, () => {
    const s = aiSession({ kind: 'race', laps: 5 }, { cars: 2, seed, tyres: true, startFuel: 15 });
    while (s.control.phase !== 'green') s.tick();
    const offsets = racingLineOffsets(loadLine(MONZA));
    for (let i = 0; i < 2; i++) {
      const at = s.track.wrap(s.circuit.pit.entryS - 90 - i * 45);
      const pose = s.lapPose(at, s.track.lap.interpolate(offsets, at));
      s.placeCar(i, pose.x, pose.z, pose.yaw, 45);
    }
    s.requestPit(0, [{ kind: 'tyres', compound: 'hard' }]);
    let entry = false;
    let exit = false;
    let maxContact = 0;
    const begin = s.time;
    while (s.time - begin < 90 && !exit) {
      for (const event of s.tick())
        if (event.type === 'pit' && event.car === 0) {
          if (event.stage === 'entry') entry = true;
          if (event.stage === 'exit') exit = true;
        }
      maxContact = Math.max(
        maxContact,
        s.worldCar(0).state.carContactSpeed,
        s.worldCar(1).state.carContactSpeed,
      );
    }
    expect(entry).toBe(true);
    expect(exit).toBe(true);
    expect(s.control.cars[0]!.pitStops).toBe(1);
    expect(maxContact).toBe(0);
    expect(s.result().anomalies).toEqual([]);
  }, 60_000);
}
