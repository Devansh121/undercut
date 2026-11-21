import {
  BufferAttribute,
  BufferGeometry,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';

/** Clothing colours of the crowd (linear): mostly muted, some team-neutral brights. */
export const CLOTHING: readonly [number, number, number][] = [
  [0.6, 0.6, 0.58],
  [0.08, 0.08, 0.09],
  [0.02, 0.05, 0.16],
  [0.45, 0.03, 0.02],
  [0.75, 0.72, 0.62],
  [0.12, 0.2, 0.08],
  [0.55, 0.35, 0.02],
  [0.02, 0.12, 0.3],
  [0.32, 0.32, 0.34],
  [0.7, 0.25, 0.02],
  [0.6, 0.55, 0.05],
  [0.04, 0.2, 0.22],
];

const SKIN: readonly [number, number, number][] = [
  [0.58, 0.38, 0.27],
  [0.45, 0.28, 0.18],
  [0.25, 0.14, 0.08],
  [0.66, 0.46, 0.35],
];

/**
 * A seated spectator, facing +x, about 1.3 m to the top of the head from the seat: torso in the
 * instance's clothing colour (vertex colour white marks it), head in a skin tone, legs and arms in
 * dark trousers and the shirt colour. 60 triangles.
 */
export function spectatorGeometry(variant: number): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const skin = SKIN[variant % SKIN.length] as [number, number, number];
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
  const trousers = [0.05, 0.05, 0.06];
  // Thighs forward on the seat, shins down in front of it.
  box(-0.05, 0.42, 0.0, 0.16, -0.19, 0.19, trousers);
  box(0.32, 0.46, -0.42, 0.0, -0.18, 0.18, trousers);
  // Torso, slightly reclined, then the head.
  box(-0.2, 0.08, 0.12, 0.68, -0.21, 0.21, shirt);
  box(-0.02, 0.24, 0.42, 0.56, -0.26, -0.18, shirt);
  box(-0.02, 0.24, 0.42, 0.56, 0.18, 0.26, shirt);
  box(-0.16, 0.06, 0.7, 0.92, -0.1, 0.1, skin);
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
