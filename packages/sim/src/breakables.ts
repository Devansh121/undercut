import { BROKEN_OBJECT_WORDS } from './contracts';
import { BODY_HALF_WIDTH, BODY_NOSE, BODY_TAIL } from './model';
import { computeMass, type CarState } from './state';

/** Ground-pivoted lightweight dressing. Solid wall faces are queried separately. SI units. */
export interface BreakableObject {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly mass: number;
  /** Maximum height of the intact prop, m. */
  readonly height?: number;
}

export { BROKEN_OBJECT_WORDS } from './contracts';
const CELL = 16;

/** Immutable broad phase shared by contact and scenery; at most 2048 objects per circuit. */
export class BreakableIndex {
  private readonly cells = new Map<number, BreakableObject[]>();
  constructor(readonly objects: readonly BreakableObject[]) {
    for (const o of objects) {
      if (o.id < 0 || o.id >= 32 * BROKEN_OBJECT_WORDS || !Number.isInteger(o.id))
        throw new RangeError('breakable object id out of range');
      const r = Math.hypot(o.halfWidth, o.halfDepth) + 4;
      for (let x = Math.floor((o.x - r) / CELL); x <= Math.floor((o.x + r) / CELL); x++) {
        for (let z = Math.floor((o.z - r) / CELL); z <= Math.floor((o.z + r) / CELL); z++) {
          const key = x * 65536 + z;
          const list = this.cells.get(key) ?? [];
          list.push(o);
          this.cells.set(key, list);
        }
      }
    }
  }
  near(x: number, z: number): readonly BreakableObject[] {
    return this.cells.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) ?? EMPTY;
  }
}
const EMPTY: readonly BreakableObject[] = [];

/** SAT of the car footprint and an oriented board, including all edges, not just corners. */
export function touchesBreakable(
  o: BreakableObject,
  car: { x: number; z: number; yaw: number },
  front: number,
  rear: number,
): boolean {
  const c = Math.cos(car.yaw),
    s = Math.sin(car.yaw);
  const oc = Math.cos(o.yaw),
    os = Math.sin(o.yaw);
  const half = (front + rear) / 2;
  const shift = (front - rear) / 2;
  const dx = car.x + c * shift - o.x;
  const dz = car.z - s * shift - o.z;
  const dot = c * oc + s * os;
  const cross = s * oc - c * os;
  if (
    Math.abs(dx * c - dz * s) >
    half + o.halfDepth * Math.abs(dot) + o.halfWidth * Math.abs(cross)
  )
    return false;
  if (
    Math.abs(dx * s + dz * c) >
    BODY_HALF_WIDTH + o.halfDepth * Math.abs(cross) + o.halfWidth * Math.abs(dot)
  )
    return false;
  if (
    Math.abs(dx * oc - dz * os) >
    o.halfDepth + half * Math.abs(dot) + BODY_HALF_WIDTH * Math.abs(cross)
  )
    return false;
  return (
    Math.abs(dx * os + dz * oc) <=
    o.halfWidth + half * Math.abs(cross) + BODY_HALF_WIDTH * Math.abs(dot)
  );
}

/** A plastic/foam board takes momentum once from this car; debris never contacts a car. */
export function breakableContact(car: CarState, index: BreakableIndex): void {
  const nearby = index.near(car.x, car.z);
  if (nearby.length === 0) return;
  const mass = computeMass(car.model, car.fuelMass, MASS);
  for (const o of nearby) {
    const word = o.id >>> 5,
      mask = 1 << (o.id & 31);
    if ((car.brokenObjects[word]! & mask) !== 0) continue;
    if (!touchesBreakable(o, car, mass.a + BODY_NOSE, mass.b + BODY_TAIL)) continue;
    const speed = Math.hypot(car.vx, car.vy);
    if (speed < 0.2) continue;
    const slot = car.breakableHitCount++ % 4;
    car.hitObject[slot] = o.id;
    car.hitTime[slot] = Math.round(car.contactTime * 1000) / 1000;
    const c = Math.cos(car.yaw),
      sn = Math.sin(car.yaw);
    car.hitVx[slot] = Math.round((car.vx * c - car.vy * sn) * 100) / 100;
    car.hitVz[slot] = Math.round((-car.vx * sn - car.vy * c) * 100) / 100;
    car.brokenObjects[word] = car.brokenObjects[word]! | mask;
    // Inelastic pickup is a conservative upper estimate for the momentum given to a light panel.
    const keep = mass.total / (mass.total + o.mass);
    car.vx *= keep;
    car.vy *= keep;
    car.breakableImpactSpeed = Math.max(
      car.breakableImpactSpeed,
      speed * Math.sqrt(o.mass / mass.total),
    );
  }
}
const MASS = { total: 0, sprung: 0, a: 0, b: 0, sprungA: 0, sprungB: 0, yawInertia: 0 };

export interface BreakableHit {
  readonly object: BreakableObject;
  readonly time: number;
  readonly vx: number;
  readonly vz: number;
}

/** Analytic cosmetic trajectory: reproducible at any frame rate, three damped bounces, then rest. */
export function debrisPose(hit: BreakableHit, time: number) {
  const o = hit.object;
  const t = Math.min(6, Math.max(0, time - hit.time));
  const seed = ((o.id * 1664525 + 1013904223) >>> 0) / 4294967296;
  let flight = t,
    lift = 3 + seed * 2,
    bounce = 0;
  while (bounce < 3 && flight > (2 * lift) / 9.80665) {
    flight -= (2 * lift) / 9.80665;
    lift *= 0.35;
    bounce++;
  }
  const height = bounce === 3 ? 0 : Math.max(0, lift * flight - 0.5 * 9.80665 * flight * flight);
  const launchScale = Math.min(1, 80 / Math.max(1, Math.hypot(hit.vx, hit.vz)));
  const travel = (1 - Math.exp(-t)) * 0.45 * launchScale;
  const spin = (1 - Math.exp(-t * 1.5)) * (3 + seed * 5);
  const settle = Math.min(1, Math.max(0, (t - 2) / 2));
  const roll = spin * (1 - settle) + (Math.PI / 2) * settle;
  // Pivot height keeps the rotating whole board above its contact plane, including its posts.
  const clearance =
    Math.abs(Math.sin(roll)) * o.halfWidth + Math.max(0, -Math.cos(roll)) * (o.height ?? 0.88);
  return {
    x: o.x + hit.vx * travel,
    y: o.y + 0.1 + clearance + height,
    z: o.z + hit.vz * travel,
    yaw: o.yaw + spin * 0.7,
    roll,
    scale: 1,
  };
}
