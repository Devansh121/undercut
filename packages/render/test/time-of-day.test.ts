import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MONZA_AFTERNOON, equirectDirection, skyRotation } from '../src/lighting/time-of-day';

describe('sky rotation', () => {
  const meta = {
    sun: {
      present: true,
      elevationDeg: 47.9,
      u: 0.595,
      irradiance: [4, 4, 4] as [number, number, number],
      solidAngleSr: 4e-4,
    },
  };

  it('puts the sun at the requested compass bearing with the image elevation', () => {
    for (const az of [0, 90, 180, 235, 300]) {
      const { sunDirection } = skyRotation(meta, az);
      const [x, y, z] = sunDirection;
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
      expect((Math.asin(y) * 180) / Math.PI).toBeCloseTo(47.9, 6);
      // Bearing from north (−Z) toward east (+X).
      const bearing = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
      expect(bearing).toBeCloseTo(az, 6);
    }
  });

  it('is the rotation that carries the image direction onto the world direction', () => {
    const { rotationY, sunDirection } = skyRotation(meta, MONZA_AFTERNOON.sunAzimuthDeg);
    const img = new Vector3(...equirectDirection(meta.sun.u, meta.sun.elevationDeg));
    img.applyMatrix4(new Matrix4().makeRotationY(rotationY));
    expect(img.x).toBeCloseTo(sunDirection[0], 6);
    expect(img.y).toBeCloseTo(sunDirection[1], 6);
    expect(img.z).toBeCloseTo(sunDirection[2], 6);
  });

  it('Monza afternoon puts the sun in the south-west', () => {
    const [x, , z] = skyRotation(meta, MONZA_AFTERNOON.sunAzimuthDeg).sunDirection;
    expect(x).toBeLessThan(0); // west
    expect(z).toBeGreaterThan(0); // south (+Z)
  });
});
