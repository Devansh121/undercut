import {
  CAR_FRICTION,
  CAR_REACH,
  CAR_RESTITUTION,
  CONTACT_SLOP,
  carFootprint,
  collideFootprints,
  type CarFootprint,
  type FootprintHit,
} from './car-contact';
import type { SurfaceSampler } from './contracts';
import { BODY_HALF_WIDTH, BODY_NOSE, BODY_TAIL } from './model';
import { computeMass, type CarState, type MassState } from './state';
import { resolveWallContact } from './step';

/**
 * Online car-to-car contact against latency-compensated remote proxies.
 *
 * Each browser simulates its own car(s) at 240 Hz; remote cars arrive as 30 Hz snapshots.
 * Colliding against the delayed render pose (`serverNow - delayMs`) would lag 7–15 m behind at
 * racing speed, causing cars that are side-by-side in reality to pass right through each other.
 * Instead, each client extrapolates non-ghost remote cars forward to `serverNow` (bounded at
 * `MAX_CONTACT_EXTRAPOLATION_S`, matching the remote buffer's extrapolation window) and resolves
 * symmetric equal-mass contact against them:
 *
 * - Same oriented-box SAT narrow phase (`collideFootprints`) and planar impulse model
 *   (`CAR_RESTITUTION`, `CAR_FRICTION`) as `car-contact.ts`.
 * - Combined two-car effective mass (`wa + wb`), applying ONLY the owned car's share — both
 *   clients apply their own half symmetrically when they touch.
 * - Bounded closing speed (`MAX_REMOTE_CLOSING_SPEED`) and bounded per-step positional separation
 *   (`MAX_REMOTE_PUSH_PER_STEP`) prevent latency-induced overlaps from teleporting or launching.
 * - Strictly planar (`x, z, vx, vy, yawRate` only): zero vertical force, impossible to launch.
 * - Mandatory post-contact barrier clamping (`resolveWallContact`): no remote car can ever push
 *   an owned car through a track barrier.
 */

/** Longest extrapolation horizon used for remote contact proxies, s (matches remote buffer). */
export const MAX_CONTACT_EXTRAPOLATION_S = 0.25;
/** Maximum closing speed accepted into a remote-contact impulse, m/s. */
export const MAX_REMOTE_CLOSING_SPEED = 40;
/** Maximum positional push-out applied to the owned car per 240 Hz step, m (14.4 m/s). */
export const MAX_REMOTE_PUSH_PER_STEP = 0.06;
/**
 * Largest clock-sync uncertainty added to a proxy's prediction horizon, s. The client's measured
 * error is an upper bound (half the worst of its best round trips); on a slow link it can exceed
 * any real offset, so it is capped here. The 0.3 m allowance cap still applies on top.
 */
export const MAX_CONTACT_CLOCK_ERROR_S = 0.1;
/** Solver passes per step (handles being pinched between two remote cars). */
export const REMOTE_CONTACT_PASSES = 2;

/** Kinematic proxy for a remote car in the world ground plane. */
export interface RemoteContactBody {
  seat: number;
  x: number;
  z: number;
  yaw: number;
  /** World-frame velocities, m/s. */
  vx: number;
  vz: number;
  /** Yaw rate about +Y, rad/s. */
  yawRate: number;
  /** Age of the newest received pose at the contact tick, s. Zero for owned/fresh bodies. */
  ageSec?: number;
  /**
   * This client's measured clock-sync error, s (`ClockSync.error`). A pose's true age may differ
   * from `ageSec` by up to this much. Clamped to `[0, MAX_CONTACT_CLOCK_ERROR_S]`.
   */
  clockErrorSec?: number;
  /** True when the remote car must not collide (held, fading, retired, reset grace). */
  ghost?: boolean;
}

/**
 * Extrapolate a remote car's planar state forward by `dtSec` (clamped to
 * `[0, MAX_CONTACT_EXTRAPOLATION_S]`) using constant body-frame velocity and yaw rate (midpoint
 * circular arc). Preserves cornering trajectories far better than straight-line extrapolation.
 */
export function extrapolateRemoteBody(
  src: Readonly<RemoteContactBody>,
  dtSec: number,
  out: RemoteContactBody,
): RemoteContactBody {
  const dt =
    dtSec <= 0 ? 0 : dtSec > MAX_CONTACT_EXTRAPOLATION_S ? MAX_CONTACT_EXTRAPOLATION_S : dtSec;
  out.seat = src.seat;
  out.ageSec = src.ageSec ?? 0;
  out.clockErrorSec = src.clockErrorSec ?? 0;
  out.ghost = src.ghost === true;
  out.yawRate = src.yawRate;
  if (dt === 0) {
    out.x = src.x;
    out.z = src.z;
    out.yaw = src.yaw;
    out.vx = src.vx;
    out.vz = src.vz;
    return out;
  }
  const c0 = Math.cos(src.yaw);
  const s0 = Math.sin(src.yaw);
  // World velocity to body frame (forward, left). Self-inverse transform.
  const vLong = src.vx * c0 - src.vz * s0;
  const vLat = -src.vx * s0 - src.vz * c0;
  const ym = src.yaw + 0.5 * src.yawRate * dt;
  const cm = Math.cos(ym);
  const sm = Math.sin(ym);
  out.x = src.x + (vLong * cm - vLat * sm) * dt;
  out.z = src.z + (-vLong * sm - vLat * cm) * dt;
  let yaw1 = src.yaw + src.yawRate * dt;
  if (yaw1 > Math.PI) yaw1 -= 2 * Math.PI;
  else if (yaw1 < -Math.PI) yaw1 += 2 * Math.PI;
  out.yaw = yaw1;
  const c1 = Math.cos(yaw1);
  const s1 = Math.sin(yaw1);
  out.vx = vLong * c1 - vLat * s1;
  out.vz = -vLong * s1 - vLat * c1;
  return out;
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
const localBox: CarFootprint = { cx: 0, cz: 0, fx: 1, fz: 0, halfLength: 0, halfWidth: 0 };
const remoteBox: CarFootprint = { cx: 0, cz: 0, fx: 1, fz: 0, halfLength: 0, halfWidth: 0 };
const hitScratch: FootprintHit = { depth: 0, nx: 0, nz: 0, px: 0, pz: 0 };

/** Prediction horizon for a stale proxy: pose age plus bounded clock-sync uncertainty, s. */
function predictionHorizon(r: RemoteContactBody): number {
  const age = Math.max(0, r.ageSec ?? 0);
  const clock = Math.min(MAX_CONTACT_CLOCK_ERROR_S, Math.max(0, r.clockErrorSec ?? 0));
  return age + clock;
}

function projectedRadius(b: CarFootprint, ax: number, az: number): number {
  return (
    b.halfLength * Math.abs(b.fx * ax + b.fz * az) + b.halfWidth * Math.abs(b.fz * ax - b.fx * az)
  );
}

/**
 * Resolve planar car-to-car contact between one locally simulated car (`local`) and kinematic
 * remote proxies (`remotes`). Accumulates into `local`'s contact diagnostics (does not zero them,
 * so it composes cleanly after `resolveCarContacts`). When any contact occurs and `surface` has
 * barriers, immediately runs `resolveWallContact` so `local` can never be pushed through a wall.
 *
 * Returns the number of distinct remote cars touched on this step.
 */
export function resolveRemoteCarContacts(
  local: CarState,
  remotes: readonly RemoteContactBody[],
  surface?: SurfaceSampler,
): number {
  const n = remotes.length;
  if (n === 0) return 0;

  const m = computeMass(local.model, local.fuelMass, massScratch);
  const wa = 1 / m.total;
  const wb = wa; // Equal-car symmetric mass assumption.
  const ia = m.yawInertia;
  const ib = ia;
  const nose = m.a + BODY_NOSE;
  const tail = m.b + BODY_TAIL;
  const ahead = (nose - tail) / 2;
  const halfLength = (nose + tail) / 2;
  const halfWidth = BODY_HALF_WIDTH;

  let touched = 0;
  let anyContact = false;
  let hitMask = 0;
  for (let pass = 0; pass < REMOTE_CONTACT_PASSES; pass++) {
    let passHit = false;
    for (let i = 0; i < n; i++) {
      if (i < 31 && (hitMask & (1 << i)) !== 0) continue;
      const r = remotes[i]!;
      if (r.ghost === true) continue;
      const dx = r.x - local.x;
      if (dx > 2 * CAR_REACH || dx < -2 * CAR_REACH) continue;
      const dz = r.z - local.z;
      if (dz > 2 * CAR_REACH || dz < -2 * CAR_REACH) continue;

      carFootprint(local, localBox);
      const rc = Math.cos(r.yaw);
      const rs = Math.sin(r.yaw);
      remoteBox.fx = rc;
      remoteBox.fz = -rs;
      remoteBox.cx = r.x + ahead * rc;
      remoteBox.cz = r.z - ahead * rs;
      const lc = Math.cos(local.yaw),
        ls = Math.sin(local.yaw);
      remoteBox.halfLength = halfLength;
      remoteBox.halfWidth = halfWidth;

      const horizon = predictionHorizon(r);
      if (!collideFootprints(localBox, remoteBox, hitScratch)) {
        // The proxy is already extrapolated to now. This is an approach-only prediction
        // horizon, not another extrapolation or an isotropic pose-error margin.
        // Find the separating face normal, then reserve at most horizon * normal closing speed
        // (pose age plus bounded clock-sync error).
        let gap = -Infinity;
        let nx = 0;
        let nz = 0;
        for (let axis = 0; axis < 4; axis++) {
          const box = axis < 2 ? localBox : remoteBox;
          const ax = axis % 2 === 0 ? box.fx : box.fz;
          const az = axis % 2 === 0 ? box.fz : -box.fx;
          const dist = (remoteBox.cx - localBox.cx) * ax + (remoteBox.cz - localBox.cz) * az;
          const separation =
            Math.abs(dist) - projectedRadius(localBox, ax, az) - projectedRadius(remoteBox, ax, az);
          if (separation > gap) {
            gap = separation;
            nx = ax * (dist >= 0 ? 1 : -1);
            nz = az * (dist >= 0 ? 1 : -1);
          }
        }
        const closing =
          (local.vx * lc - local.vy * ls - r.vx) * nx +
          (-local.vx * ls - local.vy * lc - r.vz) * nz;
        if (closing <= 0) continue;
        const allowance = Math.min(0.3, horizon * closing);
        if (gap >= allowance) continue;
        // Translate only along that normal; recheck all SAT axes at the predicted face.
        remoteBox.cx -= nx * allowance;
        remoteBox.cz -= nz * allowance;
        if (!collideFootprints(localBox, remoteBox, hitScratch)) continue;
        // At a corner a different face can become limiting after translation. Leave that
        // ambiguous speculative contact to the real overlap solver on a later step.
        if (hitScratch.nx * nx + hitScratch.nz * nz < 1 - 1e-9) continue;
        // Rotation at the face must also be approaching before any speculative push.
        const pax = local.vx * lc - local.vy * ls + local.yawRate * (hitScratch.pz - local.z);
        const paz = -local.vx * ls - local.vy * lc - local.yawRate * (hitScratch.px - local.x);
        const pbx = r.vx + r.yawRate * (hitScratch.pz - r.z);
        const pbz = r.vz - r.yawRate * (hitScratch.px - r.x);
        if ((pbx - pax) * hitScratch.nx + (pbz - paz) * hitScratch.nz >= 0) continue;
      } else if (horizon > 0) {
        // Already touching a stale proxy: it still hides horizon * closing speed of approach along
        // this normal. Reserve that depth only while the contact point is closing, so
        // parallel or separating contact is resolved on its measured overlap alone.
        const pax = local.vx * lc - local.vy * ls + local.yawRate * (hitScratch.pz - local.z);
        const paz = -local.vx * ls - local.vy * lc - local.yawRate * (hitScratch.px - local.x);
        const pbx = r.vx + r.yawRate * (hitScratch.pz - r.z);
        const pbz = r.vz - r.yawRate * (hitScratch.px - r.x);
        const closing = (pax - pbx) * hitScratch.nx + (paz - pbz) * hitScratch.nz;
        if (closing > 0) hitScratch.depth += Math.min(0.3, horizon * closing);
      }
      if (i < 31) hitMask |= 1 << i;
      passHit = true;
      anyContact = true;
      touched++;
      local.carContacts += 1;

      const nx = hitScratch.nx;
      const nz = hitScratch.nz;
      // Bounded half-share positional separation (the remote peer separates the other half).
      const overlap = hitScratch.depth - CONTACT_SLOP;
      if (overlap > 0) {
        const push = Math.min(0.5 * overlap, MAX_REMOTE_PUSH_PER_STEP);
        local.x -= nx * push;
        local.z -= nz * push;
      }

      const rax = hitScratch.px - local.x;
      const raz = hitScratch.pz - local.z;
      const rbx = hitScratch.px - r.x;
      const rbz = hitScratch.pz - r.z;

      const ca = Math.cos(local.yaw);
      const sa = Math.sin(local.yaw);
      const pax = local.vx * ca - local.vy * sa + local.yawRate * raz;
      const paz = -local.vx * sa - local.vy * ca - local.yawRate * rax;
      const pbx = r.vx + r.yawRate * rbz;
      const pbz = r.vz - r.yawRate * rbx;

      const vn = (pbx - pax) * nx + (pbz - paz) * nz;
      if (vn >= 0) continue;

      const closing = Math.min(-vn, MAX_REMOTE_CLOSING_SPEED);
      const ran = raz * nx - rax * nz;
      const rbn = rbz * nx - rbx * nz;
      const jn =
        ((1 + CAR_RESTITUTION) * closing) / (wa + wb + (ran * ran) / ia + (rbn * rbn) / ib);
      const jnx = nx * jn;
      const jnz = nz * jn;
      // Apply only local car's symmetric share (-j on A).
      local.vx -= (jnx * ca - jnz * sa) * wa;
      local.vy -= (-jnx * sa - jnz * ca) * wa;
      local.yawRate -= (raz * jnx - rax * jnz) / ia;

      // Tangent Coulomb friction from post-normal velocity.
      const tx = -nz;
      const tz = nx;
      const pax2 = local.vx * ca - local.vy * sa + local.yawRate * raz;
      const paz2 = -local.vx * sa - local.vy * ca - local.yawRate * rax;
      const vt = (pbx - pax2) * tx + (pbz - paz2) * tz;
      const rat = raz * tx - rax * tz;
      const rbt = rbz * tx - rbx * tz;
      let jt = -vt / (wa + wb + (rat * rat) / ia + (rbt * rbt) / ib);
      const jmax = CAR_FRICTION * jn;
      if (jt > jmax) jt = jmax;
      else if (jt < -jmax) jt = -jmax;
      const jtx = tx * jt;
      const jtz = tz * jt;
      local.vx -= (jtx * ca - jtz * sa) * wa;
      local.vy -= (-jtx * sa - jtz * ca) * wa;
      local.yawRate -= (raz * jtx - rax * jtz) / ia;

      const jm = Math.hypot(jn, jt);
      local.carContactImpulse += jm;
      if (closing > local.carContactSpeed) local.carContactSpeed = closing;
    }
    if (!passHit) break;
  }

  if (anyContact && surface?.wall) {
    resolveWallContact(local, surface);
  }
  return touched;
}
