/** Conditions the car drives in. Plain data, passed to every step. */
export interface Environment {
  /** Air density, kg/m³. */
  airDensity: number;
  /** Wind velocity in the world frame, m/s. Zero for now; the aero model ignores it. */
  windX: number;
  windZ: number;
  /** Gravitational acceleration, m/s². */
  gravity: number;
}

/** Standard gravity, m/s². */
export const STANDARD_GRAVITY = 9.80665;

/**
 * Air density from altitude and temperature: ISA pressure at that altitude, dry air.
 * The validation targets use "ISA-like conditions corrected to the event (25 °C, the
 * circuit's altitude)" (docs/physics-validation.md section 2.1).
 */
export function airDensity(altitude: number, temperatureC: number): number {
  const pressure = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  return pressure / (287.05 * (temperatureC + 273.15));
}

export function createEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    airDensity: airDensity(0, 25),
    windX: 0,
    windZ: 0,
    gravity: STANDARD_GRAVITY,
    ...overrides,
  };
}
