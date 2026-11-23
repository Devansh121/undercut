import { BoxGeometry, MeshStandardMaterial } from 'three';
import { tracksideObjects, type Track } from '@undercut/track';
import type { PropRegistry } from './registry';

/** Lite omits the scenery file, but contact-bearing lightweight objects must still be visible. */
export function placeLightweightFallback(track: Track, props: PropRegistry): () => void {
  const panel = new BoxGeometry(0.68, 0.88, 4.36).translate(0, 0.44, 0);
  const sign = new BoxGeometry(0.19, 2.2, 1.35).translate(0, 1.1, 0);
  const material = new MeshStandardMaterial({ color: 0xd9d5c6, roughness: 0.9 });
  for (const [id, geometry] of [
    ['light-verge', panel],
    ['light-sign', sign],
  ] as const) {
    props.define({
      id,
      castShadow: false,
      receiveShadow: true,
      chunkLength: 48,
      lods: [{ geometry, material, maxDistance: 250 }],
    });
  }
  for (const o of tracksideObjects(track)) {
    props.place(o.kind === 'verge-board' ? 'light-verge' : 'light-sign', { ...o, breakable: o });
  }
  return () => {
    panel.dispose();
    sign.dispose();
    material.dispose();
  };
}
