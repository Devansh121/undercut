import { PointLight, type Scene, type Vector3 } from 'three';

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
  private scores: Float64Array = new Float64Array(1);

  constructor(scene: Scene, count: number) {
    this.scores = new Float64Array(count + 1);
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

  /**
   * Indices of the `count` most relevant lights for `eye` (nearest by distance over reach), best
   * first, written into `out`; also returns the score of the best light left out (Infinity when
   * all fit), which sets the fade horizon. Partial insertion selection into `out`: no sorting and
   * no allocation, however many lights a circuit has.
   */
  static pick(
    lights: readonly LocalLight[],
    eye: { x: number; y: number; z: number },
    count: number,
    out: number[],
    scores: Float64Array = new Float64Array(count + 1),
  ): number {
    let n = 0;
    const keep = Math.min(count + 1, scores.length);
    const idx = out;
    idx.length = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i] as LocalLight;
      const s = Math.hypot(l.x - eye.x, l.y - eye.y, l.z - eye.z) / Math.max(1, l.distance);
      if (n === keep && s >= (scores[n - 1] as number)) continue;
      let j = n < keep ? n++ : n - 1;
      while (j > 0 && (scores[j - 1] as number) > s) {
        scores[j] = scores[j - 1] as number;
        idx[j] = idx[j - 1] as number;
        j--;
      }
      scores[j] = s;
      idx[j] = i;
    }
    const edge = n > count ? (scores[count] as number) : Infinity;
    idx.length = Math.min(n, count);
    return edge;
  }

  update(eye: Vector3): void {
    const edge = LightPool.pick(this.lights, eye, this.slots.length, this.order, this.scores);
    const picked = this.order;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i] as PointLight;
      const k = picked[i];
      const l = k === undefined ? undefined : this.lights[k];
      if (!l) {
        slot.intensity = 0;
        continue;
      }
      const s = Math.hypot(l.x - eye.x, l.y - eye.y, l.z - eye.z) / Math.max(1, l.distance);
      const fade =
        edge === Infinity ? 1 : Math.min(1, Math.max(0, (edge - s) / Math.max(0.05, edge * 0.25)));
      slot.position.set(l.x, l.y, l.z);
      slot.color.set(l.colour);
      slot.intensity = l.intensity * fade;
      slot.distance = l.distance;
    }
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
      intensity: options.intensity ?? 420,
      distance: 75,
    });
  }
  return out;
}
