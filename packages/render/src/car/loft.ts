import { BufferAttribute, BufferGeometry, Color, Shape, ExtrudeGeometry, Vector2 } from 'three';

/**
 * One cross-section of a lofted body, in the car frame (+X forward, +Y up, +Z right): a
 * superellipse of half-width `w` and half-heights `top` (above `y`) and `bottom` (below it),
 * centred at (x, y, z). `n` is the superellipse exponent: 2 is an ellipse, larger is boxier.
 */
export interface Section {
  x: number;
  y: number;
  z?: number;
  w: number;
  top: number;
  bottom: number;
  n?: number;
  /** Flatten the underside to a straight line (floor-mounted parts). */
  flatBottom?: boolean;
}

export interface LoftOptions {
  /** Points around each ring. */
  around?: number;
  /** Subdivisions between given sections (Catmull-Rom along x). */
  subdivide?: number;
  /** Close the ends with fans. */
  caps?: boolean;
  /** Per-vertex colour from the car-frame position (liveries). */
  colour?: (x: number, y: number, z: number, out: Color) => void;
  /** Only the half ring with z >= 0 or z <= 0 (sidepods built per side). */
  half?: 'left' | 'right';
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

const KEYS = ['x', 'y', 'z', 'w', 'top', 'bottom', 'n'] as const;

function interpolate(sections: readonly Section[], subdivide: number): Section[] {
  const out: Section[] = [];
  const get = (i: number): Section =>
    sections[Math.max(0, Math.min(sections.length - 1, i))] as Section;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < subdivide; k++) {
      const t = k / subdivide;
      const s: Record<string, number> = {};
      for (const key of KEYS) {
        const v = (j: number): number =>
          (get(j)[key] as number | undefined) ?? (key === 'n' ? 2 : 0);
        s[key] = catmull(v(i - 1), v(i), v(i + 1), v(i + 2), t);
      }
      out.push({
        x: s.x as number,
        y: s.y as number,
        z: s.z as number,
        w: Math.max(0.0005, s.w as number),
        top: Math.max(0.0005, s.top as number),
        bottom: Math.max(0.0005, s.bottom as number),
        n: Math.max(1.2, s.n as number),
        flatBottom: get(i).flatBottom ?? false,
      });
    }
  }
  out.push({ ...(sections[sections.length - 1] as Section) });
  return out;
}

/** A smooth closed body through the given sections, ordered nose to tail (decreasing x). */
export function loft(sections: readonly Section[], options: LoftOptions = {}): BufferGeometry {
  const around = options.around ?? 32;
  const rings = interpolate(sections, options.subdivide ?? 4);
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const c = new Color();
  const half = options.half;
  const count = half ? around / 2 + 1 : around;
  for (const r of rings) {
    const n = r.n ?? 2;
    const e = 2 / n;
    for (let k = 0; k < count; k++) {
      // Angle from +Z (right) round through +Y (up); half rings cover one side only.
      let a: number;
      if (half === 'right') a = -Math.PI / 2 + (k / (count - 1)) * Math.PI;
      else if (half === 'left') a = Math.PI / 2 + (k / (count - 1)) * Math.PI;
      else a = (k / around) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const z = (r.z ?? 0) + r.w * Math.sign(ca) * Math.abs(ca) ** e;
      let y = r.y + (sa >= 0 ? r.top : r.bottom) * Math.sign(sa) * Math.abs(sa) ** e;
      if (r.flatBottom && sa < 0) y = r.y - r.bottom;
      positions.push(r.x, y, z);
      if (options.colour) options.colour(r.x, y, z, c);
      else c.setRGB(1, 1, 1);
      colours.push(c.r, c.g, c.b);
    }
  }
  const ringCount = rings.length;
  const wrap = half ? count - 1 : count;
  for (let i = 0; i < ringCount - 1; i++) {
    for (let k = 0; k < wrap; k++) {
      const a = i * count + k;
      const b = i * count + ((k + 1) % count);
      const a2 = a + count;
      const b2 = b + count;
      // Rings run nose to tail (−X); this order faces outward.
      indices.push(a, b, a2, b, b2, a2);
    }
  }
  if (options.caps !== false && !half) {
    for (const [ring, flip] of [
      [0, false],
      [ringCount - 1, true],
    ] as const) {
      const r = rings[ring] as Section;
      const centre = positions.length / 3;
      positions.push(r.x, r.y, r.z ?? 0);
      if (options.colour) options.colour(r.x, r.y, r.z ?? 0, c);
      else c.setRGB(1, 1, 1);
      colours.push(c.r, c.g, c.b);
      for (let k = 0; k < count; k++) {
        const a = ring * count + k;
        const b = ring * count + ((k + 1) % count);
        if (flip) indices.push(centre, a, b);
        else indices.push(centre, b, a);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * An aerofoil section as a closed 2D shape (chord along +x from the leading edge, thickness
 * up +y), NACA-like with camber. Used for wing elements extruded along the span.
 */
export function aerofoil(chord: number, thickness: number, camber: number, points = 18): Shape {
  const upper: Vector2[] = [];
  const lower: Vector2[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const x = (1 - Math.cos(t * Math.PI)) / 2;
    const yt =
      5 *
      thickness *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = camber * 4 * x * (1 - x);
    upper.push(new Vector2(x * chord, (yc + yt) * chord));
    lower.push(new Vector2(x * chord, (yc - yt) * chord));
  }
  const shape = new Shape();
  shape.moveTo(upper[0]!.x, upper[0]!.y);
  for (let i = 1; i < upper.length; i++) shape.lineTo(upper[i]!.x, upper[i]!.y);
  for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i]!.x, lower[i]!.y);
  shape.closePath();
  return shape;
}

/**
 * A wing element: the aerofoil extruded across the span (along Z), with the chord pointing
 * back (−X) from the leading edge at the origin, pitched by `angle` (rad, positive = trailing
 * edge up, the way a downforce wing is set), mirrored so the camber faces downward.
 */
export function wingElement(
  chord: number,
  thickness: number,
  camber: number,
  span: number,
  angle: number,
): BufferGeometry {
  const shape = aerofoil(chord, thickness, camber);
  const g = new ExtrudeGeometry(shape, {
    depth: span,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 4,
  });
  // Shape x runs along the chord; turn it to −X (backwards) with camber downward.
  g.scale(-1, -1, 1);
  g.translate(0, 0, -span / 2);
  g.rotateZ(-angle);
  g.computeVertexNormals();
  return g;
}

/** A flat plate from a 2D outline in the X–Y plane, `thickness` thick across Z, centred. */
export function plate(
  outline: readonly [number, number][],
  thickness: number,
  bevel = 0,
): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(outline[0]![0], outline[0]![1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i]![0], outline[i]![1]);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  g.translate(0, 0, -thickness / 2);
  g.computeVertexNormals();
  return g;
}
