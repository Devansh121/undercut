/** Render quality presets. High targets a laptop GPU at 1080p; Mobile a recent phone. */
export type QualityName = 'high' | 'mobile';

export interface Quality {
  readonly name: QualityName;
  /** Device-pixel-ratio cap for the drawing buffer. */
  readonly pixelRatioCap: number;
  /** Multisample anti-aliasing on the default framebuffer. */
  readonly antialias: boolean;
  /** Sun shadow map size, texels, and the half-size of the fitted shadow box, m. */
  readonly shadowMapSize: number;
  readonly shadowExtent: number;
  /** Prefiltered environment cube size from the sky. */
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
});

/** Mobile on touch-first or small devices, High elsewhere. */
export function defaultQuality(touchFirst: boolean, shortEdge: number): QualityName {
  return touchFirst || shortEdge < 600 ? 'mobile' : 'high';
}
