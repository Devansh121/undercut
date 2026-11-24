import type { Material, Vector3, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';

/**
 * Split one set of instances between two kinds by each instance's distance from the eye, decided
 * in the vertex stage: the near material draws an instance whose origin is nearer than
 * `distance`, the far material every other, so each instance is drawn by exactly one of them and
 * whole. The two kinds can then be chunked differently: the near one in small cells (so only
 * cells within reach draw at all), the far one in large cells (few draw calls).
 */
export function instanceHandover(
  material: Material,
  eye: { value: Vector3 },
  distance: number,
  near: boolean,
): void {
  const hook = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  const reach = distance.toFixed(2);
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    hook(shader, renderer);
    shader.uniforms.uHandoverEye = eye;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHandoverEye;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
        {
          vec3 handoverOrigin = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
          bool handoverNear = distance(handoverOrigin, uHandoverEye) < ${reach};
          if (${near ? '!handoverNear' : 'handoverNear'}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
        #endif`,
      );
  };
  material.customProgramCacheKey = () => `${key}-handover-${near ? 'near' : 'far'}-${reach}`;
}
