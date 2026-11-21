import type { ControlInput } from '@undercut/sim';
import { inRange, type RaceCore, type RaceSystem } from '../core';

/**
 * DRS rules. The sim moves the flap; this decides when it may open.
 *
 * - Practice, qualifying and time trial: free inside the zones (activation to end).
 * - Race: race control enables DRS when the leader starts lap `drsEnableLap`. A car that
 *   crosses a zone's detection line less than `drsGap` behind the car that crossed it before
 *   (any car, lapped or not; times interpolated inside the tick and processed in time order
 *   across the field, like the timing lines) may use that zone, from its activation line to
 *   its end.
 * - Never in the pit lane, never in a zone touching a yellow sector.
 * - The flap closes when the driver brakes or lifts, and stays shut until the request is
 *   released (a fresh press reopens it while still allowed).
 */
interface DrsCar {
  eligible: number;
  latched: boolean;
  allowed: boolean;
}

export interface DrsState {
  enabled: boolean;
  /** Per zone, the car that crossed its detection line last (-1: none yet) and when. */
  lastCar: number[];
  lastTime: number[];
  cars: DrsCar[];
}

export class DrsSystem implements RaceSystem<DrsState> {
  private enabled = false;
  private lastCar: number[];
  private lastTime: Float64Array;
  private cars: DrsCar[];
  private readonly yellowBetween: (from: number, to: number) => boolean;

  constructor(cars: number, zones: number, yellowBetween: (from: number, to: number) => boolean) {
    this.lastCar = new Array<number>(zones).fill(-1);
    this.lastTime = new Float64Array(zones);
    this.cars = Array.from({ length: cars }, () => ({
      eligible: -1,
      latched: false,
      allowed: false,
    }));
    this.yellowBetween = yellowBetween;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** The rules allow this car's flap open at its position now. */
  allowed(car: number): boolean {
    return this.cars[car]!.allowed;
  }

  /** Zone the car may use in a race (from its detection line to the zone's end), or -1. */
  eligibleZone(car: number): number {
    return this.cars[car]!.eligible;
  }

  /** Apply the rule to a driver's request: returns whether the flap may be asked open this tick. */
  gate(
    car: number,
    input: Pick<ControlInput, 'drs' | 'throttle' | 'brake'>,
    brakeOn: number,
    lift: number,
  ): boolean {
    const c = this.cars[car]!;
    if (!input.drs) c.latched = false;
    else if (input.brake > brakeOn || input.throttle < lift) c.latched = true;
    return input.drs && c.allowed && !c.latched;
  }

  /** Race control enables DRS (the leader started the enable lap). */
  enable(core: RaceCore): void {
    if (this.enabled) return;
    this.enabled = true;
    core.emit({ type: 'drsEnabled', t: core.time, enabled: true });
  }

  /**
   * A car crossed zone `z`'s detection line at `at`. Called in time order across the field, so
   * the car before it at the line is the one that crossed it last; the gap is never negative.
   */
  onDetection(core: RaceCore, car: number, z: number, at: number): void {
    const c = this.cars[car]!;
    if (core.strategy.drs === 'race') {
      const prev = this.lastCar[z]!;
      const gap = prev >= 0 && prev !== car ? at - this.lastTime[z]! : Infinity;
      if (this.enabled && gap >= 0 && gap < core.rules.drsGap) {
        c.eligible = z;
        core.emit({ type: 'drsEligible', t: core.time, car, zone: z, gap });
      } else if (c.eligible === z) c.eligible = -1;
    }
    this.lastCar[z] = car;
    this.lastTime[z] = at;
  }

  /** A car passed zone `z`'s end: its eligibility for that zone is spent. */
  onZoneEnd(car: number, z: number): void {
    const c = this.cars[car]!;
    if (c.eligible === z) c.eligible = -1;
  }

  /** Whether each car's flap may open where it is now. Detection is fed by the core in time order. */
  tick(core: RaceCore): void {
    const { circuit, strategy } = core;
    const L = circuit.length;
    const zones = circuit.drsZones;
    const race = strategy.drs === 'race';
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      const f = core.facts[i]!;
      let zoneHere = -1;
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        if (inRange(L, f.s, zone.activation, zone.end)) zoneHere = z;
      }
      const live =
        core.cars[i]!.status === 'running' && core.phase !== 'grid' && core.phase !== 'lights';
      let ok = live && zoneHere >= 0 && !f.inPitLane;
      if (ok) {
        const zone = zones[zoneHere]!;
        if (this.yellowBetween(zone.activation, zone.end)) ok = false;
      }
      if (ok && race) ok = this.enabled && c.eligible === zoneHere && core.racing(i);
      c.allowed = ok;
    }
  }

  getState(): DrsState {
    return {
      enabled: this.enabled,
      lastCar: this.lastCar.slice(),
      lastTime: Array.from(this.lastTime),
      cars: this.cars.map((c) => ({ ...c })),
    };
  }

  setState(s: DrsState): void {
    this.enabled = s.enabled;
    this.lastCar = s.lastCar.slice();
    this.lastTime = Float64Array.from(s.lastTime);
    this.cars = s.cars.map((c) => ({ ...c }));
  }
}
