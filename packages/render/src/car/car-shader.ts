import type { WebGLProgramParametersWithUniforms } from 'three';

/**
 * Shader edits every car material gets. The asset bakes ambient occlusion into vertex colours
 * (COLOR_0), which three.js multiplies into the albedo only: reflections of the sky would then
 * light crevices, the floor's underside and the inside of the sidepods like chrome. This makes the
 * baked occlusion attenuate the environment's specular and clear-coat reflections too (once).
 */
/**
 * The occlusion edit. The baked AO already darkens the albedo (the car contract keeps three.js's
 * vertex-colour multiply), so it is not applied to reflections a second time: environment
 * reflections take only the roughness-aware specular-occlusion curve, and the clear coat the
 * baked AO once.
 */
export const CAR_AO_GLSL = /* glsl */ `#include <aomap_fragment>
    #if defined( USE_COLOR ) && defined( STANDARD )
    {
      float bakedAo = clamp( vColor.r, 0.0, 1.0 );
      float specAo = clamp( pow( max( dot( geometryNormal, geometryViewDir ), 0.0 ) + bakedAo, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + bakedAo, 0.0, 1.0 );
      reflectedLight.indirectSpecular *= specAo;
      #ifdef USE_CLEARCOAT
        clearcoatSpecularIndirect *= bakedAo;
      #endif
    }
    #endif`;

/**
 * How much of the baked AO's depth darkens the albedo. three.js multiplies vertex colours into
 * the base colour, which also darkens direct sunlight in every crevice; three quarters keeps the
 * contact darkening and lets sunlit and shadow-side detail read.
 */
export const BAKED_AO_ALBEDO_STRENGTH = 0.75;
export const CAR_COLOR_GLSL = /* glsl */ `
    #if defined( USE_COLOR_ALPHA )
      diffuseColor *= mix( vec4( 1.0 ), vColor, ${BAKED_AO_ALBEDO_STRENGTH.toFixed(2)} );
    #elif defined( USE_COLOR )
      diffuseColor.rgb *= mix( vec3( 1.0 ), vColor, ${BAKED_AO_ALBEDO_STRENGTH.toFixed(2)} );
    #endif`;

/**
 * The carbon's fibre anisotropy needs a tangent frame, which three.js derives from the UV
 * derivatives of the normal map's UVs. A triangle whose UVs have no area (a sliver, or UVs
 * collapsed by mesh compression) gives a zero frame, the anisotropic environment term then
 * normalises a zero vector, and the NaN spreads over the whole image through bloom. Such a
 * triangle gets an arbitrary frame around its normal instead; it is too small to show which.
 */
export const CAR_TANGENT_GUARD_GLSL = /* glsl */ `#include <normal_fragment_begin>
    #if defined( USE_ANISOTROPY ) && ! defined( USE_TANGENT )
      if ( dot( tbn[ 0 ], tbn[ 0 ] ) < 1e-12 || dot( tbn[ 1 ], tbn[ 1 ] ) < 1e-12 ) {
        vec3 helper = abs( normal.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
        tbn[ 0 ] = normalize( cross( helper, normal ) );
        tbn[ 1 ] = cross( normal, tbn[ 0 ] );
      }
    #endif`;

export function patchCarShader(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <color_fragment>', CAR_COLOR_GLSL)
    .replace('#include <aomap_fragment>', CAR_AO_GLSL)
    .replace('#include <normal_fragment_begin>', CAR_TANGENT_GUARD_GLSL);
}

const patched = new WeakSet<object>();
/** Glass and screens reflect or glow on their own; their housings' baked darkness must not apply. */
const EXEMPT = new Set(['mirror_glass', 'visor', 'display', 'rain_light']);

/** Add the car shader edits to `material` once (after any other onBeforeCompile it has). */
export function ensureCarShader(material: {
  name: string;
  onBeforeCompile: (shader: WebGLProgramParametersWithUniforms, renderer: never) => void;
  customProgramCacheKey: () => string;
}): void {
  if (patched.has(material) || EXEMPT.has(material.name)) return;
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
