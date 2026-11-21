/**
 * Render quality presets. High targets a laptop GPU at 1080p; Mobile a recent phone. Lite is
 * for automated browser tests on software WebGL only: a small canvas, no shadow map and no
 * environment prefilter. Scene, cameras and logic are identical; only pixels are cut.
 */
export type QualityName = 'high' | 'mobile' | 'lite';

export interface Quality {
  readonly name: QualityName;
  /** Device-pixel-ratio cap for the drawing buffer. */
  readonly pixelRatioCap: number;
  /** Multisample anti-aliasing on the default framebuffer. */
  readonly antialias: boolean;
  /** Sun shadow map size, texels (0: no shadows), and the half-size of the fitted box, m. */
  readonly shadowMapSize: number;
  readonly shadowExtent: number;
  /** Prefiltered environment cube size from the sky (0: no environment map, more sky fill). */
  readonly envSize: number;
  /** Track mesh level of detail (see MESH_LOD in @undercut/track). */
  readonly meshLod: 'high' | 'mobile';
  /** Clearcoat on paint and carbon. */
  readonly clearcoat: boolean;
  /** Procedural texture size and anisotropic filtering. */
  readonly textureSize: number;
  readonly anisotropy: number;
  /** Shadow-casting barriers and terrain. */
  readonly sceneryShadows: boolean;
  /** Cloud layer in the sky shader. */
  readonly clouds: boolean;
}

export const QUALITY: Readonly<Record<QualityName, Quality>> = Object.freeze({
  high: Object.freeze({
    name: 'high',
    pixelRatioCap: 2,
    antialias: true,
    shadowMapSize: 4096,
    shadowExtent: 70,
    envSize: 256,
    meshLod: 'high',
    clearcoat: true,
    textureSize: 512,
    anisotropy: 8,
    sceneryShadows: true,
    clouds: true,
  }),
  mobile: Object.freeze({
    name: 'mobile',
    pixelRatioCap: 1.5,
    antialias: true,
    shadowMapSize: 1024,
    shadowExtent: 30,
    envSize: 64,
    meshLod: 'mobile',
    clearcoat: false,
    textureSize: 256,
    anisotropy: 4,
    sceneryShadows: false,
    clouds: false,
  }),
  lite: Object.freeze({
    name: 'lite',
    pixelRatioCap: 0.4,
    antialias: false,
    shadowMapSize: 0,
    shadowExtent: 30,
    envSize: 0,
    meshLod: 'mobile',
    clearcoat: false,
    textureSize: 128,
    anisotropy: 1,
    sceneryShadows: false,
    clouds: false,
  }),
});

/** Mobile on touch-first or small devices, High elsewhere. */
export function defaultQuality(touchFirst: boolean, shortEdge: number): QualityName {
  return touchFirst || shortEdge < 600 ? 'mobile' : 'high';
}
