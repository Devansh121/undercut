import { DoubleSide, Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import carStats from '../../../docs/evidence/m2-car/stats.json';
import { COCKPIT_NIGHT } from '../src/car/car-model';
import { CONTACT_FOOTPRINT, contactFootprint } from '../src/car/contact-shadows';
import { CockpitMirrors, MIRROR_TINT, MIRROR_VIEW } from '../src/car/mirrors';
import { QUALITY, effectiveQuality } from '../src/quality';

/** The game's car (packages/sim params; axleFront is the CoG's distance behind the front axle). */
const CAR = {
  wheelbase: 3.6,
  axleFront: 1.98,
  trackFront: 1.62,
  trackRear: 1.56,
  tyreRadius: 0.355,
};

const sky = () =>
  Object.fromEntries(
    ['tSky', 'skyScale', 'skyRotation', 'groundRadiance', 'hazeColour', 'haze'].map((k) => [
      k,
      { value: null },
    ]),
  );

describe('cockpit mirrors', () => {
  it('render the view behind only on High and Ultra, small and at a reduced rate', () => {
    for (const name of ['ultra', 'high'] as const) {
      const m = QUALITY[name].mirrors;
      expect(m.width * m.height).toBeGreaterThan(0);
      // A thumbnail, not a second frame: under 2 % of a 1440 × 900 frame's pixels per frame.
      expect((m.width * m.height) / m.every).toBeLessThan(0.02 * 1440 * 900);
      expect(m.every).toBeGreaterThanOrEqual(2);
      // About the glass's own shape (wide and low).
      expect(m.width / m.height).toBeGreaterThan(2);
    }
    expect(QUALITY.ultra.mirrors.width).toBeGreaterThanOrEqual(QUALITY.high.mirrors.width);
    for (const name of ['medium', 'mobile', 'lite'] as const)
      expect(QUALITY[name].mirrors).toEqual({ width: 0, height: 0, every: 0 });
    // Without float targets nothing renders the rear view.
    const direct = effectiveQuality(QUALITY.ultra, { floatTargets: false } as never);
    expect(direct.mirrors.width).toBe(0);
  });

  it('look straight back from above the driver, past the headrest', () => {
    const body = new Group();
    const eye = { x: 0.3, y: 0.8, z: 0 };
    const mirrors = new CockpitMirrors(QUALITY.high, sky(), eye, body);
    body.updateMatrixWorld(true);
    const dir = mirrors.camera.getWorldDirection(new Vector3());
    expect(dir.x).toBeCloseTo(-1, 6);
    expect(Math.abs(dir.y) + Math.abs(dir.z)).toBeLessThan(1e-6);
    expect(mirrors.camera.position.x).toBeLessThan(eye.x);
    expect(mirrors.camera.position.y).toBeGreaterThan(eye.y);
    expect(mirrors.camera.near).toBe(MIRROR_VIEW.near);
    expect(mirrors.camera.aspect).toBeCloseTo(
      QUALITY.high.mirrors.width / QUALITY.high.mirrors.height,
      6,
    );
    expect(mirrors.live).toBe(true);
    expect(mirrors.material.name).toBe('mirror_glass');
    // Seen from the driver the asset's glass shows its back face: drawn from both sides.
    expect(mirrors.material.side).toBe(DoubleSide);
    mirrors.dispose();
    expect(body.children).toHaveLength(0);
  });

  it('show a static sky and ground on Mobile without a render target', () => {
    const mirrors = new CockpitMirrors(QUALITY.mobile, sky(), { x: 0, y: 0.8, z: 0 }, new Group());
    expect(mirrors.live).toBe(false);
    mirrors.render(null as never, null as never);
    expect(mirrors.passes).toBe(0);
    expect(mirrors.material.uniforms.uLive?.value).toBe(0);
    expect(mirrors.material.userData.surfaceUniforms).toEqual({});
    mirrors.dispose();
  });

  it('have their own glass on the levels a player drives (High and Mobile), not the far one', () => {
    const stats = carStats as unknown as Record<string, { nodes: { body: { materials: string[] } } }>;
    expect(stats.high?.nodes.body.materials).toContain('mirror_glass');
    expect(stats.mobile?.nodes.body.materials).toContain('mirror_glass');
    expect(stats.far?.nodes.body.materials).not.toContain('mirror_glass');
  });

  it('reflect like silvered glass, not a grey panel', () => {
    for (const c of MIRROR_TINT) {
      expect(c).toBeGreaterThan(0.7);
      expect(c).toBeLessThan(0.9);
    }
  });
});

describe('the cockpit at night', () => {
  it('lights the screen above its daytime level, matte, and the wheel faintly', () => {
    expect(COCKPIT_NIGHT.displayEmissive).toBeGreaterThan(1.6);
    expect(COCKPIT_NIGHT.displayRoughness).toBeGreaterThan(0.25);
    expect(COCKPIT_NIGHT.wheelFill).toBeGreaterThan(0);
    expect(COCKPIT_NIGHT.wheelFill).toBeLessThan(1);
  });
});

describe('contact shadow footprint', () => {
  const fp = contactFootprint(CAR);
  const at = (ahead: number, left: number): number => {
    // Row 0 is the front edge; column 0 the car's right-hand edge.
    const j = Math.floor(((fp.length / 2 + fp.ahead - ahead) / fp.length) * fp.rows);
    const i = Math.floor(((left + fp.width / 2) / fp.width) * fp.cols);
    return (fp.data[j * fp.cols + i] as number) / 255;
  };
  const front = CAR.axleFront;
  const rear = CAR.axleFront - CAR.wheelbase;

  it('is sized from the car: tracks and tyres across, axles and tyres along, a small margin', () => {
    expect(fp.width).toBeCloseTo(2 * (CAR.trackRear / 2 + 0.2225 + CONTACT_FOOTPRINT.margin), 6);
    expect(fp.length).toBeLessThan(6);
    expect(fp.length).toBeGreaterThan(CAR.wheelbase + 2 * CAR.tyreRadius);
  });

  it('is darkest under the floor and the tyres, light at the nose, clear past the car', () => {
    expect(at((front + rear) / 2, 0)).toBeGreaterThan(0.95);
    expect(at(front, CAR.trackFront / 2)).toBeGreaterThan(0.95);
    expect(at(rear, -CAR.trackRear / 2)).toBeGreaterThan(0.95);
    const nose = at(front + 0.5, 0);
    expect(nose).toBeGreaterThan(0.2);
    expect(nose).toBeLessThan(0.6);
    // Between the wheels' outer faces and the margin: only the faint halo.
    expect(at((front + rear) / 2, fp.width / 2 - 0.05)).toBeLessThan(CONTACT_FOOTPRINT.halo + 1e-6);
    // Ahead of the wheels and beside the nose: almost nothing.
    expect(at(front + 0.8, fp.width / 2 - 0.1)).toBeLessThan(0.05);
  });

  it('has a short penumbra at the floor edge instead of a soft round fall-off', () => {
    // Across the car at mid-wheelbase, from the centreline out: where it drops through 0.9 and 0.3.
    const mid = (front + rear) / 2;
    let in90 = NaN;
    let out30 = NaN;
    for (let left = 0; left < fp.width / 2; left += 0.005) {
      const a = at(mid, left);
      if (Number.isNaN(in90) && a < 0.9) in90 = left;
      if (Number.isNaN(out30) && a < 0.3) out30 = left;
    }
    // The floor and sidepods are about 1.5 m across.
    expect(in90).toBeGreaterThan(0.6);
    // The old radial blob took about 0.7 m to fall from 0.9 to 0.3.
    expect(out30 - in90).toBeLessThan(0.3);
    // Diagonally off the front tyres, past the car: nothing but the halo's tail.
    expect(at(front + CAR.tyreRadius + 0.15, fp.width / 2 - 0.05)).toBeLessThan(0.05);
  });
});
