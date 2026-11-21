import { Color, PointLight, type Scene, type Vector3 } from 'three';

/** One floodlight or lamp: position (world, m), colour, intensity (candela) and reach (m). */
export interface LocalLight {
  x: number;
  y: number;
  z: number;
  colour: string;
  intensity: number;
  distance: number;
}

/**
 * Many local lights on a forward renderer: the shader has a fixed number of point-light slots
 * (each slot costs every lit pixel), and each frame the slots take the lights nearest the camera,
 * weighted by reach, so the light count in the shaders never changes (no recompiles) however
 * many lamps a circuit places. Lights further out fade to zero before they lose their slot, so
 * nothing pops. Static surfaces far from the camera are expected to carry the rest of the lamps
 * as baked light (a circuit's track lighting texture), which this pool does not replace.
 */
export class LightPool {
  private readonly slots: PointLight[] = [];
  private lights: readonly LocalLight[] = [];
  private readonly order: number[] = [];

  constructor(scene: Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const l = new PointLight(0xffffff, 0, 1, 2);
      l.castShadow = false;
      this.slots.push(l);
      scene.add(l);
    }
  }

  setLights(lights: readonly LocalLight[]): void {
    this.lights = lights;
  }

  /** Pick the `count` most relevant lights for `eye` (index order, for tests). */
  static pick(
    lights: readonly LocalLight[],
    eye: { x: number; y: number; z: number },
    count: number,
    out: number[],
  ): number[] {
    out.length = 0;
    const score = (l: LocalLight): number =>
      Math.hypot(l.x - eye.x, l.y - eye.y, l.z - eye.z) / Math.max(1, l.distance);
    const idx = lights.map((_, i) => i);
    idx.sort((a, b) => score(lights[a] as LocalLight) - score(lights[b] as LocalLight));
    for (let i = 0; i < Math.min(count, idx.length); i++) out.push(idx[i] as number);
    return out;
  }

  update(eye: Vector3): void {
    const picked = LightPool.pick(this.lights, eye, this.slots.length, this.order);
    // The last slot's score sets the fade horizon for every assigned light.
    let edge = Infinity;
    if (this.lights.length > this.slots.length) {
      const next = this.lights
        .slice()
        .sort(
          (a, b) =>
            Math.hypot(a.x - eye.x, a.z - eye.z) / a.distance -
            Math.hypot(b.x - eye.x, b.z - eye.z) / b.distance,
        )[this.slots.length];
      if (next) edge = Math.hypot(next.x - eye.x, next.z - eye.z) / next.distance;
    }
    const c = new Color();
    this.slots.forEach((slot, i) => {
      const k = picked[i];
      const l = k === undefined ? undefined : this.lights[k];
      if (!l) {
        slot.intensity = 0;
        return;
      }
      const s = Math.hypot(l.x - eye.x, l.z - eye.z) / l.distance;
      const fade =
        edge === Infinity ? 1 : Math.min(1, Math.max(0, (edge - s) / Math.max(0.05, edge * 0.25)));
      slot.position.set(l.x, l.y, l.z);
      slot.color.copy(c.set(l.colour));
      slot.intensity = l.intensity * fade;
      slot.distance = l.distance;
    });
  }

  dispose(): void {
    for (const s of this.slots) s.removeFromParent();
  }
}

/**
 * Floodlight posts along a lap, alternating sides: every `spacing` metres, `offset` metres outside
 * the track edge, `height` metres up. A stand-in for a circuit's own lighting plan (the dressing
 * slice places real posts) and the night test scene.
 */
export function floodlightsAlong(
  track: {
    length: number;
    lap: { pointAt(s: number, d: number, out: { x: number; y: number; z: number }): unknown };
    heightAt(s: number, d: number): number;
    halfWidthAt(s: number, side: 0 | 1): number;
  },
  spacing = 36,
  options: { offset?: number; height?: number; intensity?: number; colour?: string } = {},
): LocalLight[] {
  const out: LocalLight[] = [];
  const p = { x: 0, y: 0, z: 0 };
  let k = 0;
  for (let s = 0; s < track.length; s += spacing, k++) {
    const side = (k % 2) as 0 | 1;
    const d = (track.halfWidthAt(s, side) + (options.offset ?? 4)) * (side === 0 ? 1 : -1);
    track.lap.pointAt(s, d, p);
    out.push({
      x: p.x,
      y: track.heightAt(s, d) + (options.height ?? 14),
      z: p.z,
      colour: options.colour ?? '#ffe6c8',
      intensity: options.intensity ?? 60,
      distance: 75,
    });
  }
  return out;
}
