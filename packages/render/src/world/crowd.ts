import {
  BufferAttribute,
  BufferGeometry,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
  type Vector3,
} from 'three';

/** Clothing colours of the crowd (linear): realistic race-day palette with muted neutrals and team-shirt accents. */
export const CLOTHING: readonly [number, number, number][] = [
  [0.54, 0.53, 0.5], // off-white tee
  [0.06, 0.065, 0.075], // charcoal
  [0.04, 0.08, 0.17], // navy
  [0.34, 0.045, 0.04], // muted crimson shirt
  [0.58, 0.54, 0.46], // sand / linen
  [0.09, 0.15, 0.08], // olive
  [0.44, 0.28, 0.06], // warm ochre
  [0.05, 0.14, 0.28], // denim / cobalt
  [0.24, 0.25, 0.27], // slate grey
  [0.48, 0.18, 0.05], // terracotta / rust
  [0.46, 0.42, 0.12], // muted mustard
  [0.06, 0.16, 0.18], // petrol teal
  [0.14, 0.14, 0.16], // dark hoodie
  [0.42, 0.42, 0.41], // light heather grey
];

const SKIN: readonly [number, number, number][] = [
  [0.48, 0.31, 0.22],
  [0.38, 0.24, 0.16],
  [0.22, 0.13, 0.08],
  [0.54, 0.37, 0.28],
];

/**
 * A seated spectator, facing +x, about 1.25 m to the top of the head from the seat: torso in the
 * instance's clothing colour (vertex colour white marks it), head in a skin tone, legs and arms in
 * dark trousers and the shirt colour.
 */
export function spectatorGeometry(variant: number): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const skin = SKIN[variant % SKIN.length] as [number, number, number];
  const hair =
    variant % 3 === 0
      ? [0.04, 0.035, 0.03]
      : variant % 3 === 1
        ? [0.11, 0.075, 0.045]
        : [0.22, 0.18, 0.12];
  const box = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    c: readonly number[],
  ): void => {
    const faces: [number[], number[][]][] = [
      [
        [1, 0, 0],
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
      ],
      [
        [0, 0, 1],
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
      ],
      [
        [0, 0, -1],
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
      ],
      [
        [0, 1, 0],
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
      ],
    ];
    for (const [n, vs] of faces) {
      const b = pos.length / 3;
      for (const v of vs) {
        pos.push(v[0] as number, v[1] as number, v[2] as number);
        nor.push(n[0] as number, n[1] as number, n[2] as number);
        col.push(c[0] as number, c[1] as number, c[2] as number);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  const shirt = [1, 1, 1];
  const trousers = [0.045, 0.05, 0.065];
  // Thighs forward on the seat, shins down in front of it.
  box(-0.04, 0.38, 0.0, 0.14, -0.16, 0.16, trousers);
  box(0.28, 0.42, -0.4, 0.0, -0.15, 0.15, trousers);
  // Slimmer reclined torso + shoulders + head with hair/cap crown.
  box(-0.18, 0.06, 0.12, 0.64, -0.18, 0.18, shirt);
  box(-0.02, 0.2, 0.36, 0.52, -0.23, -0.15, shirt);
  box(-0.02, 0.2, 0.36, 0.52, 0.15, 0.23, shirt);
  box(-0.13, 0.05, 0.66, 0.85, -0.085, 0.085, skin);
  box(-0.14, 0.05, 0.82, 0.89, -0.09, 0.09, hair);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Crowd material: clothing from the instance colour, a slow idle sway and the odd stand-up. */
export function crowdMaterial(time: { value: number }): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.name = 'crowd';
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uCrowdTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCrowdTime;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
          vColor.xyz = (color.r > 0.99 && color.g > 0.99) ? instanceColor.xyz : color.xyz;
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        {
          vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          float ph = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
          float upper = smoothstep(0.1, 0.5, position.y);
          transformed.z += sin(uCrowdTime * (0.6 + ph) + ph * 40.0) * 0.04 * upper;
          transformed.x += sin(uCrowdTime * (0.4 + ph * 0.5) + ph * 17.0) * 0.03 * upper;
        }
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'crowd-v1';
  return m;
}

/** Complementary per-person handover; a seeded threshold per person avoids partial bodies at the handover. */
export function crowdSwapMaterial(
  material: MeshStandardMaterial,
  eye: { value: Vector3 },
  near: boolean,
): void {
  const hook = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    hook(shader, renderer);
    shader.uniforms.uCrowdEye = eye;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uCrowdEye; varying float vCrowdFar; varying float vCrowdChoice;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec3 crowdOrigin = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        vCrowdFar = smoothstep(24.0, 32.0, distance(crowdOrigin, uCrowdEye));
        vCrowdChoice = fract(sin(dot(crowdOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
        if (${near ? 'vCrowdChoice < vCrowdFar' : 'vCrowdChoice >= vCrowdFar'}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vCrowdFar; varying float vCrowdChoice;',
      )
      .replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
        float crowdNoise = vCrowdChoice;
        if (${near ? 'crowdNoise < vCrowdFar' : 'crowdNoise >= vCrowdFar'}) discard;`,
      );
  };
  material.customProgramCacheKey = () => `${key}-swap-${near}`;
}
