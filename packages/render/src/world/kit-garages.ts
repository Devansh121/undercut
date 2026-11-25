import type { PropKind, PropLod } from '../props/registry';

/** The replacement garages keep the procedural pit building's reflection and shadow policy. */
export function kitGarageKind(lods: PropLod[], shadows: boolean): PropKind {
  return {
    id: 'pit-garage',
    reflect: 'skyline',
    castShadow: shadows,
    shadowMaxDistance: 240,
    // The far level casts the same silhouette with fewer triangles.
    shadowLevel: lods.length - 1,
    shadowBatchCell: 300,
    receiveShadow: true,
    lods,
  };
}
