import type { AmbienceKind, AudioScene, OtherCarSound } from '@undercut/audio';
import type { DriveSession } from './session';

/**
 * Builds the audio scene each frame: the other cars relative to the player's car, the circuit's
 * ambience and the crowd from the grandstands around it, and the start lights. Reuses one
 * scene object; the audio engine packs it before it crosses to the worklet.
 */

/** A grandstand as the render world fits it (`StandFrame` satisfies this). */
export interface CrowdStand {
  /** Front-left corner, m, and the unit vector along the front edge. */
  ox: number;
  oz: number;
  ax: number;
  az: number;
  length: number;
  rows: number;
}

/** The listener: world position and yaw (three.js frame; positive yaw turns left). */
export interface Listener {
  x: number;
  z: number;
  yaw: number;
}

/** A full stand: 60 m of front with 20 rows. One of these 20 m away reads 1 in each ear. */
const FULL_STAND = 60 * 20;
const NEAR_FIELD = 20;
/** How far the crowd's side follows the stand's bearing (1 would be hard left or right). */
const CROWD_WIDTH = 0.8;

/** The circuit's location bed by track id. */
export function ambienceFor(trackId: string): AmbienceKind {
  if (trackId === 'spa') return 'forest';
  if (trackId === 'singapore') return 'city-night';
  return 'park';
}

/** World offset to the listener's frame: x forward, z right. */
function toListener(l: Listener, dx: number, dz: number, out: { x: number; z: number }): void {
  const c = Math.cos(l.yaw);
  const s = Math.sin(l.yaw);
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
}

/**
 * Crowd level reaching each ear: each stand is sized by its front length times its rows,
 * heard from the nearest point of its front edge, falling 6 dB per doubling of distance beyond
 * 20 m, and panned by its bearing; stands add by power.
 */
export function crowdAt(
  listener: Listener,
  stands: readonly CrowdStand[],
  out: { left: number; right: number },
): void {
  let left = 0;
  let right = 0;
  const local = { x: 0, z: 0 };
  for (const stand of stands) {
    const px = listener.x - stand.ox;
    const pz = listener.z - stand.oz;
    const t = Math.max(0, Math.min(stand.length, px * stand.ax + pz * stand.az));
    const dx = stand.ox + stand.ax * t - listener.x;
    const dz = stand.oz + stand.az * t - listener.z;
    const d = Math.hypot(dx, dz);
    const level =
      ((stand.length * stand.rows) / FULL_STAND) * (NEAR_FIELD / Math.max(NEAR_FIELD, d));
    if (!(level > 1e-4)) continue;
    toListener(listener, dx, dz, local);
    const lateral = d > 1e-6 ? local.z / d : 0;
    const angle = ((CROWD_WIDTH * lateral + 1) * Math.PI) / 4;
    left += (level * Math.cos(angle)) ** 2;
    right += (level * Math.sin(angle)) ** 2;
  }
  out.left = Math.min(2, Math.sqrt(2 * left));
  out.right = Math.min(2, Math.sqrt(2 * right));
}

/** Reused per-frame scene, with stable race-index slots for up to nineteen opponents. */
export class RaceAudioScene {
  private readonly cars: OtherCarSound[] = Array.from({ length: 19 }, () => ({
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    engineSpeed: 0,
    throttle: 0,
  }));
  private readonly crowd = { left: 0, right: 0 };
  private readonly local = { x: 0, z: 0 };
  readonly state: AudioScene = {
    cars: [],
    ambience: 'park',
    crowdLeft: 0,
    crowdRight: 0,
    lights: -1,
  };

  update(session: DriveSession, stands: readonly CrowdStand[] = []): AudioScene {
    const p = session.car.state;
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    // Body velocity (vx forward, vy left) to the world frame.
    const pvx = p.vx * c - p.vy * s;
    const pvz = -p.vx * s - p.vy * c;
    const opponents = session.quickRace ? Math.min(19, session.race.cars.length - 1) : 0;
    // A new array only when the field size changes (never during a race).
    if (this.state.cars.length !== opponents) this.state.cars = this.cars.slice(0, opponents);
    for (let i = 0; i < opponents; i++) {
      const a = session.race.worldCar(i + 1).state;
      const input = session.race.worldCar(i + 1).input;
      const out = this.cars[i]!;
      const ca = Math.cos(a.yaw);
      const sa = Math.sin(a.yaw);
      toListener(p, a.x - p.x, a.z - p.z, this.local);
      out.x = this.local.x;
      out.z = this.local.z;
      toListener(p, a.vx * ca - a.vy * sa - pvx, -a.vx * sa - a.vy * ca - pvz, this.local);
      out.vx = this.local.x;
      out.vz = this.local.z;
      out.engineSpeed = a.engineSpeed;
      out.throttle = input.throttle;
    }
    this.state.ambience = ambienceFor(session.track.id);
    crowdAt(p, stands, this.crowd);
    this.state.crowdLeft = this.crowd.left;
    this.state.crowdRight = this.crowd.right;
    const control = session.race.control;
    this.state.lights = !session.quickRace
      ? -1
      : control.phase === 'lights'
        ? control.lightsCount
        : control.phase === 'green'
          ? 6
          : -1;
    return this.state;
  }
}
