/**
 * Per-circuit "time of day": which sky image lights the scene, where the sun is, how bright the
 * scene is exposed, how thick the haze is, and whether local lights (floodlights) take over. The
 * same pipeline renders a sunny afternoon, an overcast day with soft shadows and a night under
 * floodlights; only this data changes (docs/render.md).
 */
export interface TimeOfDay {
  readonly id: string;
  /** Sky id in assets/index.json (`skies`). */
  readonly sky: string;
  /** Multiplier on the sky's radiance (image-based light and background). */
  readonly skyIntensity: number;
  /**
   * Compass bearing of the sun, degrees from north (−Z) toward east (+X). The sky image is
   * rotated so its own sun (or brightest region) sits at this bearing; elevation is the image's.
   */
  readonly sunAzimuthDeg: number;
  /** Multiplier on the sun's measured irradiance (1: as photographed; 0: no direct sun). */
  readonly sunScale: number;
  /** Extra direct light for skies without a sun (overcast key), in sky units. */
  readonly sunFallback: number;
  /** Shadow softness multiplier: 1 hard sun, 4+ for a diffuse overcast key. */
  readonly shadowSoftness: number;
  /** Exposure before the tone map. */
  readonly exposure: number;
  /** Haze extinction at camera height, per metre (decays with height, scale 60 m). */
  readonly fogDensity: number;
  /** Haze colour: from the sky's horizon (null) or fixed (sRGB hex, multiplied by skyIntensity). */
  readonly fogColour: string | null;
  /** Floodlights: shader slots for local lights near the camera (0: none). */
  readonly localLightSlots: number;
}

/** Monza, afternoon, partly cloudy (docs/visual-direction.md): the HDRI's sun is at 48°. */
export const MONZA_AFTERNOON: TimeOfDay = Object.freeze({
  id: 'monza-afternoon',
  sky: 'monza_afternoon',
  skyIntensity: 1,
  sunAzimuthDeg: 235,
  sunScale: 1,
  sunFallback: 0,
  shadowSoftness: 1,
  exposure: 0.74,
  fogDensity: 0.00032,
  fogColour: null,
  localLightSlots: 0,
});

/** Overcast (for Spa): no sun disc, a weak diffuse key so cars keep soft contact shadows. */
export const OVERCAST_DAY: TimeOfDay = Object.freeze({
  id: 'overcast-day',
  sky: 'overcast',
  skyIntensity: 1,
  sunAzimuthDeg: 200,
  sunScale: 0,
  sunFallback: 0.9,
  shadowSoftness: 5,
  exposure: 0.9,
  fogDensity: 0.0009,
  fogColour: null,
  localLightSlots: 0,
});

/** Night under floodlights (for Singapore): a dim city-glow sky, local lights do the work. */
export const NIGHT_FLOODLIT: TimeOfDay = Object.freeze({
  id: 'night-floodlit',
  sky: 'night',
  skyIntensity: 0.06,
  sunAzimuthDeg: 0,
  sunScale: 0,
  sunFallback: 0,
  shadowSoftness: 1,
  exposure: 1.6,
  fogDensity: 0.0006,
  fogColour: '#2a2620',
  localLightSlots: 8,
});

export const TIMES_OF_DAY: Readonly<Record<string, TimeOfDay>> = Object.freeze({
  [MONZA_AFTERNOON.id]: MONZA_AFTERNOON,
  [OVERCAST_DAY.id]: OVERCAST_DAY,
  [NIGHT_FLOODLIT.id]: NIGHT_FLOODLIT,
});

/** What the asset build measured on a sky image (assets/index.json `skies.<id>`). */
export interface SkyMeta {
  hi: string;
  lo: string;
  /** Radiance = texel (linear) × scale. */
  scale: number;
  sun: {
    present: boolean;
    elevationDeg: number;
    /** Horizontal image coordinate of the sun (three.js equirect u). */
    u: number;
    /** Linear RGB irradiance of the sun disc, sky units. */
    irradiance: [number, number, number];
    solidAngleSr: number;
  };
  skyIrradiance: [number, number, number];
}

/** Unit direction of an equirect image coordinate (three.js convention), y up. */
export function equirectDirection(u: number, elevationDeg: number): [number, number, number] {
  const theta = (u - 0.5) * 2 * Math.PI;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(theta), Math.sin(el), Math.cos(el) * Math.sin(theta)];
}

/**
 * Rotation about +Y (radians, three.js convention) that carries the sky image's sun to compass
 * bearing `azimuthDeg`, and the resulting world direction toward the sun.
 */
export function skyRotation(
  meta: Pick<SkyMeta, 'sun'>,
  azimuthDeg: number,
): { rotationY: number; sunDirection: [number, number, number] } {
  const [ix, iy, iz] = equirectDirection(meta.sun.u, meta.sun.elevationDeg);
  const az = (azimuthDeg * Math.PI) / 180;
  const h = Math.hypot(ix, iz);
  const wx = Math.sin(az) * h;
  const wz = -Math.cos(az) * h;
  // A rotation by r about +Y maps the angle atan2(z, x) to atan2(z, x) − r.
  const rotationY = Math.atan2(iz, ix) - Math.atan2(wz, wx);
  return { rotationY, sunDirection: [wx, iy, wz] };
}

/**
 * Mean albedo of the ground around a car on a circuit (asphalt about 0.08, mown grass about
 * 0.06/0.11/0.02, weighted toward the asphalt under it), linear RGB.
 */
export const GROUND_ALBEDO: readonly [number, number, number] = [0.075, 0.085, 0.065];

/**
 * Radiance of the ground seen from below the horizon: the light falling on it (sun on a level
 * surface plus the sky) times the ground albedo, over pi. Replaces a pure-sky HDRI's lower half,
 * which is a blue continuation of the sky, not the circuit: undersides of the car and shadow-side
 * surfaces get a green-grey bounce of the right strength.
 */
export function groundBounce(
  meta: Pick<SkyMeta, 'sun' | 'skyIrradiance'>,
  tod: Pick<TimeOfDay, 'sunScale' | 'skyIntensity'>,
): [number, number, number] {
  const s = Math.max(0, Math.sin((meta.sun.elevationDeg * Math.PI) / 180));
  return [0, 1, 2].map((c) => {
    const sun = (meta.sun.irradiance[c] as number) * tod.sunScale * tod.skyIntensity * s;
    const sky = (meta.skyIrradiance[c] as number) * tod.skyIntensity;
    return ((GROUND_ALBEDO[c] as number) * (sun + sky)) / Math.PI;
  }) as [number, number, number];
}
