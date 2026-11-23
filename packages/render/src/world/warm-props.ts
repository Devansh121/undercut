import {
  InstancedMesh,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { PropRegistry } from '../props/registry';

/** Draw every registered level once during loading: uploads buffers and exercises shaders. */
export function warmPropLevels(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  props: PropRegistry,
): void {
  const target = new WebGLRenderTarget(1, 1);
  const previous = renderer.getRenderTarget();
  const shadows = renderer.shadowMap.autoUpdate;
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
