import type { BufferGeometry } from 'three';
import type { PropKind, PropLod } from '../props/registry';
import { KitHullBuilder } from './kit-stands';

/**
 * Low-triangle silhouette matching `pit-garage` (28 tris) or `hill-pit-garage` (52 tris) bounds
 * and materials: used beyond the modelled far LOD (skyline + bay reflections) and in the shadow
 * pass. Thin rooftop terrace guardrails (to Y 8.15) and hill canopy tie-rods are omitted.
 */
export function garageHullGeometry(hill = false): BufferGeometry {
  const b = new KitHullBuilder();
  const concrete = [0.332, 0.328, 0.301] as const;
  const concretePbr = [0.88, 0.02, 0] as const;
  const paint = [0.65, 0.68, 0.72] as const;
  const paintPbr = [0.4, 0.08, 0] as const;
  const steel = [0.337, 0.366, 0.392] as const;
  const steelPbr = [0.42, 0.72, 0] as const;
  const bayDark = [0.06, 0.065, 0.07] as const;
  const bayPbr = [0.55, 0.35, 0] as const;
  const glass = [0.03, 0.04, 0.055] as const;
  const glassPbr = [0.15, 0.25, 0] as const;
  b.box(-5.0, 0, -3, 4.68, 7.14, 3, concrete, concretePbr);
  b.box(4.68, 6.86, -3, 5.33, 7.24, 3, hill ? steel : paint, hill ? steelPbr : paintPbr);
  // Front bay door and hospitality glazing bands on +X.
  b.quad(
    [4.72, 0.05, 2.7],
    [4.72, 0.05, -2.7],
    [4.72, 3.74, -2.7],
    [4.72, 3.74, 2.7],
    bayDark,
    bayPbr,
  );
  b.quad(
    [4.76, 4.88, 2.7],
    [4.76, 4.88, -2.7],
    [4.76, 6.62, -2.7],
    [4.76, 6.62, 2.7],
    glass,
    glassPbr,
  );
  if (hill) {
    // Deep cantilevered pit canopy (to X 7.50) and rooftop service volume (to Y 8.10).
    b.box(4.5, 4.56, -3, 7.5, 4.74, 3, steel, steelPbr);
    b.box(-3.75, 7.1, -1.75, -1.25, 8.1, 1.75, steel, steelPbr);
  }
  return b.build();
}

/** The replacement garages keep the procedural pit building's reflection and shadow policy. */
export function kitGarageKind(lods: PropLod[], shadows: boolean): PropKind {
  return {
    id: 'pit-garage',
    reflect: 'skyline',
    castShadow: shadows,
    shadowMaxDistance: 240,
    // The silhouette hull casts the same building shadow with far fewer triangles.
    shadowLevel: lods.length - 1,
    shadowBatchCell: 200,
    receiveShadow: true,
    lods,
  };
}
