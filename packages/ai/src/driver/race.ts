import { createRng, type Rng } from '@undercut/core';
import {
  BODY_HALF_WIDTH,
  createCarTelemetry,
  type CarParams,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import type { DrivingPlan } from '../profile/plan';
import { Phase } from '../profile/speed-profile';
import type { Driver, DriverMemory, DriverSkill } from './driver';
import { ReferenceDriver } from './reference';
import { BrakingCurve } from './braking-curve';
import { OVERLAP, brakingTraffic, defensiveLane, mirrorOffset, roomLane } from './racecraft';
import { DriverMistakes } from './mistakes';
import { pitCarInPath, type TrafficCar, type TrafficView } from './traffic';

/**
 * How a racing driver drives, each 0 to 1 unless a unit is given. The player-facing difficulty
 * and the spread across a field map onto these.
 */
export interface RaceSkill {
  /** Share of the car's cornering and traction the driver plans with (1: the reference's). */
  pace: number;
  /** Share of the braking the driver plans with (1: the reference's). Lower brakes earlier. */
  braking: number;
  /** 1: no noise in hands, feet and line; 0: the most this model adds. */
  consistency: number;
  /** Lag of hands and feet, s. */
  reaction: number;
  /** Lag of what the driver feels of the tyres (slip, load), s. */
  senseLag: number;
  /** Noise on what the driver feels of the tyres and of where the car is, 0 to 1. */
  senseNoise: number;
  /** How readily the driver goes for a gap and how close it follows. */
  aggression: number;
  /** Seed for everything random in this driver. */
  seed: number;
}

export const DEFAULT_RACE_SKILL: Readonly<RaceSkill> = Object.freeze({
  pace: 1,
  braking: 1,
  consistency: 0.8,
  reaction: 0.03,
  senseLag: 0.03,
  senseNoise: 0.3,
  aggression: 0.5,
  seed: 1,
});

/**
 * The envelope shares and errors of the reference controller underneath a racing driver of
 * `skill`. Pace 1 plans with the reference driver's shares less a racing margin (the driver
 * feels the tyres late and with noise, so it cannot ride the limit as the reference does).
 */
export function driverSkillFor(skill: RaceSkill): DriverSkill {
  const pace = clamp01(skill.pace);
  const braking = clamp01(skill.braking);
  const rough = 1 - clamp01(skill.consistency);
  return {
    envelope: {
      lateral: 0.965 - 0.05 * (1 - pace),
      traction: 0.97 - 0.05 * (1 - pace),
      brake: 0.93 - 0.06 * (1 - braking),
    },
    reaction: Math.max(0, skill.reaction),
    steerNoise: 0.004 * rough,
    pedalNoise: 0.03 * rough,
    lineWander: 0.1 + 0.2 * rough,
    seed: skill.seed >>> 0,
  };
}

/** Car body length and width the driver keeps clear of, m. */
const CAR_LENGTH = 5.6;
const CAR_WIDTH = 2 * BODY_HALF_WIDTH;
/** Centre-to-centre lateral distance held side by side, m: a car's width and some air. */
const SIDE_BY_SIDE = CAR_WIDTH + 0.8;
/**
 * The same, for the lane a passing car takes beside the car it is passing, at speed `v`: more
 * air at speed, for the metre or so the car trails its lane while the line sweeps across under
 * it in a braking zone (none at a crawl, edging round a car stopped on the track).
 */
function passSideBySide(v: number): number {
  return SIDE_BY_SIDE + 0.9 * Math.max(0, Math.min(1, (v - 10) / 40));
}
/**
 * Alongside for the corner: the attacker's nose past the other car's rear axle, about 0.9 of a
 * car length between their centres.
 */
const ALONGSIDE = 0.9 * CAR_LENGTH;
/** Air between the bodies while passing below which the car being passed is in the way, m. */
const PASS_CLEARANCE = 0.3;
/** Share of the car's braking a car in a move brakes off line with, to the off-line speed. */
const MOVE_BRAKE_SHARE = 0.9;
/** Speed a car goes round a car stopped in the road, until past it, m/s. */
const BYPASS_SPEED = 8;
/** Deceleration to that crawl on the way to a stopped car, m/s²: gentle, a corner too. */
const BYPASS_DECEL = 6;
/** Centre-to-centre beside a stopped car going round it, m: the car is at an angle, steering. */
const BYPASS_SIDE_BY_SIDE = SIDE_BY_SIDE + 0.3;
/** Steering feedback's curvature limit, 1/m: the reference driver's, and at a standstill (rising below `SLOW_STEER_BELOW` m/s). */
const BASE_CORRECTION = 0.05;
const SLOW_CORRECTION = 0.15;
const SLOW_STEER_BELOW = 12;
/** A car stopped within this far behind another stopped car is in its queue, m. */
const QUEUE_REACH = 30;
/** Below this speed, m/s, the steering's yaw-rate integral does not build up. */
const INTEGRATE_FROM = 2;
/** Heading toward its lane a car asks for at walking pace, at most, rad. */
const SLOW_HEADING = 0.5;
/** Below this speed, m/s, a car pulling away keeps this share of the throttle. */
const PULL_AWAY_BELOW = 8;
const PULL_AWAY_THROTTLE = 0.3;
/** Below this speed, m/s, a car stopping for traffic keeps this share of the brake pedal. */
const SLOW_STOP_BELOW = 12;
const SLOW_STOP_BRAKE = 0.6;
/** Deceleration to a stop behind a car stopped in the road with no way round it, m/s². */
const STOP_DECEL = 6;
/** Line slope across the road, m/m, past which there is no going round a stopped car there. */
const SWEEP_MAX = 0.3;
/** Road lane settling distance around a stopped car where the racing line sweeps, m. */
const QUEUE_SWEEP_CLEARANCE = 60;
/**
 * Two cars level with no room for both each give way to the other at speed (each drops back
 * until it is settled who goes first). Below this speed, m/s, a car no longer follows a car level
 * with it or behind it for speed, or the two follow each other down to a standstill.
 */
const LEVEL_YIELD_SPEED = SLOW_STOP_BELOW;
/** Gap to the car ahead in the lane, m, under which the queue beyond it counts on the launch. */
const LAUNCH_QUEUE_GAP = 15;
/** Lateral distance below which a car ahead is in this car's path, m. */
const IN_PATH = CAR_WIDTH + 0.5;
/** Room kept between the body and the track edge, m. */
const EDGE_MARGIN = 0.25;
/** How fast the driver moves across the track, m/s. */
const LATERAL_RATE = 1.5;
/**
 * And per metre travelled, m/m: at walking pace (pulling away from a queue off the line) the car
 * steers no more sharply than that, or its steering saturates and carries it past the line.
 */
const LATERAL_SLOPE = 0.2;
/**
 * Counted from no slower than this, m/s: standing still the lane may still move (to go round a
 * car stalled on the grid ahead), and the heading limit keeps the steering in hand once moving.
 */
const LATERAL_SLOPE_FROM = 3;
/** Going round a stopped car, from no slower than this, m/s (off the grid behind a stalled car). */
const BYPASS_SLOPE_FROM = 10;
/** Gap control: standstill gap, m, speed gain, 1/s, and the deceleration assumed for safety, m/s². */
const STANDSTILL_GAP = 2;
/** Gap kept to a car standing still in the road, m: room to steer out and round it. */
const STILL_GAP = 10;
const GAP_GAIN = 0.8;
const SPEED_GAIN = 3;
/** Share of this car's braking the gap control counts on, and extra reaction time, s. */
const BRAKE_SHARE = 0.9;
/**
 * A queue forming behind a car stopped in the road: the deceleration counted on to stop behind a
 * car in it that is slow (under `SLOW_STOP_BELOW`), at most, m/s². At walking pace the wheels are
 * light and the driver's feel for a lock holds the pedal well short of the plan's braking:
 * 8–9 m/s² below 10 m/s, measured in the queue into Spa's Bus Stop, where cars counting on the
 * plan's 14 rear-ended at 5–7 m/s. A car standing within `QUEUE_SEE` m plus `QUEUE_SEE_TIME` s of
 * travel ahead makes it a queue.
 */
const QUEUE_BRAKE = 7;
/**
 * And the standstill gap in it, m: room for a car's nose to swing as it turns at walking pace
 * (on full lock into the Bus Stop, noses swept into the tails ahead at a 2 m gap).
 */
const QUEUE_GAP = 4;
const QUEUE_SEE = 150;
const QUEUE_SEE_TIME = 4;
/**
 * Toward a car standing in the road, whatever the lane: no faster than slows to the crawl at
 * which cars go round it (`BYPASS_SPEED`) by the time it is reached, at this deceleration,
 * m/s². (A car whose lane was clear of the car ahead, swinging round the stopped car into
 * Raidillon, sped up toward it and closed on the cars going round it at 15 m/s.)
 */
const CAUTION_DECEL = 3;
const REACT_MARGIN = 0.1;
/**
 * Time gap a driver follows at, s, by aggression (0 to 1): close on a straight (a few tenths,
 * to be ready to pull out and pass), further back through braking zones and corners, out of the
 * worst of the wake (slipstream and dirty air arrive in the sim later; the habit is here now).
 */
const HEADWAY_STRAIGHT = [0.3, 0.15] as const;
const HEADWAY_CORNER = [0.6, 0.35] as const;
/** While attacking the car ahead, s: closer, and it brakes on its own plan, not on the other car's. */
const HEADWAY_ATTACK = 0.12;
/**
 * An attack on a straight from lap two stays in the other car's wake until this time gap, s
 * (`STANDSTILL_GAP` on top), or until the braking zone is `TOW_PULL_OUT_BEFORE` s off, then
 * pulls out; above `TOW_HOLD_FROM` m/s only (the tow's own range).
 */
const TOW_PULL_OUT = 0.2;
const TOW_PULL_OUT_BEFORE = 2;
const TOW_HOLD_FROM = 35;
/** The attack's following margins are relaxed in the wake until this long before the zone, s. */
const TOW_RELAX_UNTIL = 1.5;
/**
 * From lap two a move into a braking zone may be decided from up to this far behind an overlap,
 * m (a car's length), if the car would still be level by the turn-in with its lane clear.
 */
const LATE_DIVE = CAR_LENGTH;
/** From lap two, seconds before a move given up at a braking zone may start again. */
const LATE_COOLDOWN = 1.5;
/** From lap two, a move ends once the car being passed is this far ahead, m. */
const DROPPED_BACK = 60;
/** A later-lap move given up this long before a braking zone, s, or in it, holds its lane. */
const ABANDON_HOLD_BEFORE = 2;
/** From lap two, a move out of the wake that has not gained for this long is given up, s. */
const PASS_STALL = 1.5;
/** A car ahead cornering under this share of this car's plan is a car to press (`quicker`). */
const PRESS_PACE = 0.997;
/** Pressing a slower car from lap two: the most headway kept through corners, s. */
const HEADWAY_PRESS = 0.2;
/**
 * What a driver perceives of the other cars: how far ahead and behind (mirrors), m, and how late,
 * s (a car is seen where it was that long ago).
 */
const SEE_AHEAD = 300;
const SEE_BEHIND = 40;
const SEE_DELAY = 0.12;
/** Curvature from which the line counts as a corner, 1/m (a radius under 150 m). */
const CORNER_CURVATURE = 1 / 150;
/** Speed below which a car is still launching (or crawling) and does not start a pass, m/s. */
const LAUNCHED = 25;
/**
 * A car within `HAZARD_SEE` m ahead at no more than `HAZARD_SPEED` m/s (stopped, or crawling
 * round a stopped car or in its queue) keeps the racing moves (passing a car at speed, attack
 * speed headroom, mirror clearance) off: the queue and the cars going round it drive on their measured plan, as the
 * session keeps the tow off while a car stands in the road. A car stopped and made a ghost is
 * not seen, but the queue it leaves crawling behind it is.
 */
const HAZARD_SEE = 600;
const HAZARD_SPEED = BYPASS_SPEED + 2;
/** A car within this distance behind puts the driver under pressure (more errors), m. */
const PRESSURE_BEHIND = 30;
/** From lap two the car's centre goes no further than this past the white line, m. */
const LINE_EDGE_SLACK = 0.3;
/** No error starts with a car closer than this behind, m. */
const ERROR_CLEAR_BEHIND = 12;
/** A slowing pit entrant holds racing moves only this close ahead, m. */
const ENTRANT_SEE = 200;
/**
 * A car ahead this far under the plan's corner speeds (its pace through corners, 0 to 1.2) is
 * slow in corners, the way a new player is: it is dived on into a braking zone from behind. A
 * car on the pace is passed into a braking zone only from an overlap.
 */
const SLOW_IN_CORNERS = 0.9;
/** Room to the edge a car turning round keeps before it changes direction, m. */
const TURN_ROOM = 3.5;
/** A car within this far of where it stood is standing still, m. */
const STILL_RADIUS = 1.5;
/** Off the road, a recovering car turns this far toward it from the lap's direction, rad. */
const ROAD_AIM = 0.4;
/** Past the track edge by more than this, m, a car is off the road (in no queue). */
const ROAD_EDGE_SLACK = 1;
/** Recovery: each direction (forward, back) is held at least this long once its gear is in, s. */
const DIR_HOLD = 1;

const TWO_PI = 2 * Math.PI;
const wrapAngle = (a: number): number => a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Telemetry fields copied as numbers into the perceived view each tick. */
const TELEMETRY = createCarTelemetry();
const SCALAR_KEYS = (Object.keys(TELEMETRY) as (keyof CarTelemetry)[]).filter(
  (k) => typeof TELEMETRY[k] !== 'object',
);

export interface RaceDriverOptions {
  plan: DrivingPlan;
  params: CarParams;
  skill: RaceSkill;
}

/**
 * A driver that races: the reference controller underneath (the same steering, pedals and
 * gears, the same physics, no grip or speed cheats) on a plan made with this driver's skill,
 * with what a racing driver adds on top.
 *
 * - Perception: the tyres are felt late and with noise (slip, load), and the car's position on
 *   the track is known only to within a drifting error, as the README requires of race AI.
 * - Gap keeping: a car ahead in its path sets a speed it can follow at (a time gap plus a
 *   standstill gap, and never closer than it could brake to the other car's speed).
 * - Lanes: it holds an offset from its racing line. Side by side it keeps a car's width and some
 *   air to the other car, never moving across it, and leaves a car's width at the edge; when
 *   there is no room for both it drops back behind the car ahead of it. Off its line in a
 *   corner it slows for the tighter radius.
 * - Passing: with a pace advantage, or after being held up, it picks a side with room and moves
 *   off line beside the car ahead; it rejoins its line once clear.
 * - Blue flag: it moves off line to the wider side (the race controller also lifts).
 * - Recovery: after a spin it waits for a gap in the traffic, turns back the right way and
 *   rejoins off line before easing back onto it.
 *
 * Seeded and deterministic; `snapshot` carries everything, so a restore continues bit for bit.
 */
export class RaceDriver implements Driver {
  readonly name = 'race';
  readonly plan: DrivingPlan;
  readonly skill: RaceSkill;
  readonly inner: ReferenceDriver;
  private readonly params: CarParams;
  /** Shares of the envelope this driver plans with (traction, cornering). */
  private readonly tractionShare: number;
  private readonly lateralShare: number;
  /** Per line sample: distance to the next braking zone or corner, m (0 inside one). */
  private readonly cornerAhead: Float64Array;
  /** Per line sample: distance to the next braking zone, m (0 inside one). */
  private readonly brakingAhead: Float64Array;
  private readonly brakingCurve: BrakingCurve;
  /** Small errors at corners from lap two (`mistakes.ts`). */
  readonly mistakes: DriverMistakes;
  private view: TrafficView | null = null;
  private readonly seen: CarTelemetry = createCarTelemetry();
  private rng: Rng;

  // Memory between ticks.
  private o = 0;
  private passId = -1;
  private passSide = 0;
  private passTime = 0;
  private passBlocked = 0;
  /** A later-lap move out of the wake: time it has gone without gaining, s. */
  private passStall = 0;
  /** A later-lap move given up in a braking zone or corner: hold the road lane through it. */
  private abandonHold = false;
  private cooldown = 0;
  private heldTime = 0;
  private switchbackId = -1;
  private switchbackSide = 0;
  private switchbackTime = 0;
  private recovering = false;
  private rejoinTime = 0;
  private stillTime = 0;
  /** Where the car stood when it last moved off, for `stillTime` (NaN: nowhere yet). */
  private stillS = Number.NaN;
  private stillD = Number.NaN;
  private backTime = 0;
  /** Recovery: time in the present direction, s; back up straight; direction changes made. */
  private dirHeld = 0;
  private backStraight = false;
  private flips = 0;
  private wasActive = false;
  private blueSide = 0;
  private brakingLane = 0;
  private brakingHold = false;
  private readonly defence = { lane: 0, used: false };
  /** Stopped/crawling traffic or a slowing pit entrant ahead: set first in `planTraffic`. */
  private hazard = false;
  private crawlAhead = false;
  /** The car being passed as last seen (speed, m/s; -1 none) and its deceleration, m/s². */
  private passSeenV = -1;
  private passSeenId = -1;
  private passDecel = 0;
  /** The watched car's speed in corners as a share of this car's profile there (seen). */
  private aheadPace = 1;
  private aheadPaceId = -1;
  /** The move goes on into the braking zone: level with the other car by the turn-in. */
  private passCommitted = false;
  /** The move goes round a car stopped in the road (anywhere, a corner too, slowly). */
  private passBypass = false;
  /** The car standing still in the road ahead (`obstructId`, -1 none) and how long it has been seen. */
  private obstructTime = 0;
  private obstructId = -1;
  /** Seconds left backing up, to steer out round a stopped car stopped too close to it. */
  private reverseTime = 0;
  private biasX = 0;
  private biasZ = 0;
  private haveSense = false;
  /**
   * In a queue behind a car stopped in the road, and not yet back above `SLOW_STEER_BELOW`:
   * the walking-pace steering rules hold after that car turns into a ghost the drivers no longer
   * see (at Raidillon the last car of a queue lost them on the climb and slid off the road).
   */
  private queueCrawl = false;
  private readonly slip = new Float64Array(4);
  private readonly angle = new Float64Array(4);
  private readonly load = new Float64Array(4);

  /** Diagnostics of the last tick. */
  readonly last = {
    offset: 0,
    target: 0,
    leader: -1,
    gap: Number.POSITIVE_INFINITY,
    accelLimit: Number.POSITIVE_INFINITY,
    passing: -1,
    yielding: false,
    recovering: false,
  };

  constructor(o: RaceDriverOptions) {
    this.plan = o.plan;
    this.skill = { ...o.skill };
    this.params = o.params;
    this.inner = new ReferenceDriver({
      plan: o.plan,
      params: o.params,
      skill: driverSkillFor(o.skill),
    });
    this.rng = createRng((o.skill.seed ^ 0x9e3779b9) >>> 0);
    this.cornerAhead = cornerDistances(o.plan);
    this.brakingAhead = cornerDistances(o.plan, true);
    this.brakingCurve = new BrakingCurve(
      (v) => o.plan.model.brake(v, 1) + o.plan.model.drag(v, false),
    );
    this.mistakes = new DriverMistakes({
      profile: o.plan.profile,
      step: o.plan.track.lap.step,
      consistency: o.skill.consistency,
      seed: o.skill.seed,
    });
    const shares = driverSkillFor(o.skill).envelope;
    this.tractionShare = shares.traction;
    this.lateralShare = shares.lateral;
  }

  get ersMode(): ReferenceDriver['ersMode'] {
    return this.inner.ersMode;
  }

  /** The traffic limited the pedals on the last tick (the launch should not override them). */
  get following(): boolean {
    return this.last.accelLimit < 2;
  }

  /** Read the traffic for the next `drive` (the view is read during `drive`, not copied). */
  sense(view: TrafficView): void {
    this.view = view;
  }

  reset(): void {
    this.inner.reset();
    this.rng = createRng((this.skill.seed ^ 0x9e3779b9) >>> 0);
    this.o = 0;
    this.passId = -1;
    this.passSide = 0;
    this.passTime = 0;
    this.passBlocked = 0;
    this.passStall = 0;
    this.abandonHold = false;
    this.cooldown = 0;
    this.heldTime = 0;
    this.switchbackId = -1;
    this.switchbackSide = 0;
    this.switchbackTime = 0;
    this.recovering = false;
    this.rejoinTime = 0;
    this.stillTime = 0;
    this.stillS = Number.NaN;
    this.stillD = Number.NaN;
    this.backTime = 0;
    this.dirHeld = 0;
    this.backStraight = false;
    this.flips = 0;
    this.wasActive = false;
    this.blueSide = 0;
    this.brakingLane = 0;
    this.brakingHold = false;
    this.defence.lane = 0;
    this.defence.used = false;
    this.hazard = false;
    this.crawlAhead = false;
    this.passSeenV = -1;
    this.passSeenId = -1;
    this.passDecel = 0;
    this.aheadPace = 1;
    this.aheadPaceId = -1;
    this.passCommitted = false;
    this.passBypass = false;
    this.obstructTime = 0;
    this.obstructId = -1;
    this.reverseTime = 0;
    this.biasX = 0;
    this.biasZ = 0;
    this.haveSense = false;
    this.queueCrawl = false;
    this.mistakes.reset();
  }

  snapshot(): DriverMemory {
    const inner = this.inner.snapshot();
    const out: Record<string, number | boolean | readonly number[]> = {};
    for (const [k, v] of Object.entries(inner)) out[`ref.${k}`] = v;
    out.rng = this.rng.getState().slice();
    out.o = this.o;
    out.passId = this.passId;
    out.passSide = this.passSide;
    out.passTime = this.passTime;
    out.passBlocked = this.passBlocked;
    out.passStall = this.passStall;
    out.abandonHold = this.abandonHold;
    out.cooldown = this.cooldown;
    out.heldTime = this.heldTime;
    out.switchbackId = this.switchbackId;
    out.switchbackSide = this.switchbackSide;
    out.switchbackTime = this.switchbackTime;
    out.recovering = this.recovering;
    out.rejoinTime = this.rejoinTime;
    out.stillTime = this.stillTime;
    // (NaN, none yet, is null in JSON and comes back as none.)
    out.stillS = this.stillS;
    out.stillD = this.stillD;
    out.backTime = this.backTime;
    out.dirHeld = this.dirHeld;
    out.backStraight = this.backStraight;
    out.flips = this.flips;
    out.wasActive = this.wasActive;
    out.blueSide = this.blueSide;
    out.defenceLane = this.defence.lane;
    out.defenceUsed = this.defence.used;
    out.passSeenV = this.passSeenV;
    out.passSeenId = this.passSeenId;
    out.aheadPace = this.aheadPace;
    out.aheadPaceId = this.aheadPaceId;
    out.brakingLane = this.brakingLane;
    out.brakingHold = this.brakingHold;
    out.passDecel = this.passDecel;
    out.passCommitted = this.passCommitted;
    out.passBypass = this.passBypass;
    out.obstructTime = this.obstructTime;
    out.obstructId = this.obstructId;
    out.reverseTime = this.reverseTime;
    out.biasX = this.biasX;
    out.biasZ = this.biasZ;
    out.haveSense = this.haveSense;
    out.queueCrawl = this.queueCrawl;
    out.slip = Array.from(this.slip);
    out.angle = Array.from(this.angle);
    out.load = Array.from(this.load);
    this.mistakes.snapshot(out);
    return out;
  }

  restore(m: DriverMemory): void {
    const inner: Record<string, number | boolean | readonly number[]> = {};
    for (const [k, v] of Object.entries(m)) if (k.startsWith('ref.')) inner[k.slice(4)] = v;
    this.inner.restore(inner);
    const num = (k: string): number => {
      const v = m[k];
      if (typeof v !== 'number') throw new Error(`race driver memory: ${k} missing`);
      return v;
    };
    const arr = (k: string, out: Float64Array): void => {
      const v = m[k];
      if (!Array.isArray(v) || v.length !== out.length) {
        throw new Error(`race driver memory: ${k} missing`);
      }
      for (let i = 0; i < out.length; i++) out[i] = v[i] as number;
    };
    const rng = m.rng;
    if (!Array.isArray(rng) || rng.length !== 4) throw new Error('race driver memory: rng missing');
    this.rng.setState([rng[0]!, rng[1]!, rng[2]!, rng[3]!]);
    this.o = num('o');
    this.passId = num('passId');
    this.passSide = num('passSide');
    this.passTime = num('passTime');
    this.passBlocked = num('passBlocked');
    this.passStall = typeof m.passStall === 'number' ? m.passStall : 0;
    this.abandonHold = m.abandonHold === true;
    this.cooldown = num('cooldown');
    this.heldTime = num('heldTime');
    this.switchbackId = typeof m.switchbackId === 'number' ? m.switchbackId : -1;
    this.switchbackSide = typeof m.switchbackSide === 'number' ? m.switchbackSide : 0;
    this.switchbackTime = typeof m.switchbackTime === 'number' ? m.switchbackTime : 0;
    this.recovering = m.recovering === true;
    this.rejoinTime = num('rejoinTime');
    this.stillTime = num('stillTime');
    this.stillS = typeof m.stillS === 'number' ? m.stillS : Number.NaN;
    this.stillD = typeof m.stillD === 'number' ? m.stillD : Number.NaN;
    this.backTime = num('backTime');
    this.dirHeld = num('dirHeld');
    this.backStraight = m.backStraight === true;
    this.flips = num('flips');
    this.wasActive = m.wasActive === true;
    this.blueSide = typeof m.blueSide === 'number' ? m.blueSide : 0;
    this.defence.lane = typeof m.defenceLane === 'number' ? m.defenceLane : 0;
    this.defence.used = m.defenceUsed === true;
    this.passSeenV = typeof m.passSeenV === 'number' ? m.passSeenV : -1;
    this.passSeenId = typeof m.passSeenId === 'number' ? m.passSeenId : -1;
    this.aheadPace = typeof m.aheadPace === 'number' ? m.aheadPace : 1;
    this.aheadPaceId = typeof m.aheadPaceId === 'number' ? m.aheadPaceId : -1;
    this.brakingLane = typeof m.brakingLane === 'number' ? m.brakingLane : 0;
    this.brakingHold = m.brakingHold === true;
    this.passDecel = typeof m.passDecel === 'number' ? m.passDecel : 0;
    this.passCommitted = m.passCommitted === true;
    this.passBypass = m.passBypass === true;
    this.obstructTime = typeof m.obstructTime === 'number' ? m.obstructTime : 0;
    this.obstructId = typeof m.obstructId === 'number' ? m.obstructId : -1;
    this.reverseTime = typeof m.reverseTime === 'number' ? m.reverseTime : 0;
    this.biasX = num('biasX');
    this.biasZ = num('biasZ');
    this.haveSense = m.haveSense === true;
    this.queueCrawl = m.queueCrawl === true;
    arr('slip', this.slip);
    arr('angle', this.angle);
    arr('load', this.load);
    this.mistakes.restore(m);
  }

  drive(tel: CarTelemetry, dt: number, out: ControlInput): ControlInput {
    const seen = this.perceive(tel, dt);
    const view = this.view;
    this.view = null;
    const inner = this.inner;
    if (view) this.planTraffic(view, tel, dt);
    else {
      this.o = this.approach(this.o, 0, dt);
      inner.offsetSlope = 0;
      inner.accelLimit = Number.POSITIVE_INFINITY;
      inner.speedAllowance = 0;
      inner.racingDeploy = false;
      inner.brakeFloor = 0;
      inner.throttleFloor = 0;
      inner.maxCorrection = BASE_CORRECTION;
      inner.headingLimit = Number.POSITIVE_INFINITY;
      inner.integrateFrom = 0;
      inner.holdFrontSlip = true;
      this.last.accelLimit = Number.POSITIVE_INFINITY;
      this.last.leader = -1;
    }
    inner.offset = this.o;
    inner.drive(seen, dt, out);
    // Race DRS latches shut on a throttle lift (< 0.3) and re-arms only when the request drops.
    if (out.throttle < 0.3) out.drs = false;
    this.last.offset = this.o;
    if (view) this.recover(view, tel, dt, out);
    if (view && !this.recovering) this.backUp(view, tel, dt, out);
    return out;
  }

  // ---- Perception ----

  /** What the driver feels and sees of its own car this tick. */
  private perceive(tel: CarTelemetry, dt: number): CarTelemetry {
    const seen = this.seen;
    const src = tel as unknown as Record<string, number | boolean>;
    const dst = seen as unknown as Record<string, number | boolean>;
    for (const k of SCALAR_KEYS) dst[k] = src[k]!;
    seen.wheelAngle.set(tel.wheelAngle);
    seen.wheelSpeed.set(tel.wheelSpeed);
    seen.suspensionTravel.set(tel.suspensionTravel);
    const sk = this.skill;
    const noise = clamp01(sk.senseNoise);
    const tyre = this.params.tyre;
    const a = sk.senseLag > 0 && this.haveSense ? 1 - Math.exp(-dt / sk.senseLag) : 1;
    this.haveSense = true;
    const slipSigma = 0.1 * noise * tyre.peakSlipRatio;
    const angleSigma = 0.1 * noise * Math.atan(tyre.peakSlipTan);
    for (let i = 0; i < 4; i++) {
      this.slip[i] = this.slip[i]! + (tel.slipRatio[i]! - this.slip[i]!) * a;
      this.angle[i] = this.angle[i]! + (tel.slipAngle[i]! - this.angle[i]!) * a;
      this.load[i] = this.load[i]! + (tel.wheelLoad[i]! - this.load[i]!) * a;
      seen.slipRatio[i] = this.slip[i]! + (noise > 0 ? this.gauss() * slipSigma : 0);
      seen.slipAngle[i] = this.angle[i]! + (noise > 0 ? this.gauss() * angleSigma : 0);
      seen.wheelLoad[i] = this.load[i]! * (1 + (noise > 0 ? this.gauss() * 0.05 * noise : 0));
    }
    // Where the car is: a slowly drifting error of up to 0.15 m at full noise.
    if (noise > 0) {
      // The error drifts with distance driven, not with time: at walking pace a drift per
      // second would swamp the car's own motion and read as a slide.
      const amp = 0.15 * noise;
      const k = amp * Math.sqrt(dt) * Math.min(1, Math.abs(tel.speed) / 20);
      this.biasX = Math.max(-amp, Math.min(amp, this.biasX + this.rng.range(-1, 1) * k));
      this.biasZ = Math.max(-amp, Math.min(amp, this.biasZ + this.rng.range(-1, 1) * k));
      seen.x = tel.x + this.biasX;
      seen.z = tel.z + this.biasZ;
    }
    return seen;
  }

  private gauss(): number {
    const r = this.rng;
    return (r.next() + r.next() + r.next() + r.next() - 2) * Math.sqrt(3);
  }

  // ---- Plan sampling ----

  /** Linear interpolation of a per-sample array at lap s (wraps). */
  private at(a: ArrayLike<number>, s: number): number {
    const track = this.plan.track;
    const n = this.plan.line.count;
    const u = track.wrap(s) / track.lap.step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    return a[i]! + (a[j]! - a[i]!) * f;
  }

  /** Signed distance from `from` to `to` along the lap, in (-L/2, L/2]. */
  private ahead(from: number, to: number): number {
    const L = this.plan.track.length;
    let d = (to - from) % L;
    if (d > L / 2) d -= L;
    else if (d <= -L / 2) d += L;
    return d;
  }

  /** Offset bounds from the line that keep the body inside the track over [s, s + reach]. */
  private bounds(s: number, reach: number, out: { lo: number; hi: number }): void {
    const track = this.plan.track;
    const line = this.plan.line.d;
    const margin = BODY_HALF_WIDTH + EDGE_MARGIN;
    let lo = Number.NEGATIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= reach; x += 6) {
      const sx = s + x;
      const ld = this.at(line, sx);
      const left = this.at(track.halfWidth[0], sx) - margin - ld;
      const right = -(this.at(track.halfWidth[1], sx) - margin) - ld;
      if (left < hi) hi = left;
      if (right > lo) lo = right;
    }
    // The line itself is always allowed (at an apex it runs closer to the edge than this).
    out.lo = Math.min(lo, 0);
    out.hi = Math.max(hi, 0);
  }

  // ---- Traffic ----

  private readonly room = { lo: 0, hi: 0 };
  /** Scratch: cars in this car's lane ahead this tick (distance, speed). */
  private readonly queue = Array.from({ length: 24 }, () => ({ ds: 0, speed: 0 }));
  /** Scratch: cars alongside this tick. */
  private readonly side = Array.from({ length: 24 }, () => ({
    car: null as unknown as TrafficCar,
    ds: 0,
    od: 0,
    sep: 0,
    left: false,
  }));

  private planTraffic(view: TrafficView, tel: CarTelemetry, dt: number): void {
    const plan = this.plan;
    const line = plan.line;
    const self = view.self;
    const v = Math.max(0, tel.speed);
    const s0 = self.s;
    this.slowAhead(view, s0);
    // Other cars' lateral positions are taken against the line here, where this car is: the
    // line sweeps across the track, and an offset read against it where they are would put
    // them metres from where they are when they are a few lengths away.
    const ldHere = this.at(line.d, s0);
    const myO = self.d - ldHere;
    const aggression = clamp01(this.skill.aggression);
    // (Committed to a move, the next few lengths: its lane was checked to the turn-in, and the
    // apex beyond, where the line meets the edge, is not where it is now.)
    // (Round a stopped car, here only: its lane is fixed on the road beside it, not held against
    // a line that swings across the track a few metres on.)
    const roomReach = this.passBypass ? 0 : this.passCommitted ? 10 + v * 0.3 : 30 + v * 1.2;
    this.bounds(s0, roomReach, this.room);
    const oMin = this.room.lo;
    const oMax = this.room.hi;
    // Braking zone or corner close ahead: the car in front owns the corner unless this one is
    // alongside it, and the gap opens out of the wake.
    const toCorner = this.at(this.cornerAhead, s0);
    const cornering = toCorner < 30 + v * 0.8;
    const midCorner = Math.abs(this.at(line.curvature, s0)) > CORNER_CURVATURE;
    // The opening lap: no change of lane under braking, and into the first corner no move that
    // is not already alongside (the field arrives there together).
    const opening = view.openingLap === true && !view.launching;
    const laterLap = view.openingLap === false && !view.launching;
    // A car well off the corner pace uses the established slow-car passing rules. The
    // competitive tow/press/dive policy is for cars racing at comparable pace, not avoidance.
    let slowTraffic = false;
    if (this.slowInCorners(this.aheadPaceId)) {
      for (let k = 0; k < view.count; k++) {
        const c = view.cars[k]!;
        if (c.id !== this.aheadPaceId) continue;
        const ds = this.ahead(s0, c.s);
        slowTraffic = ds > -(CAR_LENGTH + 2) && ds < SEE_AHEAD;
        break;
      }
    }
    const later = laterLap && !this.hazard && !slowTraffic;
    const firstEnd = plan.track.corners[0]?.end ?? 0;
    const firstCorner =
      opening &&
      cornering &&
      (s0 < firstEnd ||
        s0 > (plan.track.corners[plan.track.corners.length - 1]?.end ?? plan.track.length));
    const straightness = Math.max(0, Math.min(1, (toCorner - v) / 150));

    // The car ahead in this car's path, and the cars alongside (or about to be). Other cars are
    // seen within mirror and windscreen range, where they were a moment ago.
    let leader: TrafficCar | null = null;
    let leaderDs = Number.POSITIVE_INFINITY;
    let passCar: TrafficCar | null = null;
    let passDs = 0;
    const side = this.side;
    let ns = 0;
    let nq = 0;
    // How fast this car moves across the track, m/s (positive left): its heading against the
    // lap's, the line's heading less the line's own slope across the track.
    const lineSlope = (this.at(line.d, s0 + 1) - this.at(line.d, s0 - 1)) / 2;
    const lineHeading =
      line.heading[Math.round(plan.track.wrap(s0) / plan.track.lap.step) % line.count]!;
    const dRate = v * Math.sin(wrapAngle(tel.yaw - (lineHeading - Math.atan(lineSlope))));
    // Going round a stopped car: its lane on the road, and how far ahead the stopped car is. The
    // cars already in that lane are followed in single file, not drawn alongside (alongside, the
    // car behind is squeezed off the lane into the stopped car).
    let bypassLane = Number.NaN;
    let bypassReach = 0;
    if (this.passBypass && this.passId >= 0) {
      for (let k = 0; k < view.count; k++) {
        const c = view.cars[k]!;
        if (c.id !== this.passId) continue;
        bypassLane = c.d + this.passSide * (BYPASS_SIDE_BY_SIDE + c.halfWidth - BODY_HALF_WIDTH);
        bypassReach = this.ahead(s0, c.s) + CAR_LENGTH;
      }
    }
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      // Relative position as it was SEE_DELAY ago (both cars move; the gap changes by the
      // speed difference).
      const ds = this.ahead(s0, c.s) - (c.speed - v) * SEE_DELAY;
      if (c.id === this.passId) {
        passCar = c;
        passDs = ds;
      }
      if (ds > SEE_AHEAD || ds < -SEE_BEHIND) continue;
      if (ds < -(CAR_LENGTH + 2)) continue;
      const od = c.d - ldHere;
      // A car standing still is as far to the side as this one will be when it gets there, if
      // that is closer than now: through a chicane the line swings across under a car going
      // round it, and the car trails its lane back toward the line.
      const arrive = Math.min(1.5, Math.max(0, ds - CAR_LENGTH) / Math.max(v, 2));
      const lateral =
        c.speed < 1
          ? Math.min(Math.abs(od - myO), Math.abs(od - myO - dRate * arrive))
          : Math.abs(od - myO);
      // Clearances grow with the width the other car takes across the track (spun, turning).
      const wide = c.halfWidth - BODY_HALF_WIDTH;
      const inPathAt = IN_PATH + wide;
      // (A car standing still owns no corner: it is an obstacle where it is, or nothing, as when
      // it sits in the run-off.)
      const owns = cornering && ds >= 0.6 * CAR_LENGTH && c.id !== this.passId && c.speed >= 1;
      // The car being passed, in a committed move out of its lane, is in the way only if the
      // bodies would come within a hand's width.
      const passing =
        c.id === this.passId &&
        (this.passCommitted
          ? Math.abs(od - this.o) >= inPathAt - 0.5
          : // Round a stopped car: out of its lane where the car is, not where it means to be
            // (short of that it stops for it, with room to steer out).
            this.passBypass && lateral >= inPathAt - 0.5);
      const inLane =
        c.id !== this.passId &&
        ds > 0 &&
        ds < bypassReach &&
        Math.abs(c.d - bypassLane) < CAR_WIDTH + wide + PASS_CLEARANCE;
      const pitInPath =
        c.pitApproach === true &&
        pitCarInPath(self.d, c.d, this.at(line.d, c.s) + this.o, BODY_HALF_WIDTH, c.halfWidth);
      const closing = Math.max(0, v - c.speed);
      const clearWidth = CAR_WIDTH + wide + PASS_CLEARANCE;
      const clearingTime =
        SEE_DELAY +
        this.skill.reaction +
        REACT_MARGIN +
        (1.2 * Math.max(0, clearWidth - lateral)) / Math.max(0.1, Math.abs(dRate));
      const closingAcceleration =
        (this.brakeAt(c.speed) / BRAKE_SHARE) * this.leaderBrakeScale() +
        Math.max(0, plan.model.drive(v, false, true));
      const clearingRoom =
        STANDSTILL_GAP +
        closing * clearingTime +
        0.5 * closingAcceleration * clearingTime * clearingTime;
      const pullingOut =
        later &&
        !cornering &&
        !this.passBypass &&
        c.id === this.passId &&
        dRate * (self.d - c.d) > 0 &&
        Math.abs(od - this.o) >= clearWidth &&
        ds - CAR_LENGTH > clearingRoom;
      const inPath =
        pitInPath ||
        (!pullingOut &&
          (passing
            ? lateral < clearWidth
            : lateral < inPathAt || Math.abs(od - this.o) < inPathAt || owns || inLane));
      // Ahead and in the way (or overlapping it already): follow it.
      if (ds > 0 && inPath && !(ds < CAR_LENGTH && lateral >= CAR_WIDTH + wide)) {
        // The queue in this car's lane, further cars included (see `queueLimit`).
        if (nq < this.queue.length) {
          const q = this.queue[nq++]!;
          q.ds = ds;
          q.speed = c.speed;
        }
        if (ds < leaderDs) {
          leaderDs = ds;
          leader = c;
        }
        // Staggered cars close ahead still bound our lateral room so we do not cut across their
        // rear quarter while braking into a corner.
        if (lateral < BODY_HALF_WIDTH || ds >= CAR_LENGTH + 1.5 + closing * 0.25) continue;
      } else if (ds >= CAR_LENGTH + 1 + closing * 0.6) {
        continue;
      }
      if (ns < side.length) {
        const e = side[ns++]!;
        e.car = c;
        e.ds = ds;
        e.od = od;
        // (Plus how far this car moves across in the time it takes to see and react: the line
        // sweeping under a car near it carried it into the one beside, at Singapore's turn 1.)
        // (A car standing still is placed where this one will be beside it, above.)
        e.sep =
          SIDE_BY_SIDE +
          wide +
          (c.speed >= 1 ? Math.abs(dRate) * (SEE_DELAY + this.skill.reaction) : 0);
        e.left = myO >= od;
      }
    }
    // Lateral room beside them. When there is none for this car, the car further back gives
    // way: drop the rearmost car from the bands until there is room; a car dropped that is ahead
    // of this one is one to fall in behind (followed like a car ahead).
    let lo: number;
    let hi: number;
    let yieldTo: TrafficCar | null = null;
    let yieldDs = Number.POSITIVE_INFINITY;
    let yieldLaneHeld = false;
    let skipBelow = Number.NEGATIVE_INFINITY;
    for (;;) {
      lo = oMin;
      hi = oMax;
      for (let k = 0; k < ns; k++) {
        const e = side[k]!;
        if (e.ds <= skipBelow) continue;
        if (e.left) lo = Math.max(lo, e.od + e.sep);
        else hi = Math.min(hi, e.od - e.sep);
      }
      if (lo <= hi) break;
      let rear = -1;
      for (let k = 0; k < ns; k++) {
        const e = side[k]!;
        if (e.ds > skipBelow && (rear < 0 || e.ds < side[rear]!.ds)) rear = k;
      }
      if (rear < 0) break;
      const e = side[rear]!;
      skipBelow = e.ds;
      const aheadOfMe = e.ds > 0 || (e.ds > -1 && e.car.id < self.id);
      if (aheadOfMe && e.ds < yieldDs) {
        yieldDs = e.ds;
        yieldTo = e.car;
      }
    }
    if (lo > hi) {
      lo = oMin;
      hi = oMax;
    }
    // Once a band has to be dropped, hold the lane on that car's side while the longitudinal
    // yield opens room. This includes the car yielded to: braking does not clear its body.
    const protectBodies = laterLap && !this.hazard;
    let droppedOverlap = false;
    for (let k = 0; k < ns; k++) {
      const e = side[k]!;
      if (e.ds > skipBelow) continue;
      if (protectBodies && Math.abs(e.ds) < CAR_LENGTH + 2 && e.car.speed >= HAZARD_SPEED)
        droppedOverlap = true;
      if (e.left) lo = Math.max(lo, protectBodies ? Math.max(myO, this.o) : Math.min(myO, this.o));
      else hi = Math.min(hi, protectBodies ? Math.min(myO, this.o) : Math.max(myO, this.o));
    }
    if (lo > hi) {
      if (
        (droppedOverlap ||
          (yieldTo !== null &&
            (!cornering || yieldDs < CAR_LENGTH + 2) &&
            yieldTo.speed >= HAZARD_SPEED)) &&
        !this.hazard &&
        !this.passBypass &&
        !this.recovering
      ) {
        // Keep the current lane on approach, and until overlapping bodies are clear under
        // braking. A future road bound cannot pull this car through the one beside it.
        const margin = BODY_HALF_WIDTH + EDGE_MARGIN;
        const hereLo = -(this.at(plan.track.halfWidth[1], s0) - margin) - ldHere;
        const hereHi = this.at(plan.track.halfWidth[0], s0) - margin - ldHere;
        lo = hi = Math.max(hereLo, Math.min(hereHi, myO));
        yieldLaneHeld = true;
      } else lo = hi = Math.max(oMin, Math.min(oMax, this.o));
    }
    // (A car level or behind that this one gives way to, followed at a crawl, gave way to this
    // one too: two cars side by side into La Source followed each other to a standstill.)
    if (yieldTo && yieldDs < leaderDs && (yieldDs > 0 || v >= LEVEL_YIELD_SPEED)) {
      leader = yieldTo;
      leaderDs = yieldDs;
    }

    // Passing: start on a straight, carry on, or give up (not alongside by the braking zone,
    // no room, or too long).
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.switchbackTime = Math.max(0, this.switchbackTime - dt);
    if (this.switchbackTime === 0) this.switchbackId = -1;
    const profV = plan.profile.v;
    const moveV = later ? this.inner.speedProfileFor(tel).v : profV;
    const gapAhead = leader ? leaderDs - CAR_LENGTH : Number.POSITIVE_INFINITY;
    if (leader && gapAhead < 20 + v * 0.5 && v < this.at(profV, s0) - 1) this.heldTime += dt;
    // (Out beside the car in a move, it is still the car that held this one up.)
    else if (this.passId < 0) this.heldTime = Math.max(0, this.heldTime - 2 * dt);
    let base = 0;
    // How hard the car being passed (else the car ahead) is braking: seen speeds, smoothed over
    // 50 ms, kept for one car at a time.
    const watched = passCar ?? leader;
    if (watched !== null && watched.id === this.passSeenId && this.passSeenV >= 0 && dt > 0) {
      const a = (this.passSeenV - watched.speed) / dt;
      this.passDecel += (a - this.passDecel) * Math.min(1, dt / 0.05);
    } else this.passDecel = 0;
    // And how fast it goes through the corners, against this car's own profile there (kept for
    // that car while it is out of sight a moment, as when this one pulls out beside it).
    if (watched !== null) {
      if (watched.id !== this.aheadPaceId) {
        this.aheadPaceId = watched.id;
        this.aheadPace = 1;
      }
      if (Math.abs(this.at(line.curvature, watched.s)) > CORNER_CURVATURE) {
        const r = watched.speed / Math.max(1, this.at(plan.profile.v, watched.s));
        this.aheadPace += (Math.min(1.2, r) - this.aheadPace) * Math.min(1, dt / 2);
      }
    }
    this.passSeenV = watched !== null ? watched.speed : -1;
    this.passSeenId = watched !== null ? watched.id : -1;
    if (this.passId < 0) {
      this.passCommitted = false;
      this.passBypass = false;
    }
    if (this.passId >= 0) {
      const lost =
        !passCar ||
        // From lap two, a move that has dropped well back is over (its lane is not held
        // against a car that far up the road).
        (later && !this.passCommitted && !this.passBypass && passDs > DROPPED_BACK) ||
        (this.passTime > 15 && !this.passCommitted && !this.passBypass) ||
        this.passTime > 30;
      // Round a stopped car: over once it moves off again (it is traffic then, not an obstacle).
      const movedOff = this.passBypass && passCar !== null && passCar.speed > BYPASS_SPEED;
      let done = passCar !== null && passDs < -(CAR_LENGTH + 2);
      // Going round a stopped queue: past one car, on to the next one stopped ahead of it.
      if (done && this.passBypass && passCar !== null) {
        const next = this.nextStopped(view, passCar);
        if (next !== null) {
          this.passId = next.id;
          done = false;
        }
      }
      // Into the braking zone, decided once: a car held up behind one that brakes earlier goes
      // on if, braking at its own point, it would be level by the turn-in with room on its side
      // all the way; otherwise the corner is the other car's, as it is for any car not alongside.
      // Only from a real overlap (front wheels level with the other car's rear wheels): a dive
      // from further back is not level by the apex, and the car ahead turns in across it.
      // (Unless the car ahead is slow in corners: it is still braking when this one turns in.)
      if (
        cornering &&
        !this.passCommitted &&
        passCar !== null &&
        passDs >= 0.6 * CAR_LENGTH &&
        // (From lap two, up to a length behind an overlap once out of the car's path.)
        (passDs < OVERLAP ||
          (later &&
            passDs < OVERLAP + LATE_DIVE &&
            Math.abs(passCar.d - ldHere - myO) >= CAR_WIDTH + PASS_CLEARANCE) ||
          this.slowInCorners(passCar.id)) &&
        this.heldTime > 1.5 - aggression
      ) {
        const lane =
          passCar.d -
          ldHere +
          this.passSide * (passSideBySide(v) + passCar.halfWidth - BODY_HALF_WIDTH);
        // (From lap two only on the inside of the corner: round the outside of La Source the
        // line runs to the edge, the lane closed, and the two cars met.)
        const inside = this.cornerSign(s0, true);
        this.passCommitted =
          (!later || inside === 0 || inside === this.passSide) &&
          this.laneClear(view, s0, lane, passCar.id) &&
          this.levelInTime(
            s0,
            v,
            passDs,
            Math.max(0, passCar.speed),
            this.passDecel,
            lane,
            this.passSide,
            moveV,
          );
      }
      // On later laps a closing move can use the remaining straight before our braking
      // point. It still gives up before braking without overlap; lap one keeps its early hold.
      const approach =
        later && passCar !== null && v > passCar.speed + 0.5 && !this.slowInCorners(passCar.id)
          ? toCorner < 15 + v * 0.15 || midCorner
          : cornering;
      const late =
        passCar !== null &&
        !this.passBypass &&
        (this.passCommitted
          ? midCorner && passDs >= ALONGSIDE
          : approach && passDs >= 0.6 * CAR_LENGTH);
      // (Round an obstacle the car ahead in the gap is followed through it, not a reason to stop.)
      const blockedByOther =
        !this.passBypass && leader !== null && leader.id !== this.passId && gapAhead < 25;
      if (late && passCar !== null && !this.passBypass && this.passCommitted) {
        // An inside attack that does not earn overlap falls back. On the exit, try the
        // opposite lane behind the defender; ordinary lane and gap checks still apply.
        this.switchbackId = passCar.id;
        this.switchbackSide = -this.passSide;
        this.switchbackTime = 12;
      }
      // A stopped or crawling car ahead: no racing a car still at speed toward it (as under a
      // yellow). Going round a stopped or crawling car is not a race and goes on.
      const yellow =
        this.hazard && !this.passBypass && passCar !== null && passCar.speed >= HAZARD_SPEED;
      const notAlongside = firstCorner && !this.passBypass && passCar !== null && passDs >= OVERLAP;
      if (lost || done || late || blockedByOther || movedOff || yellow || notAlongside) {
        // (From lap two a move given up before a braking zone may go again sooner after it.)
        if (!done && !blockedByOther && !movedOff)
          this.cooldown = this.passBypass ? 1 : later && late ? LATE_COOLDOWN : 3;
        // Given up off the line in or just before a braking zone from lap two: the car keeps its
        // lane on the road through the corner, as a committed move does. Swinging back to the
        // line under braking slid a car, its brakes eased, and it ran off the road at Monza's third chicane.
        if (
          laterLap &&
          !done &&
          !this.passBypass &&
          (cornering || midCorner || this.at(this.brakingAhead, s0) < v * ABANDON_HOLD_BEFORE) &&
          Math.abs(myO) > 1
        )
          this.abandonHold = true;
        this.passId = -1;
      } else {
        this.passTime += dt;
        const od = passCar!.d - ldHere;
        const sideBySide = this.passBypass ? BYPASS_SIDE_BY_SIDE : passSideBySide(v);
        base = od + this.passSide * (sideBySide + passCar!.halfWidth - BODY_HALF_WIDTH);
        const fits = this.passBypass || (this.passSide > 0 ? base <= oMax : base >= oMin);
        // From lap two, on a straight and still well back: stay in the other car's wake, in its
        // lane, and pull out once close (or with the braking zone two seconds off). Pulled out
        // early, the tow is gone and the move dies with the straight.
        // (Nor through a fast bend: a car swerving out at speed there runs out of front grip and
        // lifts, and lost 15 m/s through Blanchimont.)
        const curving =
          Math.abs(this.at(line.curvature, s0)) > 0.5 * CORNER_CURVATURE ||
          Math.abs(this.at(line.curvature, s0 + v)) > 0.5 * CORNER_CURVATURE;
        const towHold =
          later &&
          !this.passCommitted &&
          !this.passBypass &&
          v > TOW_HOLD_FROM &&
          (curving ||
            (!cornering &&
              passDs - CAR_LENGTH > STANDSTILL_GAP + v * TOW_PULL_OUT &&
              toCorner > v * TOW_PULL_OUT_BEFORE));
        // Committed, the move holds as far over as the track allows (the lane was checked to the
        // turn-in); it does not give up beside the other car. (Held in the wake, the lane beside
        // is not needed yet.)
        this.passBlocked = fits || this.passCommitted || towHold ? 0 : this.passBlocked + dt;
        if (!fits && this.passCommitted) base = Math.max(oMin, Math.min(oMax, base));
        // Level at the corner: it is this car's corner. It keeps the lane it is in through it
        // (a swerve back to the line in a chicane would throw the car off the road); the rules
        // for cars side by side keep the air between them, and the line comes back once clear.
        if (this.passCommitted && passDs < ALONGSIDE && (cornering || midCorner)) base = this.o;
        if (towHold) base = od;
        // From lap two, out of the wake and not gaining on the car: given up here, on the
        // straight. Kept on beside it at the same speed, the move ended under braking and the car
        // came back across to the line there, off the road at Monza's third chicane.
        this.passStall =
          later && !this.passCommitted && !towHold && v < passCar!.speed + 0.5
            ? this.passStall + dt
            : 0;
        if (this.passBlocked > 0.6 || this.passStall > PASS_STALL) {
          if (
            laterLap &&
            (cornering || midCorner || this.at(this.brakingAhead, s0) < v * ABANDON_HOLD_BEFORE) &&
            Math.abs(myO) > 1
          )
            this.abandonHold = true;
          this.passId = -1;
          this.cooldown = 3;
          this.passStall = 0;
          base = 0;
        } else if (this.passBypass) {
          // Round a stopped car the lane is the one beside it on the road; a car already further
          // out keeps that extra air, up to half a metre (never past the edges).
          base =
            this.passSide > 0
              ? Math.min(Math.max(base, Math.min(myO, oMax)), base + 0.5)
              : Math.max(Math.min(base, Math.max(myO, oMin)), base - 0.5);
        } else if (this.passSide > 0) {
          base = Math.max(base, Math.min(myO, oMax));
        } else {
          base = Math.min(base, Math.max(myO, oMin));
        }
      }
    }
    // A hazard cancels racing, not the lane held through braking: the slow target becoming
    // a crawling hazard must not send the car back across the road in the middle of a corner.
    if (this.abandonHold) {
      const past =
        !cornering && !midCorner && this.at(this.brakingAhead, s0) >= v * ABANDON_HOLD_BEFORE;
      if (this.passId >= 0 || past || !laterLap) this.abandonHold = false;
      else base = Math.max(oMin, Math.min(oMax, myO));
    }
    const launched = !view.launching && (v > LAUNCHED || (leader !== null && leader.speed < 5));
    const held = this.heldTime > 1.5 - aggression;
    // From lap two, behind a car seen to corner slower than this car's own plan: quicker than
    // it, even where its pace holds this one only a little (cars a few places apart differ by
    // under a metre a second in the corners, too little to count as held up).
    const quicker =
      later && leader !== null && this.aheadPaceId === leader.id && this.aheadPace < PRESS_PACE;
    // A car standing still in the road ahead (crashed, parked, or the back of a queue that has
    // stopped behind one) is an obstacle, in a corner as on a straight. Seen from as far off as
    // a driver would brake for it, every car heads for the same side of it (the one with more
    // road), so the cars behind go round it in single file, each following the one ahead
    // through the gap, and nothing waits on the obstacle moving.
    const ob = view.active && !view.launching ? this.obstacleAhead(view, s0, v) : null;
    if (ob !== null && ob.id === this.obstructId) this.obstructTime += dt;
    else {
      this.obstructId = ob !== null ? ob.id : -1;
      this.obstructTime = 0;
    }
    if (ob !== null && this.passId < 0 && this.obstructTime > 0.3) {
      const track = plan.track;
      const roomLeft = this.at(track.halfWidth[0], ob.s) - ob.d;
      const roomRight = this.at(track.halfWidth[1], ob.s) + ob.d;
      // (Much the same room either side, as for a car stopped on the centreline: the side this
      // car is on already, which is the side the cars ahead of it took.)
      const first =
        Math.abs(roomLeft - roomRight) < 1
          ? view.self.d >= ob.d
            ? 1
            : -1
          : roomLeft > roomRight
            ? 1
            : -1;
      // Where the line swings across the road beside it (a chicane), a car going round trails
      // its lane into the stopped car: no way round there. The queue stops behind it, and the
      // race session makes a car the queue stands behind a ghost (race-rules.md).
      // The side with more road, if the lane fits there; the other only if it does not. A car
      // in the lane is waited for, not avoided by the other side: the field would split round
      // both sides and meet beyond it.
      const roadSide = this.bypassRoad(s0, ob, first)
        ? first
        : this.bypassRoad(s0, ob, -first)
          ? -first
          : 0;
      const side =
        this.lineSweeps(ob.s) || roadSide === 0 || !this.bypassFits(view, s0, ob, roadSide)
          ? 0
          : roadSide;
      if (side !== 0) {
        this.passId = ob.id;
        this.passSide = side;
        this.passTime = 0;
        this.passBlocked = 0;
        this.passStall = 0;
        this.passCommitted = false;
        this.passBypass = true;
        base = ob.d - ldHere + side * (BYPASS_SIDE_BY_SIDE + ob.halfWidth - BODY_HALF_WIDTH);
      }
    }
    // Into a braking zone (not the corner itself): held up behind a car that has begun braking
    // and is being caught, a move may start here too, but only one that is sure (below).
    const brakingMove =
      cornering &&
      !midCorner &&
      held &&
      leader !== null &&
      (leaderDs < OVERLAP || this.slowInCorners(leader.id)) &&
      v - leader.speed > 2 &&
      this.passDecel > 2 &&
      gapAhead < 25 + v * 0.5;
    if (
      this.passId < 0 &&
      leader &&
      !(this.hazard && leader.speed >= HAZARD_SPEED) &&
      !(firstCorner && leaderDs >= OVERLAP) &&
      this.cooldown <= 0 &&
      (!cornering || brakingMove) &&
      launched &&
      leader !== yieldTo
    ) {
      const faster = this.at(profV, leader.s) > leader.speed + 2 - 1.5 * aggression;
      // A solo-profile speed deficit can mean the leader is still accelerating. Stay in
      // its tow until actually closing, unless it has already shown a slow corner pace.
      // (From lap two a car measured quicker through the corners goes too: the move holds in
      // the wake until close, `towHold`, so it gives up no tow by starting.)
      const gaining = !later || v > leader.speed + 0.5 || this.slowInCorners(leader.id) || quicker;
      if ((brakingMove || gapAhead < 25 + v * 0.25) && (faster || held || quicker) && gaining) {
        const od = leader.d - ldHere;
        const sep = passSideBySide(v) + leader.halfWidth - BODY_HALF_WIDTH;
        // A side on the track, and not a lane another car is already in, beside or just behind
        // (round an obstacle: room on the road beside it, and nothing in that lane up to it).
        const left = od + sep <= oMax && this.laneFree(view, s0, od + sep, leader.id);
        const right = od - sep >= oMin && this.laneFree(view, s0, od - sep, leader.id);
        let side = 0;
        if (left && right) {
          // The inside of the next corner, else the side the car is already on.
          // (The next braking zone counts on open road: the car ahead at speed and nothing
          // beyond it for 300 m, which a lane chosen for a corner that far on would run into.)
          const open = leader.speed > 30 && this.roadOpen(view, leader.s, leader.id);
          const k = this.cornerSign(leader.s, open);
          side = k !== 0 ? k : myO >= od ? 1 : -1;
        } else if (left) side = 1;
        else if (right) side = -1;
        if (!cornering && leader.id === this.switchbackId) {
          if ((this.switchbackSide > 0 && left) || (this.switchbackSide < 0 && right)) {
            side = this.switchbackSide;
          }
        }
        const lane = od + side * sep;
        // A move started in the braking zone is committed from the start, or not made.
        const insideHere = this.cornerSign(s0, true);
        const sure =
          !cornering ||
          (side !== 0 &&
            (!later || insideHere === 0 || insideHere === side) &&
            this.laneClear(view, s0, lane, leader.id) &&
            this.levelInTime(
              s0,
              v,
              leaderDs,
              Math.max(0, leader.speed),
              this.passDecel,
              lane,
              side,
              moveV,
            ));
        if (side !== 0 && sure) {
          this.passId = leader.id;
          this.passSide = side;
          this.passTime = 0;
          this.passBlocked = 0;
          this.passStall = 0;
          this.passCommitted = cornering;
          base = lane;
        } else this.cooldown = 1;
      }
    }
    if (this.skill.aggression > 0.65 && !view.launching && v > LAUNCHED) {
      const lane = defensiveLane(
        view,
        this.defence,
        this.cornerSign(s0, true),
        cornering || this.passDecel > 2,
        midCorner,
        oMin,
        oMax,
        plan.track.length,
      );
      if (this.passId < 0 && leader === null && !view.blueFlag) {
        base = cornering && this.defence.used ? this.o : lane;
      }
    }
    // Blue flag: move over to the side away from the car lapping this one, and stay there
    // until it is by (the side chosen once, so the line crossing the track does not swing the
    // car back into its way).
    if (!view.blueFlag) this.blueSide = 0;
    else if (this.passId < 0) {
      if (this.blueSide === 0) {
        let lapper: TrafficCar | null = null;
        for (let k = 0; k < view.count; k++)
          if (view.cars[k]!.id === view.blueBy) lapper = view.cars[k]!;
        const theirs = lapper ? lapper.d - this.at(line.d, lapper.s) : 0;
        this.blueSide = lapper ? (theirs > myO ? -1 : 1) : oMax >= -oMin ? 1 : -1;
      }
      base = this.blueSide > 0 ? Math.min(SIDE_BY_SIDE, oMax) : Math.max(-SIDE_BY_SIDE, oMin);
    }
    // Back in the racing driver's hands after the pit lane (or any spell without it): rejoin
    // from where the car is, as after a spin.
    if (view.active && !this.wasActive && !view.launching) {
      this.o = myO;
      this.rejoinTime = 4;
    }
    this.wasActive = view.active;
    if (this.rejoinTime > 0) {
      // Just rejoined after a spin: come back to the line only as the traffic allows.
      this.rejoinTime = Math.max(0, this.rejoinTime - dt);
      // (A move away from the line, to pass or for a blue flag, still stands.)
      if (this.carApproaching(view, s0, self.d, 80) && Math.abs(myO) > Math.abs(base)) base = myO;
    }

    // The target offset: as close to the base as the cars alongside and the edges allow.
    let target = Math.max(lo, Math.min(hi, base));
    // A free lane holds on the road, not against a racing line that sweeps under it.
    // Active passes and the alongside bands already choose a safe lane; do not freeze their
    // avoidance or their return after an abandoned move.
    const hold =
      opening &&
      v > LAUNCHED &&
      cornering &&
      !midCorner &&
      !this.hazard &&
      !this.passBypass &&
      !this.recovering &&
      this.passId < 0 &&
      this.cooldown <= 0 &&
      ns === 0 &&
      brakingTraffic(view, plan.track.length);
    if (hold) {
      if (!this.brakingHold) this.brakingLane = ldHere + this.o;
      target = Math.max(lo, Math.min(hi, this.brakingLane - ldHere));
    }
    this.brakingHold = hold;
    if (
      v > HAZARD_SPEED &&
      !view.launching &&
      !this.crawlAhead &&
      this.rejoinTime <= 0 &&
      !this.passBypass &&
      !this.recovering &&
      yieldTo === null
    ) {
      // A car can slow below launch speed in moving traffic; only launch/crawl and recovery
      // exclude the mirror check. Check the road lane ahead as well as the offset: the racing
      // line sweeps across the road while a car returns to it, even with its offset held.
      const ldNext = this.at(line.d, s0 + v * 0.5);
      target = mirrorOffset(
        view,
        target,
        plan.track.length,
        SEE_DELAY + this.skill.reaction,
        ldHere,
        ldNext,
      );
    }
    if (
      v > HAZARD_SPEED &&
      !view.launching &&
      view.openingLap !== true &&
      !this.crawlAhead &&
      this.rejoinTime <= 0 &&
      !this.passBypass &&
      !this.recovering
    ) {
      // Racing room, on the road where the car will be: through a sweep the line carries a car
      // held on it across the road into a car overlapping it on the inside. (From lap two: the
      // opening lap's pack keeps its own rules, lanes held under braking.)
      const ldNext = this.at(line.d, s0 + v * 0.5);
      // (The road's edges still bound it: room is left on the road, never off it.)
      target = Math.max(
        lo,
        Math.min(hi, roomLane(view, ldNext + target, plan.track.length) - ldNext),
      );
    }
    const yielding = yieldTo !== null;
    // Launching, the car holds its grid lane while traction is limited.
    // A queue forming behind a car standing in the road ahead (`QUEUE_BRAKE`, `QUEUE_GAP`,
    // `CAUTION_DECEL`, the lane and steering at walking pace below). Not off the grid: there
    // every car ahead stands still until the lights go out.
    const standing =
      view.active && !view.launching
        ? this.nearestStanding(view, s0, QUEUE_SEE + QUEUE_SEE_TIME * v)
        : -1;
    const queueStop = standing >= 0;
    if (queueStop) this.queueCrawl = true;
    else if (v >= SLOW_STEER_BELOW) this.queueCrawl = false;
    // Off the line (in a move, or coming back from one) the line sweeps across under the car into
    // a braking zone and through a chicane: the held offset may change as fast as the line moves,
    // on top of the lateral rate, so that the lane on the road holds and the edges never jerk it.
    const sweep =
      this.passId >= 0 || Math.abs(this.o) > 0.3
        ? Math.abs(this.at(line.d, s0 + v * dt) - ldHere) / dt
        : 0;
    const oBefore = this.o;
    const rate = Math.min(
      LATERAL_RATE,
      LATERAL_SLOPE * Math.max(v, this.passBypass ? BYPASS_SLOPE_FROM : LATERAL_SLOPE_FROM),
    );
    // (A move picked on the grid waits for the car to roll: the lane drifted 1.5 m from a car
    // standing for the lights, and it left them on full lock and slid half round at Spa.)
    if (view.launching && (this.passId < 0 || tel.speed < 1)) this.o = myO;
    else if ((queueStop || this.queueCrawl) && sweep > 0) {
      // Throughout the queue the lane moves on the road, toward the target lane at no more
      // than the car's own lateral rate. (Adding the rate to the line's sweep crossed a target
      // lying the way the line swept at twice the sweep: at Raidillon,
      // behind a stopped car, cars on full lock swung a radian across and ran off the road.)
      const ldNext = this.at(line.d, s0 + v * dt);
      this.o = this.approach(ldHere + this.o, ldNext + target, dt, rate) - ldNext;
    } else this.o = this.approach(this.o, target, dt, rate + sweep);
    // The held offset is from the line, and the line sweeps across the track into a corner
    // faster than the offset comes back: keep line + offset on the track here and now (not
    // while rejoining from off it).
    if (this.rejoinTime <= 0 && !this.recovering) {
      const ld0 = this.at(line.d, s0);
      const margin = BODY_HALF_WIDTH + EDGE_MARGIN;
      let eLo = Math.min(0, -(this.at(plan.track.halfWidth[1], s0) - margin) - ld0);
      let eHi = Math.max(0, this.at(plan.track.halfWidth[0], s0) - margin - ld0);
      // From lap two, where the line itself runs the car's centre more than `LINE_EDGE_SLACK`
      // past the white line (Singapore's turn 7 and its other kerbs, two places at Spa), the car
      // keeps that close: a few tenths wider there and all four wheels were off. (Lap one keeps
      // the line, as the starts were proved on it.)
      if (later) {
        eLo = Math.max(eLo, -(this.at(plan.track.halfWidth[1], s0) + LINE_EDGE_SLACK) - ld0);
        eHi = Math.min(eHi, this.at(plan.track.halfWidth[0], s0) + LINE_EDGE_SLACK - ld0);
      }
      this.o = Math.max(eLo, Math.min(eHi, this.o));
    }
    // In a move the lane is held against the line sweeping under it, and the controller
    // underneath steers for the offset's change as well as for the offset (it would trail the
    // lane by a metre or more, into the other car).
    const slope =
      (this.passId >= 0 || hold || yieldLaneHeld || this.abandonHold) && v > 5
        ? (this.o - oBefore) / (v * dt)
        : 0;
    this.inner.offsetSlope = Math.max(-0.15, Math.min(0.15, slope));

    // The pedals: follow the car ahead, drop back when squeezed, slow off line in a corner.
    // An established racing attack uses stopping distance over the whole speed range. Keep
    // the existing opening-lap, crawl and known slow-car queue rules.
    const grip = Math.min(
      1,
      tel.tyreGrip *
        Math.min(
          1,
          plan.model.envelope.conditions.mass / (this.params.mass.dryMass + tel.fuelMass),
        ),
    );
    const lateral = Math.abs(this.at(line.curvature, s0)) * v * v;
    const lateralCapacity = this.lateralShare * plan.model.lateral(v, 1) * grip;
    const brakeScale =
      later && this.attacking() && !queueStop && !midCorner && !this.slowInCorners(this.passId)
        ? BRAKE_SHARE *
          grip *
          plan.model.remaining(lateralCapacity > 0 ? lateral / lateralCapacity : 1)
        : 0;
    let limit = Number.POSITIVE_INFINITY;
    // A car standing in the road ahead: arrive no faster than slows to a crawl beside it
    // (`CAUTION_DECEL`), in whatever lane. Where the line sweeps, reach the crawl before the
    // sweep starts: a car braking and changing lane on the climb has little yaw margin.
    if (queueStop) {
      const toIt = Math.max(
        0,
        standing - CAR_LENGTH - (this.lineSweeps(s0 + standing) ? QUEUE_SWEEP_CLEARANCE : 0),
      );
      const vCaution = Math.sqrt(BYPASS_SPEED * BYPASS_SPEED + 2 * CAUTION_DECEL * toIt);
      limit = Math.min(limit, SPEED_GAIN * (vCaution - v));
    }
    if (leader) {
      const gap = gapAhead;
      const vl = Math.max(0, leader.speed);
      const attacking = leader.id === this.passId;
      const tS = HEADWAY_STRAIGHT[0] + (HEADWAY_STRAIGHT[1] - HEADWAY_STRAIGHT[0]) * aggression;
      const tC = HEADWAY_CORNER[0] + (HEADWAY_CORNER[1] - HEADWAY_CORNER[0]) * aggression;
      // From lap two, held up behind a car it is quicker than, the driver presses: it follows
      // closer through the corners, to be on the car's gearbox at the exit for the run to the
      // next braking zone (the kinematic limit below is unchanged).
      // (Not through braking zones and corners: pressing through Monza's third chicane, a car braking
      // harder mid-corner for the car ahead ran off both sides and into the barrier.)
      const pressing = later && (held || quicker) && !queueStop && !cornering;
      const tFollow = tC + (tS - tC) * straightness;
      const headway = attacking
        ? HEADWAY_ATTACK
        : pressing
          ? Math.min(tFollow, HEADWAY_PRESS)
          : tFollow;
      const standstill = queueStop ? QUEUE_GAP : STANDSTILL_GAP;
      const want = standstill + v * headway;
      const vSafe = vl + (gap - want) * GAP_GAIN;
      // Never closer than could be stopped from if the car ahead braked now as hard as this one
      // can, noticed after this driver's perception and reaction delay (Gipps' safe speed).
      // Grip falls with speed (downforce), so count on what the brakes give at the slower end.
      const b = this.stopBrake(v, vl, queueStop);
      // In the wake on a straight from lap two, the braking zone well off and the car ahead not
      // braking: it brakes at its braking point, no sooner and no harder than this one can, so
      // the attack sits as close as this driver reacts (the full margins come back over the
      // second before the zone, by when the move has pulled out or dropped back).
      // (Measured to the braking zone, not the next bend: a flat-out kink is no reason to
      // drop back, and dropping the relaxed margin there braked the attack hard at Blanchimont.)
      const relax =
        (attacking || pressing) && later && this.passDecel < 1 && vl > TOW_HOLD_FROM
          ? clamp01((this.at(this.brakingAhead, s0) - v * TOW_RELAX_UNTIL) / Math.max(1, v))
          : 0;
      const tau = SEE_DELAY + this.skill.reaction + REACT_MARGIN * (1 - relax);
      const leaderScale =
        this.leaderBrakeScale() + (Math.min(brakeScale, 1) - this.leaderBrakeScale()) * relax;
      // Behind a car standing still, stop with room to steer out and round it.
      // (Round one, also behind the crawling car ahead in the gap: no nose-to-tail queue on it.)
      // (From walking pace down, before the car ahead is quite still: a queue stopping in front
      // of a stopped car, where the gap needed jumps as the car ahead stops.)
      const stopping = vl < 1 || (vl < 3 && !view.launching);
      const room = gap - (stopping ? STILL_GAP : standstill);
      const vKin =
        room <= 0
          ? vl - 1
          : brakeScale > 0 && vl > 15
            ? this.brakingCurve.safeSpeed(room, vl, tau, brakeScale, leaderScale)
            : -b * tau + Math.sqrt(b * b * tau * tau + vl * vl + 2 * b * room);
      let aSafe = SPEED_GAIN * (vSafe - v);
      const aKin = SPEED_GAIN * (vKin - v);
      // Mid-corner, high lateral load leaves little friction-circle margin for comfort braking:
      // lift smoothly for the headway gap while keeping full braking for kinematic safety (`aKin`).
      if (Math.abs(this.at(line.curvature, s0)) * v * v > 6) {
        const gentle = -Math.max(1.5, plan.model.drag(v, false));
        if (aSafe < gentle) aSafe = gentle;
      }
      let aLim = Math.min(aSafe, aKin);
      // Going round a car that is (nearly) stopped: creep past once the held offset clears it.
      const od = leader.d - ldHere;
      const wide = leader.halfWidth - BODY_HALF_WIDTH;
      const clear = IN_PATH + wide;
      // (Round a stopped car, not closer than 6 m until out beside it: it needs the room to steer
      // out, and backs up for it if it has to.)
      const roomToSteer = !this.passBypass || gap > 6 || Math.abs(od - myO) >= CAR_WIDTH + wide;
      // (A car stopped with no way round it is waited behind: no creeping up on it.)
      const roundable = this.passBypass || leader.speed >= 1;
      if (
        attacking &&
        roundable &&
        roomToSteer &&
        Math.abs(od - this.o) >= clear &&
        (gap > 0.2 || Math.abs(od - myO) >= CAR_WIDTH + wide)
      ) {
        aLim = Math.max(aLim, SPEED_GAIN * (Math.min(5, Math.max(1.5, gap)) - v));
      }
      limit = Math.min(limit, aLim);
    }
    // Off the line the cars ahead all pull away at once: the queue counts only once a car is
    // close ahead in this lane (before that the gaps are the grid's, and they open).
    const queueOn =
      !view.launching || (leader !== null && leaderDs - CAR_LENGTH < LAUNCH_QUEUE_GAP);
    if (nq > 1 && queueOn && !this.passBypass) {
      limit = Math.min(limit, this.queueLimit(nq, v, queueStop, brakeScale));
    }
    limit = Math.min(
      limit,
      this.offLineLimit(s0, v, this.passCommitted && later ? moveV : undefined),
    );
    // Round a stopped car: down to a crawl by the time it gets there, on a gentle braking curve
    // (in a corner the tyres have little to spare), and at the crawl until past it. Stopped too
    // close behind it to steer out (a car turns no tighter than it is long), back up a little
    // first, if the road behind is clear.
    if (this.passBypass && passCar !== null && passDs > -CAR_LENGTH) {
      const toIt = Math.max(0, passDs - CAR_LENGTH);
      const vCrawl = Math.sqrt(BYPASS_SPEED * BYPASS_SPEED + 2 * BYPASS_DECEL * toIt);
      limit = Math.min(limit, SPEED_GAIN * (vCrawl - v));
      const tooClose = passDs - CAR_LENGTH < 6 && Math.abs(target - myO) > 1;
      if (this.reverseTime <= 0 && tooClose && Math.abs(v) < 0.5 && this.clearBehind(view, s0)) {
        this.reverseTime = 1.5;
      }
    }
    // A car stopped in the road ahead with no way round it (yet): stop short of it, with room
    // to steer out, braking from as far off as it is seen (in a chicane it may be in the path
    // only where the line swings across, too late for the car-ahead law).
    if (ob !== null && !this.passBypass) {
      const obDs = this.ahead(s0, ob.s);
      const toStop = Math.max(0, obDs - CAR_LENGTH - STILL_GAP);
      limit = Math.min(limit, SPEED_GAIN * (Math.sqrt(2 * STOP_DECEL * toStop) - v));
      // No passing into a queue stopping for it: the car being passed is followed again (in a
      // move it was out of this car's path, and it stops short of the stopped car).
      if (this.passId >= 0 && passCar !== null && passDs < obDs) {
        this.passId = -1;
        this.passCommitted = false;
        this.cooldown = 3;
      }
    }
    if (this.passId < 0) this.reverseTime = 0;
    // A small error at a corner, from lap two, on the car's own: none in a move, beside another
    // car, behind a hazard or a stopped queue, or while coming back to the road.
    if (!view.active || this.recovering) this.mistakes.cancel();
    else {
      const mayErr =
        later &&
        this.passId < 0 &&
        ns === 0 &&
        !queueStop &&
        this.rejoinTime <= 0 &&
        !view.blueFlag &&
        !yielding &&
        // (Not with a car right behind: too close to react, it ran into a car going wide out
        // of the first chicane.)
        !this.carApproaching(view, s0, self.d, ERROR_CLEAR_BEHIND);
      if (!mayErr) this.mistakes.cancel();
      const u = plan.track.wrap(s0) / plan.track.lap.step;
      limit = Math.min(
        limit,
        this.mistakes.update(
          Math.floor(u),
          v,
          this.at(moveV, s0),
          mayErr,
          this.carApproaching(view, s0, self.d, PRESSURE_BEHIND),
        ),
      );
    }
    // Committed to a move, the exit is where it is made: the full drive the driver asks for.
    // Held up behind a car well under the pace in the corners, likewise: the run to the next
    // braking zone is where the move comes from.
    const slowAhead = held && leader !== null && leader.speed < 0.9 * this.at(profV, leader.s);
    if (!this.passCommitted && !slowAhead) limit = Math.min(limit, this.gripLimit(s0, v));
    // Never ask for more than the brakes give: past the tyres' limit the wheels lock, and the
    // lock-up feel backs the pedal off further than the demand would have.
    limit = Math.max(limit, -this.brakeAt(v) / BRAKE_SHARE);
    this.inner.accelLimit = limit;
    const drafting = later && leader !== null && gapAhead < 90 && leader.speed > 30;
    this.inner.speedAllowance =
      !cornering && v > LAUNCHED && (this.attacking() || drafting) ? 4 : 0;
    this.inner.racingDeploy =
      later && view.active && !cornering && v > LAUNCHED && (this.attacking() || drafting);
    // Stopping for traffic at walking pace: the brakes stay on (see `brakeFloor`).
    this.inner.brakeFloor = limit < -2 && v < SLOW_STOP_BELOW ? SLOW_STOP_BRAKE : 0;
    // Pulling away at walking pace (from a queue, back from the run-off): the throttle stays
    // on (see `throttleFloor`).
    // Not on the grid: the launch's wheelspin control is the reference driver's own.
    this.inner.throttleFloor =
      !view.launching && limit > 0 && v < PULL_AWAY_BELOW ? PULL_AWAY_THROTTLE : 0;
    // Pulling away from a queue off the line, at walking pace: steer back as tight as the car
    // turns there, not on the high-speed limit (it ran wide of the line, off the road).
    this.inner.maxCorrection =
      v < SLOW_STEER_BELOW
        ? BASE_CORRECTION +
          (SLOW_CORRECTION - BASE_CORRECTION) * (1 - Math.max(0, v) / SLOW_STEER_BELOW)
        : BASE_CORRECTION;
    // And no more than half a radian across the road toward its lane: going round a car at
    // walking pace on full lock, a car turned a radian across the road and drove off it.
    this.inner.headingLimit = v < SLOW_STEER_BELOW ? SLOW_HEADING : Number.POSITIVE_INFINITY;
    // And at walking pace round a car stopped in the road the steering turns the car back toward
    // its lane whatever the front tyres' slip: holding it within their peak slip kept a car
    // rotating on full lock (into Raidillon behind a stopped car, round a radian and off the road).
    this.inner.holdFrontSlip = !((queueStop || this.queueCrawl) && v < SLOW_STEER_BELOW);
    // Standing in a queue the steering does not wind up (it held full lock as the car pulled
    // away, off the road). Not on the grid: the launch is the reference driver's own.
    this.inner.integrateFrom = view.launching ? 0 : INTEGRATE_FROM;

    const last = this.last;
    last.target = target;
    last.leader = leader ? leader.id : -1;
    last.gap = gapAhead;
    last.accelLimit = limit;
    last.passing = this.passId;
    last.yielding = yielding;
  }

  /**
   * The friction circle on a corner exit: held up by traffic, a car arrives below its speed
   * profile and the speed feedback would ask for full drive while the tyres still carry the
   * corner. Ask for no more than the traction the cornering load leaves (at this driver's own
   * shares of the envelope); on the profile this never binds, the profile already respects it.
   */
  private gripLimit(s0: number, v: number): number {
    const model = this.plan.model;
    const lat = Math.abs(this.at(this.plan.line.curvature, s0)) * v * v;
    const latMax = this.lateralShare * model.lateral(v, 1);
    if (!(latMax > 0)) return Number.POSITIVE_INFINITY;
    const used = Math.min(1, lat / latMax);
    if (used < 0.3) return Number.POSITIVE_INFINITY;
    return this.tractionShare * model.traction(v, 1) * Math.sqrt(1 - used * used);
  }

  /**
   * A queue in this car's lane (into the first corner, a train of cars): a driver watches the
   * cars beyond the one ahead, and a car braking hard further up the queue is a reason to brake
   * now, before the car ahead does. Each car in the lane sets a safe speed (Gipps, as for the car
   * ahead) with room left for the cars in between: a car length and the standstill gap each.
   */
  private queueLimit(nq: number, v: number, queueStop: boolean, brakeScale = 0): number {
    const q = this.queue;
    // Order by distance (insertion sort; a handful of cars).
    for (let i = 1; i < nq; i++) {
      const ds = q[i]!.ds;
      const sp = q[i]!.speed;
      let j = i - 1;
      while (j >= 0 && q[j]!.ds > ds) {
        q[j + 1]!.ds = q[j]!.ds;
        q[j + 1]!.speed = q[j]!.speed;
        j--;
      }
      q[j + 1]!.ds = ds;
      q[j + 1]!.speed = sp;
    }
    const tau = SEE_DELAY + this.skill.reaction + REACT_MARGIN;
    let limit = Number.POSITIVE_INFINITY;
    for (let r = 1; r < nq; r++) {
      const vl = Math.max(0, q[r]!.speed);
      const room = q[r]!.ds - (r + 1) * (CAR_LENGTH + (queueStop ? QUEUE_GAP : STANDSTILL_GAP));
      const b = this.stopBrake(v, vl, queueStop);
      const vKin =
        room <= 0
          ? vl
          : brakeScale > 0 && vl > 15
            ? this.brakingCurve.safeSpeed(room, vl, tau, brakeScale, this.leaderBrakeScale())
            : -b * tau + Math.sqrt(b * b * tau * tau + vl * vl + 2 * b * room);
      const a = SPEED_GAIN * (vKin - v);
      if (a < limit) limit = a;
    }
    return limit;
  }

  /**
   * The deceleration counted on to stop behind a car going at `vl` (Gipps' safe speed): this
   * car's braking at the slower of the two speeds; in a queue forming behind a stopped car, no
   * more than `QUEUE_BRAKE` behind a car in it that is slow (the stop ends at walking pace, where
   * the brakes give less).
   */
  private stopBrake(v: number, vl: number, queue: boolean): number {
    const b = this.brakeAt(Math.min(v, vl));
    return queue && vl < SLOW_STOP_BELOW && b > QUEUE_BRAKE ? QUEUE_BRAKE : b;
  }

  /** The leader can be lighter and brake at full reference grip; do not give it our margins. */
  private leaderBrakeScale(): number {
    return Math.max(1, this.plan.model.envelope.conditions.mass / this.params.mass.dryMass);
  }

  /** The deceleration this car can be counted on for at speed `v`, m/s² (on its own plan's grip). */
  private brakeAt(v: number): number {
    const model = this.plan.model;
    return BRAKE_SHARE * (model.brake(v, 1) + model.drag(v, false));
  }

  /** Move the held offset toward `target` at the lateral rate. */
  private approach(o: number, target: number, dt: number, rate = LATERAL_RATE): number {
    const step = rate * dt;
    const d = target - o;
    return d > step ? o + step : d < -step ? o - step : target;
  }

  /**
   * +1 if the next real corner beyond `s` turns left, -1 right, 0 if none within 300 m (or,
   * `farAhead`, at the next braking zone however far on).
   */
  private cornerSign(s: number, farAhead: boolean): number {
    const k = this.plan.line.curvature;
    for (let x = 0; x <= 300; x += 6) {
      const c = this.at(k, s + x);
      if (c > CORNER_CURVATURE) return 1;
      if (c < -CORNER_CURVATURE) return -1;
    }
    if (!farAhead) return 0;
    // On a long straight behind a car at speed: the inside of the next braking zone, however
    // far down the straight it is (the outside is where the line runs out to, into the corner).
    const from = this.at(this.cornerAhead, s);
    if (!Number.isFinite(from)) return 0;
    for (let x = from; x <= from + 300; x += 6) {
      const c = this.at(k, s + x);
      if (c > CORNER_CURVATURE) return 1;
      if (c < -CORNER_CURVATURE) return -1;
    }
    return 0;
  }

  /**
   * A ceiling on the acceleration for running off the line: on the inside of a corner the
   * radius is tighter by the offset, so the speed the line allows there scales by
   * sqrt(1 - κ·o), with a small margin for leaving the grip map the line was made on.
   */
  private offLineLimit(s0: number, v: number, profile = this.plan.profile.v): number {
    const o = this.o;
    if (Math.abs(o) < 0.3) return Number.POSITIVE_INFINITY;
    const plan = this.plan;
    const reach = 20 + (v * v) / (2 * 20);
    let limit = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= reach; x += 8) {
      const sx = s0 + x;
      const k = this.at(plan.line.curvature, sx);
      const tight = k * o;
      const attackStraight = this.attacking() && Math.abs(k) <= 0.5 * CORNER_CURVATURE;
      let f = attackStraight ? 1 : 0.985;
      if (tight > 0 && !attackStraight) f *= Math.sqrt(Math.max(0.4, 1 - 1.2 * tight));
      if (this.passCommitted) {
        // Committed to a move the car brakes at its own point, as on the line: on its braking curve to
        // the slower corner speed off line (no margin on a straight, where off line is as fast).
        if (Math.abs(k) <= 0.5 * CORNER_CURVATURE) f = attackStraight ? 1 : f / 0.985;
        if (f >= 1) continue;
        const vMax = this.at(profile, sx) * f;
        if (v <= vMax) continue;
        const b = this.brakeAt(0.5 * (v + vMax)) / BRAKE_SHARE;
        const vAllowed = Math.sqrt(vMax * vMax + 2 * MOVE_BRAKE_SHARE * b * x);
        if (vAllowed < v) limit = Math.min(limit, SPEED_GAIN * (vAllowed - v));
        continue;
      }
      // On the straight an attacker uses the tow and DRS to exceed the solo profile.
      // Corner samples ahead still impose their ordinary braking curve.
      if (this.attacking() && f >= 1) continue;
      const vMax = this.at(profile, sx) * f;
      if (v <= vMax) continue;
      const a = x < 1 ? SPEED_GAIN * (vMax - v) : (vMax * vMax - v * v) / (2 * x);
      if (a < limit) limit = a;
    }
    return limit;
  }

  /**
   * Whether this car draws level with a car `ds` ahead (speed `vl`, braking at `al`) before the
   * turn-in or its lane (offset `laneO` from the line, on `side`) closing: this car keeping to its
   * own speed profile, the other braking as it is, never faster than that profile allows, to no
   * slower than this car's own corner speed (the cautious guess: it may well slow more).
   */
  private levelInTime(
    s0: number,
    v: number,
    ds: number,
    vl: number,
    al: number,
    laneO: number,
    side: number,
    prof = this.plan.profile.v,
  ): boolean {
    const h = 0.05;
    const plan = this.plan;
    const track = plan.track;
    const margin = BODY_HALF_WIDTH + EDGE_MARGIN;
    // The lane may be a little tighter than the air held side by side (down to 0.3 m).
    // On the track, not against the line: the other car keeps to its own lateral position.
    const lane =
      this.at(plan.line.d, s0) + laneO - side * (passSideBySide(v) - CAR_WIDTH - PASS_CLEARANCE);
    // The other car slows to no less than this car's slowest in the corner ahead of it, at the
    // share of this car's pace it has been seen to corner at (and a little more, to be sure).
    const pace = Math.min(1, this.aheadPace + 0.03);
    const vTop = Math.max(v, this.at(prof, s0));
    let vFloor = vl;
    for (let x = 0; x < 300; x += 5) vFloor = Math.min(vFloor, pace * this.at(prof, s0 + ds + x));
    let xa = 0;
    let xl = ds;
    let va = v;
    let vb = vl;
    // The other car's braking as a share of what the car can do at its speed now; downforce
    // falls with speed, so the same share is less deceleration as it slows.
    const capacity = (u: number): number => plan.model.brake(u, 1) + plan.model.drag(u, false);
    const share = vl > 1 ? Math.max(0, al) / capacity(vl) : 0;
    let level = false;
    for (let t = 0; t < 8; t += h) {
      if (xl - xa <= 0) level = true;
      const sx = s0 + xa;
      if (Math.abs(this.at(plan.line.curvature, sx)) > CORNER_CURVATURE) return level;
      const edge =
        side > 0
          ? this.at(track.halfWidth[0], sx) - margin
          : -(this.at(track.halfWidth[1], sx) - margin);
      // The lane must stay on the track to the turn-in, level or not: the line sweeping across
      // to the far edge takes an outside lane off the road.
      if (side > 0 ? edge < lane : edge > lane) return false;
      va = Math.min(this.at(prof, sx), va + 8 * h);
      vb = Math.min(this.at(prof, s0 + xl), Math.max(vFloor, vb - share * capacity(vb) * h));
      // Into the braking zone and the corner, a car that corners at a share of this one's pace
      // (and so brakes earlier) runs at about that share of this car's profile.
      const pb = this.at(prof, s0 + xl);
      if (pb < vTop - 2) vb = Math.min(vb, Math.max(vFloor, pace * pb));
      xa += va * h;
      xl += vb * h;
    }
    return level;
  }

  /**
   * No car but the one being passed in or near the lane at offset `lane` from two lengths behind
   * to well past the turn-in: a move into a corner is made one against one, never into a queue.
   */
  private laneClear(view: TrafficView, s0: number, lane: number, except: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      if (c.id === except) continue;
      const ds = this.ahead(s0, c.s);
      if (ds < -2 * CAR_LENGTH || ds > 250) continue;
      // Any car close ahead, wherever it is: the car being passed is held up by it, and a move
      // made on a car in a queue ends in the back of the next one.
      if (ds > 0 && ds < 120) return false;
      const od = c.d - this.at(this.plan.line.d, s0);
      if (Math.abs(od - lane) < SIDE_BY_SIDE + 1) return false;
    }
    return true;
  }

  /**
   * No car but `except` in the lane at offset `lane`, from three lengths behind to alongside (to
   * 200 m on for a car stopped or crawling).
   */
  private laneFree(view: TrafficView, s0: number, lane: number, except: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      if (c.id === except) continue;
      const ds = this.ahead(s0, c.s);
      // A car beside or just behind is in the way of a move across into its lane; one further up
      // the lane going on is one to follow through, but a car stopped or crawling there closes it.
      const reach = c.speed < 10 ? 200 : CAR_LENGTH;
      if (ds < -3 * CAR_LENGTH || ds > reach) continue;
      const clear = SIDE_BY_SIDE + c.halfWidth - BODY_HALF_WIDTH;
      if (Math.abs(c.d - this.at(this.plan.line.d, s0) - lane) < clear) return false;
    }
    return true;
  }

  /** No car but `except` within 300 m on from `s`. */
  private roadOpen(view: TrafficView, s: number, except: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      if (c.id === except) continue;
      const ds = this.ahead(s, c.s);
      if (ds > 0 && ds < 300) return false;
    }
    return true;
  }

  /**
   * The nearest car standing still in this car's path ahead, within as far as it would brake
   * for it from speed `v`.
   */
  private obstacleAhead(view: TrafficView, s0: number, v: number): TrafficCar | null {
    const reach = 25 + 2.5 * v;
    const d = view.self.d;
    let best: TrafficCar | null = null;
    let bestDs = Number.POSITIVE_INFINITY;
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      if (c.speed >= 1) continue;
      const ds = this.ahead(s0, c.s);
      if (ds <= 0 || ds > reach || ds >= bestDs) continue;
      // A car stopped in a queue behind another is waited behind, not gone round: only the
      // head of a stopped queue is an obstacle (cars weaving between the cars of a queue at
      // walking pace touch them).
      if (this.queuedBehind(view, c)) continue;
      // In the way where this car is now, or where its path (the line, at its offset) runs
      // when it gets there: the line sweeps across the track into a corner.
      const reachHalf = IN_PATH + c.halfWidth;
      const onPath = c.d - this.at(this.plan.line.d, c.s) - this.o;
      if (Math.abs(c.d - d) >= reachHalf && Math.abs(onPath) >= reachHalf) continue;
      best = c;
      bestDs = ds;
    }
    return best;
  }

  /** Car `c` stands still within `QUEUE_REACH` behind another car standing still. */
  private queuedBehind(view: TrafficView, c: TrafficCar): boolean {
    for (let k = 0; k < view.count; k++) {
      const o = view.cars[k]!;
      if (o.id === c.id || o.speed >= 1) continue;
      const ds = this.ahead(c.s, o.s);
      if (ds > 0 && ds < QUEUE_REACH) return true;
    }
    return false;
  }

  /**
   * Distance to a car standing on the road within `range`, m, or −1. In a sweeping chicane,
   * keep the queue rules at zero distance until the car clears the settling region beyond it.
   */
  private nearestStanding(view: TrafficView, s0: number, range: number): number {
    let best = -1;
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (
        c.speed < 1 &&
        c.d - c.halfWidth <= this.at(this.plan.track.halfWidth[0], c.s) &&
        c.d + c.halfWidth >= -this.at(this.plan.track.halfWidth[1], c.s) &&
        (ds > 0 || (ds > -QUEUE_SWEEP_CLEARANCE && this.lineSweeps(c.s))) &&
        ds < range &&
        (best < 0 || Math.max(0, ds) < best)
      )
        best = Math.max(0, ds);
    }
    return best;
  }

  /** The car ahead, watched through corners, is well under the plan's corner speeds. */
  private slowInCorners(id: number): boolean {
    return this.aheadPaceId === id && this.aheadPace < SLOW_IN_CORNERS;
  }

  /** A move on a moving car with the road clear of hazards (tow and DRS speed). */
  private attacking(): boolean {
    return this.passId >= 0 && !this.passBypass && !this.hazard;
  }

  /**
   * A stopped/crawling car, or a slower pit entrant, ahead anywhere across the road: sets
   * `hazard` (no racing moves, tow or headroom) and `crawlAhead` (the stopped or crawling car
   * alone, which also turns off the mirror check and racing room).
   */
  private slowAhead(view: TrafficView, s0: number): void {
    this.hazard = false;
    this.crawlAhead = false;
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (ds <= 0) continue;
      // An entrant can cross the passing lane before the pit wall separates it. Do not race
      // another car into that approach while the entrant ahead is slowing relative to us, and
      // is close enough to be met there (further up the road it is in the lane first).
      const entering = c.pitApproach === true && c.speed < view.self.speed - 2 && ds < ENTRANT_SEE;
      const crawling = c.speed < HAZARD_SPEED && ds < HAZARD_SEE;
      if (crawling) this.crawlAhead = true;
      if (crawling || entering) this.hazard = true;
    }
  }

  /** A car standing still on the road within `range` m ahead, anywhere across it. */
  private standingAhead(view: TrafficView, s0: number, range: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (c.speed < 1 && ds > 0 && ds < range) return true;
    }
    return false;
  }

  /** The car stopped just ahead of `c` in its path, if any. */
  private nextStopped(view: TrafficView, c: TrafficCar): TrafficCar | null {
    for (let k = 0; k < view.count; k++) {
      const o = view.cars[k]!;
      if (o.id === c.id || o.speed >= 1) continue;
      const ds = this.ahead(c.s, o.s);
      if (ds > 0 && ds < CAR_LENGTH + 10 && Math.abs(o.d - c.d) < IN_PATH + o.halfWidth) return o;
    }
    return null;
  }

  /**
   * Room to go round a car `ob` stopped in the road on `side`: its lane beside it on the track,
   * here and where it is, and no car beside this one in that lane.
   */
  private bypassFits(view: TrafficView, s0: number, ob: TrafficCar, side: number): boolean {
    if (!this.bypassRoad(s0, ob, side)) return false;
    const lane = ob.d + side * (BYPASS_SIDE_BY_SIDE + ob.halfWidth - BODY_HALF_WIDTH);
    // A car beside, just behind or just ahead in that lane is in the way of moving across (one
    // further up it is followed through the gap); from as far back as a car beside counts in
    // `planTraffic`.
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      if (c.id === ob.id) continue;
      const ds = this.ahead(s0, c.s);
      // (And up to ten metres past a length ahead: a car just ahead in the gap is let through
      // first, not merged in behind at speed.)
      if (ds < -(CAR_LENGTH + 2) || ds > CAR_LENGTH + 10) continue;
      if (Math.abs(c.d - lane) < SIDE_BY_SIDE + c.halfWidth - BODY_HALF_WIDTH) return false;
    }
    return true;
  }

  /** The road has room for the lane beside `ob` on `side`, here and where it is. */
  private bypassRoad(s0: number, ob: TrafficCar, side: number): boolean {
    const track = this.plan.track;
    const margin = BODY_HALF_WIDTH + EDGE_MARGIN;
    const lane = ob.d + side * (BYPASS_SIDE_BY_SIDE + ob.halfWidth - BODY_HALF_WIDTH);
    const edge = side > 0 ? 0 : 1;
    if (Math.abs(lane) > this.at(track.halfWidth[edge], s0) - margin) return false;
    return Math.abs(lane) <= this.at(track.halfWidth[edge], ob.s) - margin;
  }

  /** No car in this car's path within 4 m behind it (a back-up is two or three metres). */
  private clearBehind(view: TrafficView, s0: number): boolean {
    const d = view.self.d;
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (ds < 0 && ds > -(CAR_LENGTH + 4) && Math.abs(c.d - d) < IN_PATH + c.halfWidth) {
        return false;
      }
    }
    return true;
  }

  /** A car within `range` m behind, at speed, near this lateral position. */
  private carApproaching(view: TrafficView, s0: number, d: number, range: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (ds < 0 && ds > -range && c.speed > 15 && Math.abs(c.d - d) < SIDE_BY_SIDE + 1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Traffic across the track width that a spun car turning on track must wait for: any car
   * approaching at speed within `range` m, or passing close behind/alongside at any speed.
   */
  private trackBusy(view: TrafficView, s0: number, range: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (ds < 0 && ds > -range && c.speed > 15) return true;
      // (A car standing still close by is waiting too, not traffic to wait for.)
      if (ds < CAR_LENGTH && ds > -(CAR_LENGTH + 15) && c.speed >= 1) return true;
    }
    return false;
  }

  /**
   * Backing up to steer out round a stopped car: reverse, the wheels turned so that the nose
   * swings toward the side it goes round on; then first gear again (the controller underneath
   * changes up from first, not out of reverse).
   */
  /**
   * The line crosses the road faster than `SWEEP_MAX` from 40 m before `s` to 60 m past it:
   * across the approach to a stopped car, or past it where a car going round would rejoin the
   * line at walking pace (a queue into a chicane stays in single file too).
   */
  private lineSweeps(s: number): boolean {
    const d = this.plan.line.d;
    for (let x = s - 40; x <= s + 60; x += 2) {
      if (Math.abs(this.at(d, x + 1) - this.at(d, x - 1)) / 2 > SWEEP_MAX) return true;
    }
    return false;
  }

  private backUp(view: TrafficView, tel: CarTelemetry, dt: number, out: ControlInput): void {
    const v = tel.speed;
    const shiftable = !tel.shifting && Math.abs(v) < 1;
    let steer = -this.passSide;
    if (this.reverseTime > 0) {
      // Enough once the car points half a radian off the lap: further, and it turns into a car
      // that has spun. Near an edge it backs straight (the room is what it needs, and a turned
      // back-up swings the tail toward that edge).
      const track = this.plan.track;
      const s0 = view.self.s;
      const line = this.plan.line;
      const heading = line.heading[Math.round(track.wrap(s0) / track.lap.step) % line.count]!;
      const off = Math.abs(wrapAngle(tel.yaw - heading));
      const d = view.self.d;
      const edge =
        d > 0 ? track.halfWidthAt(track.wrap(s0), 0) : track.halfWidthAt(track.wrap(s0), 1);
      if (off > 0.5) this.reverseTime = 0;
      if (Math.abs(d) > edge - 1.5) steer = 0;
      // And never into a car that has come up behind meanwhile (allowing for its closing speed).
      for (let k = 0; k < view.count; k++) {
        const c = view.cars[k]!;
        const ds = this.ahead(s0, c.s);
        const reach = CAR_LENGTH + 2 + Math.max(0, c.speed);
        if (ds < 0 && ds > -reach && Math.abs(c.d - d) < IN_PATH + c.halfWidth)
          this.reverseTime = 0;
      }
    }
    if (this.reverseTime > 0) {
      this.reverseTime = Math.max(0, this.reverseTime - dt);
      out.steer = steer;
      out.drs = false;
      out.overtake = false;
      out.gearShift = shiftable && tel.gear >= 0 ? -1 : 0;
      out.throttle = tel.gear < 0 && v > -3 ? 0.3 : 0;
      out.brake = v > 0.5 || v < -3 ? 0.5 : 0;
      return;
    }
    if (tel.gear < 1) {
      out.gearShift = shiftable ? 1 : 0;
      out.throttle = 0;
      out.brake = Math.abs(v) > 0.3 ? 0.5 : 0;
    }
  }

  /** Not standing still (or not counting): the clock starts again from here. */
  private markStill(view: TrafficView): void {
    this.stillTime = 0;
    this.stillS = view.self.s;
    this.stillD = view.self.d;
  }

  // ---- Recovery after a spin or a crash ----

  /**
   * A car facing the wrong way at low speed, or stuck stopped, turns back the right way: it waits
   * while cars come past, turns forward on full lock, and backs away on the opposite lock when it
   * is pressed against something; then it rejoins off line.
   */
  private recover(view: TrafficView, tel: CarTelemetry, dt: number, out: ControlInput): void {
    const line = this.plan.line;
    const s0 = view.self.s;
    const track = this.plan.track;
    const heading = line.heading[Math.round(track.wrap(s0) / track.lap.step) % line.count]!;
    const err = wrapAngle(tel.yaw - heading);
    const v = tel.speed;
    // In a queue: behind the car ahead, or behind any car standing still close ahead (into a
    // chicane the car ahead in the queue may sit across the road from this car's line).
    // (Off the road a car is in no queue: the cars passing on the track are not its leaders.)
    const dHere = view.self.d;
    const offRoad =
      Math.abs(dHere) > track.halfWidthAt(track.wrap(s0), dHere >= 0 ? 0 : 1) + ROAD_EDGE_SLACK;
    const queued =
      !offRoad &&
      ((this.last.leader >= 0 && this.last.gap < 15) || this.standingAhead(view, s0, 30));
    // Standing still: under 0.7 m/s, or rocking within a metre and a half of where it stood (a
    // car against a barrier, now and then over that pace, is still going nowhere).
    const here = view.self;
    const away = Number.isFinite(this.stillS)
      ? Math.hypot(this.ahead(this.stillS, here.s), here.d - this.stillD)
      : Number.POSITIVE_INFINITY;
    const still = Math.abs(v) < 0.7 || (away <= STILL_RADIUS && Math.abs(v) < 1.5);
    if (!view.active || queued || !still) this.markStill(view);
    else this.stillTime += dt;
    if (!this.recovering && view.active) {
      if (Math.abs(err) > 1.4 && Math.abs(v) < 12) this.recovering = true;
      else if (this.stillTime > 3) {
        this.recovering = true;
        this.backTime = 1.5;
      }
      if (this.recovering) {
        this.dirHeld = 0;
        this.flips = 0;
        this.backStraight = false;
      }
      // (A back-up round a stopped car is over: the recovery has the car and its gears now.)
      if (this.recovering) this.reverseTime = 0;
    }
    if (this.recovering && Math.abs(err) < 0.35 && v > 2) {
      this.recovering = false;
      this.backTime = 0;
      this.flips = 0;
      this.backStraight = false;
      // Rejoin from where the car is, easing back to the line.
      this.o = view.self.d - this.at(line.d, s0);
      this.rejoinTime = 4;
    }
    this.last.recovering = this.recovering;
    if (!this.recovering) return;
    out.drs = false;
    out.overtake = false;
    // Off the road, the way back is across toward it, not straight along the lap: a car wedged
    // beside the pit wall's end backed up straight and drove into it again until retired.
    const toRoad = offRoad ? (dHere > 0 ? -1 : 1) : 0;
    const aimErr = wrapAngle(err - toRoad * ROAD_AIM);
    const turn = Math.abs(aimErr) < 0.35 ? 0 : aimErr > 0 ? -1 : 1;
    // On the racing surface, wait for the cars coming; off it (run-off, at a barrier) there is
    // no need.
    const d = view.self.d;
    const onTrack =
      d < track.halfWidthAt(track.wrap(s0), 0) && -d < track.halfWidthAt(track.wrap(s0), 1);
    if (onTrack && this.trackBusy(view, s0, 150) && Math.abs(err) > 0.8) {
      // Wait for the gap: stopped, out of the way. Waiting is not being stuck.
      this.markStill(view);
      out.steer = 0;
      out.throttle = 0;
      out.brake = 1;
      out.gearShift = 0;
      return;
    }
    // A multi-point turn: forward on full lock until near the edge the car is heading for (or
    // pressed against something), then back on the opposite lock (which turns the car the same
    // way) until near the other edge, pressed again, or pointing the right way.
    const half = track.wrap(s0);
    const roomLeft = track.halfWidthAt(half, 0) - d;
    const roomRight = d + track.halfWidthAt(half, 1);
    const lat = Math.sin(err);
    const ahead = lat > 0.3 ? roomLeft : lat < -0.3 ? roomRight : Infinity;
    const behind = lat > 0.3 ? roomRight : lat < -0.3 ? roomLeft : Infinity;
    // Each direction is held until its gear is in and it has had time to move the car: a
    // change on the next tick restarted the gear change every time, and the car sat between
    // first and neutral. Going nowhere while pointing the right way, or after two changes of
    // direction, the car backs straight.
    this.dirHeld += dt;
    if (this.backTime > 0) {
      this.backTime -= dt;
      const settled = tel.gear < 0 && this.dirHeld > DIR_HOLD;
      const pointed = Math.abs(aimErr) < 0.5 && !this.backStraight;
      if (settled && (behind < TURN_ROOM || pointed || this.stillTime > 1.5)) {
        this.backTime = 0;
      }
      if (this.backTime <= 0) {
        this.backTime = 0;
        this.markStill(view);
        this.dirHeld = 0;
        this.flips++;
      }
    } else if (
      tel.gear >= 1 &&
      this.dirHeld > DIR_HOLD &&
      (ahead < TURN_ROOM || this.stillTime > 1.5)
    ) {
      this.backTime = 4;
      this.markStill(view);
      this.dirHeld = 0;
      this.backStraight = !offRoad && (Math.abs(err) < 0.5 || this.flips >= 2);
      this.flips++;
    }
    // Gears: first to go forward, reverse to back, stepping down through the box from wherever
    // the spin left it.
    const shiftable = !tel.shifting && Math.abs(v) < 3;
    if (this.backTime > 0) {
      if (onTrack && this.trackBusy(view, s0, CAR_LENGTH + 15)) {
        this.markStill(view);
        out.steer = 0;
        out.throttle = 0;
        out.brake = 1;
        out.gearShift = 0;
        return;
      }
      out.steer = this.backStraight ? 0 : -turn;
      out.brake = v > 0.5 || v < -6 ? 0.6 : 0;
      out.gearShift = shiftable && tel.gear >= 0 && (tel.gear > 0 || Math.abs(v) < 1) ? -1 : 0;
      out.throttle = tel.gear < 0 && v > -4 ? 0.35 : 0;
      return;
    }
    out.steer = turn;
    out.gearShift = !shiftable ? 0 : tel.gear > 1 ? -1 : tel.gear < 1 && Math.abs(v) < 1 ? 1 : 0;
    out.throttle = tel.gear === 1 && v < 4 ? 0.3 : 0;
    out.brake = v > 7 || v < -0.5 ? 0.4 : 0;
  }
}

/**
 * For each line sample, the distance to the next sample in a braking zone or a corner (radius
 * under 150 m), m; 0 inside one.
 */
function cornerDistances(plan: DrivingPlan, brakingOnly = false): Float64Array {
  const n = plan.line.count;
  const step = plan.track.lap.step;
  const k = plan.line.curvature;
  const phase = plan.profile.phase;
  const out = new Float64Array(n);
  const hot = (i: number): boolean =>
    phase[i] === Phase.Brake || (!brakingOnly && Math.abs(k[i]!) > CORNER_CURVATURE);
  let first = -1;
  for (let i = 0; i < n; i++) if (hot(i)) first = first < 0 ? i : first;
  if (first < 0) return out.fill(Number.POSITIVE_INFINITY);
  // Walk backwards twice round the lap from a corner sample.
  let dist = 0;
  for (let m = 0; m < 2 * n; m++) {
    const i = (((first - m) % n) + n) % n;
    dist = hot(i) ? 0 : dist + step;
    out[i] = dist;
  }
  return out;
}
