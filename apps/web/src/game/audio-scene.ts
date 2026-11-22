import type { AudioScene, OtherCarSound } from '@undercut/audio';
import type { DriveSession } from './session';

/** Reused per-frame scene, with stable race-index slots for the nineteen opponents. */
export class RaceAudioScene {
  private readonly cars: OtherCarSound[] = Array.from({ length: 19 }, () => ({
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    engineSpeed: 0,
    throttle: 0,
  }));
  readonly state: AudioScene = { cars: [], circuit: 'park', progress: 0, lights: -1 };
  update(session: DriveSession): AudioScene {
    const p = session.car.state;
    const c = Math.cos(p.yaw),
      s = Math.sin(p.yaw);
    const pvx = p.vx * c - p.vy * s,
      pvz = -p.vx * s - p.vy * c;
    this.state.cars = session.quickRace ? this.cars : [];
    if (session.quickRace)
      for (let i = 0; i < 19; i++) {
        const car = session.race.worldCar(i + 1);
        const a = car.state,
          out = this.cars[i]!;
        const dx = a.x - p.x,
          dz = a.z - p.z;
        const vx = a.vx * Math.cos(a.yaw) - a.vy * Math.sin(a.yaw) - pvx;
        const vz = -a.vx * Math.sin(a.yaw) - a.vy * Math.cos(a.yaw) - pvz;
        out.x = dx * c - dz * s;
        out.z = dx * s + dz * c;
        out.vx = vx * c - vz * s;
        out.vz = vx * s + vz * c;
        out.engineSpeed = a.engineSpeed;
        out.throttle = car.input.throttle;
      }
    this.state.circuit = session.track.id.includes('spa')
      ? 'forest'
      : session.track.id.includes('singapore')
        ? 'city'
        : 'park';
    this.state.progress = (((session.s / session.track.length) % 1) + 1) % 1;
    const control = session.race.control;
    this.state.lights = session.quickRace
      ? control.phase === 'lights'
        ? control.lightsCount
        : control.phase === 'green'
          ? 6
          : -1
      : -1;
    return this.state;
  }
}
