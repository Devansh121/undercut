import type { WebGLProgramParametersWithUniforms } from 'three';

/**
 * Shader edits every car material gets. The asset bakes ambient occlusion into vertex colours
 * (COLOR_0), which three.js multiplies into the albedo only: reflections of the sky would then
 * light crevices, the floor's underside and the inside of the sidepods like chrome. This makes the
 * baked occlusion attenuate the environment's specular and clear-coat reflections too, with the
 * usual roughness-aware specular-occlusion curve.
 */
export function patchCarShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <aomap_fragment>',
    `#include <aomap_fragment>
    #if defined( USE_COLOR ) && defined( STANDARD )
    {
      float bakedAo = clamp( vColor.r, 0.0, 1.0 );
      float specAo = clamp( pow( max( dot( geometryNormal, geometryViewDir ), 0.0 ) + bakedAo, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + bakedAo, 0.0, 1.0 );
      reflectedLight.indirectSpecular *= specAo * bakedAo;
      #ifdef USE_CLEARCOAT
        clearcoatSpecularIndirect *= bakedAo * bakedAo;
      #endif
    }
    #endif`,
  );
}

/** Compound colour on the tyre's sidewall markings (the bright texels of its base colour). */
export const COMPOUND_GLSL = /* glsl */ `
{
  float marking = smoothstep(0.05, 0.4, diffuseColor.r);
  diffuseColor.rgb = mix(vec3(0.018), uCompound * 0.8, marking);
}`;

const patched = new WeakSet<object>();

/** Add the car shader edits to `material` once (after any other onBeforeCompile it has). */
export function ensureCarShader(material: {
  onBeforeCompile: (shader: WebGLProgramParametersWithUniforms, renderer: never) => void;
  customProgramCacheKey: () => string;
}): void {
  if (patched.has(material)) return;
  patched.add(material);
  const prev = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    prev.call(this, shader, renderer);
    patchCarShader(shader);
  };
  material.customProgramCacheKey = function () {
    return `${key.call(this)}|car-ao`;
  };
}
