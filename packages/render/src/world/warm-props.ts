import {
  InstancedMesh,
  Light,
  type Object3D,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { PropRegistry } from '../props/registry';

/**
 * Draw every registered level once during loading: uploads buffers and exercises shaders. Only the
 * props are drawn: everything else drawable in the scene is hidden for the pass, while the
 * scene's lights, fog and environment stay, so the programs compiled are the ones the race uses.
 */
export function warmPropLevels(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  props: PropRegistry,
): void {
  const target = new WebGLRenderTarget(1, 1);
  const previous = renderer.getRenderTarget();
  const shadows = renderer.shadowMap.autoUpdate;
  const hidden: Object3D[] = [];
  const inProps = new Set<Object3D>();
  props.group.traverse((object) => void inProps.add(object));
  scene.traverse((object) => {
    if (inProps.has(object) || !object.visible) return;
    const drawable =
      'isMesh' in object || 'isPoints' in object || 'isLine' in object || 'isSprite' in object;
    if (!drawable) return;
    // Hiding an object hides its children too: keep any that carries a light.
    let lit = false;
    object.traverse((child) => void (lit ||= child instanceof Light));
    if (lit) return;
    object.visible = false;
    hidden.push(object);
  });
  const states: { mesh: InstancedMesh; visible: boolean; cull: boolean; count: number }[] = [];
  props.group.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return;
    states.push({
      mesh: object,
      visible: object.visible,
      cull: object.frustumCulled,
      count: object.count,
    });
    object.visible = true;
    object.frustumCulled = false;
    object.count = Math.min(1, object.count);
  });
  try {
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  } finally {
    for (const object of hidden) object.visible = true;
    for (const { mesh, visible, cull, count } of states) {
      mesh.visible = visible;
      mesh.frustumCulled = cull;
      mesh.count = count;
    }
    renderer.shadowMap.autoUpdate = shadows;
    renderer.setRenderTarget(previous);
    target.dispose();
  }
}
