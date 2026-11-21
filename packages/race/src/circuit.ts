import type { Track } from '@undercut/track';

/**
 * What the rules need to know about a circuit, as plain data: lap length, the timing lines,
 * DRS zones, the pit lane's lines and boxes and the grid. Built from a `Track` with
 * `circuitInfo`, or written by hand for scripted tests on rails.
 *
 * Positions on the lap are centreline `s` (m from the track file's s = 0, the start line).
 * Positions in the pit lane are the pit frame's `s_pit` (0 where the lane leaves the lap) and
 * its lateral `d`.
 */
export interface CircuitInfo {
  readonly id: string;
  readonly length: number;
  /**
   * Lap s of the control (timing) line that laps, sectors and the ERS lap run from. Not always
   * the start line: at Monza it is 320.5 m before s = 0.
   */
  readonly timingLine: number;
  /** Lap s of each sector's start line; the first is the timing line. */
  readonly sectorLines: readonly number[];
  readonly speedTrap: number;
  readonly drsZones: readonly { detection: number; activation: number; end: number }[];
  readonly pit: {
    readonly entryS: number;
    readonly exitS: number;
    readonly length: number;
    /** m/s. */
    readonly speedLimit: number;
    /** s_pit of the speed-limit lines. */
    readonly limitStart: number;
    readonly limitEnd: number;
    /** Stop positions, pit frame. One per team. */
    readonly boxes: readonly { s: number; d: number }[];
  };
  /** Grid slots, pole first, lap frame. */
  readonly grid: readonly { s: number; d: number }[];
  /**
   * Lap s where the last corner before the timing line begins. In qualifying, a track-limits
   * offence between here and the line also deletes the next lap (the exit speed carries over).
   */
  readonly lastCornerStart: number;
  /** Laps in a full-distance race. */
  readonly raceLaps: number;
}

/**
 * Per-circuit facts the track file does not (yet) carry. Monza: the control line measured on
 * the published circuit map (docs/physics-validation.md 7.6) and the race distance of 4.7.
 */
export const CIRCUIT_DATA: Readonly<Record<string, { timingLine: number; raceLaps: number }>> =
  Object.freeze({
    monza: { timingLine: 5472.5, raceLaps: 53 },
  });

/** Laps for a full-distance race on a circuit with no entry: the least whole laps over 305 km. */
export function fullRaceLaps(length: number): number {
  return Math.floor(305000 / length) + 1;
}

function forward(length: number, from: number, to: number): number {
  const d = (to - from) % length;
  return d < 0 ? d + length : d;
}

/** The circuit as the rules see it, from the track and `CIRCUIT_DATA`. */
export function circuitInfo(track: Track, overrides: { timingLine?: number } = {}): CircuitInfo {
  const data = CIRCUIT_DATA[track.id];
  const length = track.length;
  const timingLine = track.wrap(overrides.timingLine ?? data?.timingLine ?? 0);
  // Sector lines from the track file; the first (the file's s = 0) becomes the timing line.
  const rest = Array.from(track.sectors)
    .slice(1)
    .filter((s) => forward(length, timingLine, s) > 1)
    .sort((a, b) => forward(length, timingLine, a) - forward(length, timingLine, b));
  // The last corner: the one whose start is nearest before the timing line.
  let lastCornerStart = timingLine;
  let best = Infinity;
  for (const c of track.corners) {
    const back = forward(length, c.start, timingLine);
    if (back > 0 && back < best) {
      best = back;
      lastCornerStart = c.start;
    }
  }
  const pit = track.pit;
  return {
    id: track.id,
    length,
    timingLine,
    sectorLines: [timingLine, ...rest],
    speedTrap: track.speedTrap,
    drsZones: track.drsZones.map((z) => ({ ...z })),
    pit: {
      entryS: pit.entryS,
      exitS: pit.exitS,
      length: pit.length,
      speedLimit: pit.speedLimit,
      limitStart: pit.limitStart,
      limitEnd: pit.limitEnd,
      boxes: pit.boxes.map((b) => ({ s: b.s, d: b.d })),
    },
    grid: track.gridSlots.map((g) => ({ s: g.s, d: g.d })),
    lastCornerStart,
    raceLaps: data?.raceLaps ?? fullRaceLaps(length),
  };
}
