import type { Material, Mesh, Object3D } from 'three';

/** Materials lit by the scene's directional lights (and so by every shadow cascade). */
export function isLitMaterial(m: Material): boolean {
  const t = m as Material & Record<string, unknown>;
  return Boolean(
    t.isMeshStandardMaterial ||
    t.isMeshLambertMaterial ||
    t.isMeshPhongMaterial ||
    t.isMeshToonMaterial,
  );
}

/**
 * Lit materials under `root` that are not registered with the cascaded shadows. Unregistered, a
 * material treats each cascade as its own sun and is lit several times over.
 */
export function unregisteredLitMaterials(
  root: Object3D,
  isRegistered: (m: Material) => boolean,
): Material[] {
  const out = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (isLitMaterial(m) && !isRegistered(m)) out.add(m);
    }
  });
  return [...out];
}
