/**
 * What the rules read about one car each tick, as plain numbers. The race session fills these
 * from the sim (`RaceSession`); scripted tests fill them from cars on rails, so the rules can be
 * tested without the vehicle model.
 */
export interface CarFacts {
  /** Lap position: centreline s and lateral d (positive left). In the pit lane, its projection onto the lap. */
  s: number;
  d: number;
  /** Forward speed, m/s. */
  speed: number;
  /** Wheels wholly past the track-limit lines (0 to 4). */
  wheelsOff: number;
  /** On the pit-lane surface, with its pit-frame position (NaN when not in the lane). */
  inPitLane: boolean;
  pitS: number;
  pitD: number;
}

export function createFacts(): CarFacts {
  return {
    s: 0,
    d: 0,
    speed: 0,
    wheelsOff: 0,
    inPitLane: false,
    pitS: Number.NaN,
    pitD: Number.NaN,
  };
}

export function copyFacts(from: CarFacts, to: CarFacts): CarFacts {
  to.s = from.s;
  to.d = from.d;
  to.speed = from.speed;
  to.wheelsOff = from.wheelsOff;
  to.inPitLane = from.inPitLane;
  to.pitS = from.pitS;
  to.pitD = from.pitD;
  return to;
}

/** Facts with NaN replaced by null, for JSON snapshots. */
export function factsToJson(f: CarFacts): Record<string, number | boolean | null> {
  return {
    s: f.s,
    d: f.d,
    speed: f.speed,
    wheelsOff: f.wheelsOff,
    inPitLane: f.inPitLane,
    pitS: Number.isFinite(f.pitS) ? f.pitS : null,
    pitD: Number.isFinite(f.pitD) ? f.pitD : null,
  };
}

export function factsFromJson(j: Record<string, number | boolean | null>, out: CarFacts): CarFacts {
  out.s = j.s as number;
  out.d = j.d as number;
  out.speed = j.speed as number;
  out.wheelsOff = j.wheelsOff as number;
  out.inPitLane = j.inPitLane as boolean;
  out.pitS = typeof j.pitS === 'number' ? j.pitS : Number.NaN;
  out.pitD = typeof j.pitD === 'number' ? j.pitD : Number.NaN;
  return out;
}
