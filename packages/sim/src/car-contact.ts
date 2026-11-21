import { BODY_HALF_WIDTH, BODY_NOSE, BODY_TAIL } from './model';
import { computeMass, type CarState, type MassState } from './state';

/**
 * Car-to-car contact: each car's body is an oriented box in the ground plane, the same footprint
 * the barrier contact uses (`BODY_NOSE`, `BODY_TAIL`, `BODY_HALF_WIDTH`, ADR 0009), and boxes that overlap after a step are pushed
 * apart and given an impulse along the contact normal.
 *
 * - Narrow phase: separating axes of the two boxes. The axis of least overlap gives the normal
 *   and the depth; the incident edge clipped to the reference face gives the contact point (the
 *   middle of the touching stretch), so a tap on a rear corner acts at the corner and turns the
 *   car, and cars side by side push at the middle of their overlap.
 * - Response: a normal impulse with low restitution, then a Coulomb friction impulse along the
 *   tangent, each from the velocities left by the one before it. Mass and yaw inertia of both
 *   cars enter through the effective mass at the contact point. Applied in that order, neither
 *   impulse can add kinetic energy (each moves a relative velocity toward zero, never past it).
 * - Position: the overlap is removed along the normal, split by inverse mass, down to a small
 *   slop. Position only, so it adds no kinetic energy either.
 * - Several passes over the pairs let a stack of three or more cars settle.
 *
 * Contact is planar: no vertical force, no wheel-to-wheel launch, no damage. Its only outputs
 * besides the state change are the impulse diagnostics on each car (for damage and audio later).
 *
 * The step is 1/240 s, so a closing speed of 100 m/s moves 0.42 m a step, well under the 2 m
 * width and 5.6 m length of a car: one step can never carry a car through another, and the axis
 * of least overlap stays the right one.
 */

/**
 * Restitution of the normal speed between two bodies and their friction sliding on each other.
 * Estimates: carbon on carbon keeps little of the closing speed (wings and bodywork crush), and
 * slides at about μ 0.3.
 */
export const CAR_RESTITUTION = 0.1;
export const CAR_FRICTION = 0.3;
/** Overlap left after the position correction, m: keeps resting contacts from chattering. */
export const CONTACT_SLOP = 0.005;
/** Passes over the touching pairs per step. */
export const CONTACT_PASSES = 4;
/** Largest distance from a car's CoG to a footprint corner, m, with margin (broad phase). */
const REACH = 3.6;

/** A car's footprint box in the world: centre, unit forward axis, half length and width. */
export interface CarFootprint {
  cx: number;
  cz: number;
  /** Forward axis, unit, world x and z. The car's left is then (fz, -fx). */
  fx: number;
  fz: number;
  halfLength: number;
  halfWidth: number;
}

/** Scratch and broad-phase state carried by a world. Caches only: never part of a snapshot. */
export interface CarContacts {
  /** Car indices sorted by x, then index (the sweep axis). */
  order: Int32Array;
  /** Candidate pairs found by the sweep, as i0, j0, i1, j1, ... */
  pairs: Int32Array;
  pairCount: number;
  /** Per car: mass, yaw inertia, CoG and footprint, refreshed each step. */
  mass: Float64Array;
  inertia: Float64Array;
  boxes: CarFootprint[];
  /** Touching pairs on the last step. */
  touching: number;
}

export function createCarContacts(): CarContacts {
  return {
    order: new Int32Array(0),
    pairs: new Int32Array(0),
    pairCount: 0,
    mass: new Float64Array(0),
    inertia: new Float64Array(0),
    boxes: [],
    touching: 0,
  };
}

const massScratch: MassState = {
  total: 0,
  sprung: 0,
  a: 0,
  b: 0,
  sprungA: 0,
  sprungB: 0,
  yawInertia: 0,
};

function newBox(): CarFootprint {
  return { cx: 0, cz: 0, fx: 1, fz: 0, halfLength: 0, halfWidth: 0 };
}

/** Fill `out` with the car's footprint box (allocates one when absent). */
export function carFootprint(s: CarState, out: CarFootprint = newBox()): CarFootprint {
  const m = computeMass(s.model, s.fuelMass, massScratch);
  const nose = m.a + BODY_NOSE;
  const tail = m.b + BODY_TAIL;
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const ahead = (nose - tail) / 2;
  out.fx = c;
  out.fz = -sn;
  out.cx = s.x + ahead * c;
  out.cz = s.z - ahead * sn;
  out.halfLength = (nose + tail) / 2;
  out.halfWidth = BODY_HALF_WIDTH;
  return out;
}

// Narrow-phase result, module scratch (the sim is single-threaded).
const hit = { depth: 0, nx: 0, nz: 0, px: 0, pz: 0 };
const boxA = newBox();
const boxB = newBox();

/**
 * Separating-axis test of two boxes. Returns false when apart; otherwise fills `hit` with the
 * depth, the unit normal from A to B, and the contact point.
 */
function collide(A: CarFootprint, B: CarFootprint): boolean {
  const dx = B.cx - A.cx;
  const dz = B.cz - A.cz;
  let best = Infinity;
  let nx = 0;
  let nz = 0;
  let ref = 0; // 0: the axis is A's face; 1: B's.
  let refAlong = 0; // reference face: 0 forward axis, 1 left axis
  for (let k = 0; k < 4; k++) {
    const box = k < 2 ? A : B;
    // Axis: forward (k even) or left (k odd) of `box`. Left of forward (fx, fz) is (fz, -fx).
    const ax = k % 2 === 0 ? box.fx : box.fz;
    const az = k % 2 === 0 ? box.fz : -box.fx;
    const ra = radius(A, ax, az);
    const rb = radius(B, ax, az);
    const dist = dx * ax + dz * az;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    // Prefer A's axes on near ties so the choice does not flicker between equal faces.
    if (overlap < best - 1e-9) {
      best = overlap;
      const sgn = dist >= 0 ? 1 : -1;
      nx = ax * sgn;
      nz = az * sgn;
      ref = k < 2 ? 0 : 1;
      refAlong = k % 2;
    }
  }
  hit.depth = best;
  hit.nx = nx;
  hit.nz = nz;
  // Reference box R owns the axis; incident box I is the other. The reference face's outward
  // normal points from R to I: n for R = A, -n for R = B.
  const R = ref === 0 ? A : B;
  const I = ref === 0 ? B : A;
  const sx = ref === 0 ? nx : -nx;
  const sz = ref === 0 ? nz : -nz;
  const faceExtent = refAlong === 0 ? R.halfLength : R.halfWidth;
  const sideExtent = refAlong === 0 ? R.halfWidth : R.halfLength;
  // Face centre and tangent.
  const fcx = R.cx + sx * faceExtent;
  const fcz = R.cz + sz * faceExtent;
  const tx = -sz;
  const tz = sx;
  // Incident edge: the face of I whose outward normal is most against s.
  const dF = I.fx * sx + I.fz * sz;
  const dL = I.fz * sx - I.fx * sz;
  let ex: number;
  let ez: number; // incident face's outward normal
  let eHalf: number; // half length of that edge
  let eDepth: number; // distance from I's centre to that face
  if (Math.abs(dF) >= Math.abs(dL)) {
    const sg = dF > 0 ? -1 : 1;
    ex = I.fx * sg;
    ez = I.fz * sg;
    eHalf = I.halfWidth;
    eDepth = I.halfLength;
  } else {
    const sg = dL > 0 ? -1 : 1;
    ex = I.fz * sg;
    ez = -I.fx * sg;
    eHalf = I.halfLength;
    eDepth = I.halfWidth;
  }
  // Edge endpoints: centre of that face plus or minus its tangent.
  const ecx = I.cx + ex * eDepth;
  const ecz = I.cz + ez * eDepth;
  const etx = -ez;
  const etz = ex;
  // Positions along the reference tangent, relative to the face centre.
  const u0 = (ecx - etx * eHalf - fcx) * tx + (ecz - etz * eHalf - fcz) * tz;
  const u1 = (ecx + etx * eHalf - fcx) * tx + (ecz + etz * eHalf - fcz) * tz;
  // Depths below the reference face (positive inside R).
  const h0 = -((ecx - etx * eHalf - fcx) * sx + (ecz - etz * eHalf - fcz) * sz);
  const h1 = -((ecx + etx * eHalf - fcx) * sx + (ecz + etz * eHalf - fcz) * sz);
  // Clip the segment to [-sideExtent, sideExtent] along the tangent.
  let ua = u0;
  let ha = h0;
  let ub = u1;
  let hb = h1;
  if (ua > ub) {
    ua = u1;
    ha = h1;
    ub = u0;
    hb = h0;
  }
  const span = ub - ua;
  if (span > 1e-12) {
    if (ua < -sideExtent) {
      ha = ha + ((hb - ha) * (-sideExtent - ua)) / span;
      ua = -sideExtent;
    }
    if (ub > sideExtent) {
      hb = ha + ((hb - ha) * (sideExtent - ua)) / (ub - ua);
      ub = sideExtent;
    }
  }
  if (ub < ua) ub = ua;
  // Keep the stretch that is inside R; its middle is the contact point.
  let lo = ua;
  let hi = ub;
  if (ha < 0 && hb < 0) {
    lo = hi = ha > hb ? ua : ub;
  } else if (ha < 0) {
    lo = ua + ((ub - ua) * -ha) / (hb - ha);
  } else if (hb < 0) {
    hi = ua + ((ub - ua) * ha) / (ha - hb);
  }
  const mid = (lo + hi) / 2;
  // The contact point sits midway through the overlap, between the face and the incident edge.
  const depthAtMid = ub - ua > 1e-12 ? ha + ((hb - ha) * (mid - ua)) / (ub - ua) : ha;
  hit.px = fcx + tx * mid - sx * (depthAtMid / 2);
  hit.pz = fcz + tz * mid - sz * (depthAtMid / 2);
  return true;
}

/** Half extent of a box projected on the unit axis (ax, az). */
function radius(b: CarFootprint, ax: number, az: number): number {
  return (
    b.halfLength * Math.abs(b.fx * ax + b.fz * az) + b.halfWidth * Math.abs(b.fz * ax - b.fx * az)
  );
}

/** Depth of overlap of two cars' footprints, m (0 when apart). For tests and diagnostics. */
export function carOverlap(a: CarState, b: CarState): number {
  carFootprint(a, boxA);
  carFootprint(b, boxB);
  return collide(boxA, boxB) ? hit.depth : 0;
}

/** What the contact needs of each car: its state. `WorldCar` satisfies it. */
export interface ContactBody {
  readonly state: CarState;
}

function ensure(c: CarContacts, n: number): void {
  if (c.order.length === n) return;
  c.order = new Int32Array(n);
  for (let i = 0; i < n; i++) c.order[i] = i;
  c.pairs = new Int32Array(n * (n - 1));
  c.mass = new Float64Array(n);
  c.inertia = new Float64Array(n);
  c.boxes = Array.from({ length: n }, newBox);
}

/**
 * Resolve every car-to-car overlap after a step. Writes the contact diagnostics of every car
 * (`carContactImpulse`, `carContactSpeed`, `carContacts`). Allocation-free once `contacts` has
 * been sized for this many cars.
 */
export function resolveCarContacts(cars: readonly ContactBody[], contacts: CarContacts): void {
  const n = cars.length;
  ensure(contacts, n);
  const { order, mass, inertia, boxes } = contacts;
  for (let i = 0; i < n; i++) {
    const s = cars[i]!.state;
    const m = computeMass(s.model, s.fuelMass, massScratch);
    mass[i] = m.total;
    inertia[i] = m.yawInertia;
    s.carContactImpulse = 0;
    s.carContactSpeed = 0;
    s.carContacts = 0;
  }
  contacts.touching = 0;
  if (n < 2) return;
  // Broad phase: sort by x (insertion sort, nearly sorted from the last step; the key is total,
  // x then index, so the order depends only on the state), then sweep.
  for (let k = 1; k < n; k++) {
    const v = order[k]!;
    const xv = cars[v]!.state.x;
    let j = k - 1;
    while (j >= 0) {
      const u = order[j]!;
      const xu = cars[u]!.state.x;
      if (xu < xv || (xu === xv && u < v)) break;
      order[j + 1] = u;
      j--;
    }
    order[j + 1] = v;
  }
  let pc = 0;
  const pairs = contacts.pairs;
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    const si = cars[i]!.state;
    for (let l = k + 1; l < n; l++) {
      const j = order[l]!;
      const sj = cars[j]!.state;
      if (sj.x - si.x > 2 * REACH) break;
      const dz = sj.z - si.z;
      if (dz > 2 * REACH || dz < -2 * REACH) continue;
      pairs[2 * pc] = i < j ? i : j;
      pairs[2 * pc + 1] = i < j ? j : i;
      pc++;
    }
  }
  contacts.pairCount = pc;
  if (pc === 0) return;
  let touching = 0;
  for (let pass = 0; pass < CONTACT_PASSES; pass++) {
    let any = false;
    for (let p = 0; p < pc; p++) {
      const i = pairs[2 * p]!;
      const j = pairs[2 * p + 1]!;
      const a = cars[i]!.state;
      const b = cars[j]!.state;
      carFootprint(a, boxes[i]!);
      carFootprint(b, boxes[j]!);
      if (!collide(boxes[i]!, boxes[j]!)) continue;
      any = true;
      if (pass === 0) {
        touching++;
        a.carContacts += 1;
        b.carContacts += 1;
      }
      respond(a, b, i, j, contacts);
    }
    if (!any) break;
  }
  contacts.touching = touching;
}

/**
 * Scratch for the response, so no call passes or returns a loose number (V8 boxes doubles that
 * cross a call it does not inline): lever arms of A and B (0–3), a unit direction (4, 5), an
 * impulse (6, 7), a relative speed (8), and the two cars' inverse masses and inertias (9–12).
 */
const sc = new Float64Array(13);

/** Push apart, then the normal and friction impulses, for the contact in `hit`. */
function respond(a: CarState, b: CarState, i: number, j: number, contacts: CarContacts): void {
  const ma = contacts.mass[i]!;
  const mb = contacts.mass[j]!;
  const ia = contacts.inertia[i]!;
  const ib = contacts.inertia[j]!;
  const nx = hit.nx;
  const nz = hit.nz;
  const wa = 1 / ma;
  const wb = 1 / mb;
  sc[9] = wa;
  sc[10] = wb;
  sc[11] = 1 / ia;
  sc[12] = 1 / ib;
  // Position: remove the overlap down to the slop, split by inverse mass.
  const push = hit.depth - CONTACT_SLOP;
  if (push > 0) {
    const share = push / (wa + wb);
    a.x -= nx * share * wa;
    a.z -= nz * share * wa;
    b.x += nx * share * wb;
    b.z += nz * share * wb;
  }
  // Lever arms from each CoG to the contact point.
  const rax = hit.px - a.x;
  const raz = hit.pz - a.z;
  const rbx = hit.px - b.x;
  const rbz = hit.pz - b.z;
  sc[0] = rax;
  sc[1] = raz;
  sc[2] = rbx;
  sc[3] = rbz;
  // Normal impulse.
  sc[4] = nx;
  sc[5] = nz;
  relativeAlong(a, b);
  const vn = sc[8]!;
  if (vn >= 0) return;
  const ran = raz * nx - rax * nz;
  const rbn = rbz * nx - rbx * nz;
  const jn = (-(1 + CAR_RESTITUTION) * vn) / (wa + wb + (ran * ran) / ia + (rbn * rbn) / ib);
  sc[6] = nx * jn;
  sc[7] = nz * jn;
  applyImpulse(a, b);
  // Friction along the tangent, from the velocities the normal impulse left.
  const tx = -nz;
  const tz = nx;
  sc[4] = tx;
  sc[5] = tz;
  relativeAlong(a, b);
  const vt = sc[8]!;
  const rat = raz * tx - rax * tz;
  const rbt = rbz * tx - rbx * tz;
  let jt = -vt / (wa + wb + (rat * rat) / ia + (rbt * rbt) / ib);
  const jmax = CAR_FRICTION * jn;
  if (jt > jmax) jt = jmax;
  else if (jt < -jmax) jt = -jmax;
  sc[6] = tx * jt;
  sc[7] = tz * jt;
  applyImpulse(a, b);
  const jm = Math.sqrt(jn * jn + jt * jt);
  a.carContactImpulse += jm;
  b.carContactImpulse += jm;
  if (-vn > a.carContactSpeed) a.carContactSpeed = -vn;
  if (-vn > b.carContactSpeed) b.carContactSpeed = -vn;
}

/**
 * Velocity of B's contact point relative to A's along the unit direction in `sc[4..5]`, world
 * frame, into `sc[8]`. Lever arms from `sc[0..3]`.
 */
function relativeAlong(a: CarState, b: CarState): void {
  const ca = Math.cos(a.yaw);
  const sa = Math.sin(a.yaw);
  const cb = Math.cos(b.yaw);
  const sb = Math.sin(b.yaw);
  // Body velocity in the world (vx forward, vy left), plus ω × r with ω about +Y.
  const pax = a.vx * ca - a.vy * sa + a.yawRate * sc[1]!;
  const paz = -a.vx * sa - a.vy * ca - a.yawRate * sc[0]!;
  const pbx = b.vx * cb - b.vy * sb + b.yawRate * sc[3]!;
  const pbz = -b.vx * sb - b.vy * cb - b.yawRate * sc[2]!;
  sc[8] = (pbx - pax) * sc[4]! + (pbz - paz) * sc[5]!;
}

/** The impulse in `sc[6..7]` on B at its contact point, and its opposite on A. */
function applyImpulse(a: CarState, b: CarState): void {
  const jx = sc[6]!;
  const jz = sc[7]!;
  let c = Math.cos(b.yaw);
  let sn = Math.sin(b.yaw);
  // World impulse into each car's frame: forward and left components; torque about +Y.
  b.vx += (jx * c - jz * sn) * sc[10]!;
  b.vy += (-jx * sn - jz * c) * sc[10]!;
  b.yawRate += (sc[3]! * jx - sc[2]! * jz) * sc[12]!;
  c = Math.cos(a.yaw);
  sn = Math.sin(a.yaw);
  a.vx -= (jx * c - jz * sn) * sc[9]!;
  a.vy -= (-jx * sn - jz * c) * sc[9]!;
  a.yawRate -= (sc[1]! * jx - sc[0]! * jz) * sc[11]!;
}
