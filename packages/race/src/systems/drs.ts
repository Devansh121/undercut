import type { ControlInput } from '@undercut/sim';
import { inRange, type RaceCore, type RaceSystem } from '../core';
import { crossingFraction } from '../timing/lap-timer';

/**
 * DRS rules. The sim moves the flap; this decides when it may open.
 *
 * - Practice, qualifying and time trial: free inside the zones (activation to end).
 * - Race: race control enables DRS when the leader starts lap `drsEnableLap`. A car that
 *   crosses a zone's detection line less than `drsGap` behind the car that crossed it before
 *   (any car, lapped or not; times interpolated inside the tick, like the timing lines) may use
 *   that zone, from its activation line to its end.
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
  last: ({ car: number; time: number } | null)[];
  cars: DrsCar[];
}

export class DrsSystem implements RaceSystem<DrsState> {
  private enabled = false;
  private last: ({ car: number; time: number } | null)[];
  private cars: DrsCar[];
  private readonly yellowBetween: (from: number, to: number) => boolean;

  constructor(cars: number, zones: number, yellowBetween: (from: number, to: number) => boolean) {
    this.last = Array.from({ length: zones }, () => null);
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

  tick(core: RaceCore): void {
    const { circuit, strategy, rules } = core;
    const L = circuit.length;
    const zones = circuit.drsZones;
    const race = strategy.drs === 'race';
    if (race && !this.enabled && core.phase === 'green' && core.order.length > 0) {
      const leader = core.order[0]!;
      if (core.timers[leader]!.lap >= rules.drsEnableLap) {
        this.enabled = true;
        core.emit({ type: 'drsEnabled', t: core.time, enabled: true });
      }
    }
    const dt = core.time - core.prevTime;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      const f = core.facts[i]!;
      const p = core.prevFacts[i]!;
      const racing = core.racing(i);
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        if (racing && crossingFraction(L, p.s, f.s, zone.end) !== null && c.eligible === z) {
          c.eligible = -1;
        }
        if (!racing || f.inPitLane || p.inPitLane) continue;
        const frac = crossingFraction(L, p.s, f.s, zone.detection);
        if (frac === null) continue;
        const at = core.prevTime + frac * dt;
        if (race) {
          const prev = this.last[z];
          const gap = prev && prev.car !== i ? at - prev.time : Infinity;
          if (this.enabled && gap < rules.drsGap) {
            c.eligible = z;
            core.emit({ type: 'drsEligible', t: core.time, car: i, zone: z, gap });
          } else if (c.eligible === z) c.eligible = -1;
        }
        this.last[z] = { car: i, time: at };
      }
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
      last: this.last.map((l) => (l ? { ...l } : null)),
      cars: this.cars.map((c) => ({ ...c })),
    };
  }

  setState(s: DrsState): void {
    this.enabled = s.enabled;
    this.last = s.last.map((l) => (l ? { ...l } : null));
    this.cars = s.cars.map((c) => ({ ...c }));
  }
}
