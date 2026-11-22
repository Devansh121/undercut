import presets from './presets.json';
import type { WorldQuality } from './world/world';

/**
 * Render quality presets. The numbers live in presets.json (data, also read by the budget
 * check); this module types them and picks a default. Ultra, High, Medium and Mobile are player
 * choices; Lite is for automated browser tests on software WebGL only (no post-processing, no
 * shadow map, no environment prefilter). Scene, cameras and logic are identical at every preset;
 * only pixels and detail are cut.
 */
export type QualityName = 'ultra' | 'high' | 'medium' | 'mobile' | 'lite';
export type CarLod = 'high' | 'mobile' | 'far';
export type Tier = 'hi' | 'lo';

export interface Quality {
  readonly name: QualityName;
  readonly label: string;
  /** Device-pixel-ratio cap for the drawing buffer (before dynamic resolution). */
  readonly pixelRatioCap: number;
  /** MSAA samples on the HDR scene target (0: none). */
  readonly msaa: number;
  /** SMAA after tone mapping, for specular and thin-edge crawl MSAA misses. */
  readonly smaa: boolean;
  /** HDR target and post-processing; false renders straight to the canvas (Lite). */
  readonly post: boolean;
  /** Sun shadows: cascades (0: none), map size per cascade, last cascade's far distance. */
  readonly shadow: {
    readonly cascades: number;
    readonly mapSize: number;
    readonly maxFar: number;
    readonly softness: number;
  };
  /** A soft blob under each car (where the shadow map does not reach or is off). */
  readonly contactShadow: boolean;
  /** Prefiltered environment cube size (0: no environment map, hemisphere fill instead). */
  readonly envSize: number;
  readonly skyTier: Tier;
  readonly textureTier: Tier;
  readonly anisotropy: number;
  /** Track mesh level of detail (see MESH_LOD in @undercut/track). */
  readonly meshLod: 'high' | 'mobile';
  /** Ground-truth ambient occlusion at `scale` of the resolution. */
  readonly ao: { readonly enabled: boolean; readonly scale: number; readonly intensity: number };
  /** Bloom of what is actually bright: `threshold` in linear scene units before exposure. */
  readonly bloom: {
    readonly enabled: boolean;
    readonly strength: number;
    readonly threshold: number;
  };
  readonly clearcoat: boolean;
  /**
   * Car levels of detail this preset loads, and the projected radius (px, docs/car-asset.md)
   * below which the next one takes over.
   */
  readonly carLods: readonly CarLod[];
  readonly carLodPixels: readonly number[];
  readonly playerLod: CarLod;
  /** Kerbs and barriers cast shadows. */
  readonly sceneryShadows: boolean;
  readonly grainVignette: boolean;
  /** Film-grain amplitude (fraction of the signal in the shadows); 0 for none. */
  readonly grain: number;
  /** Radial blur at the frame edge at speed. */
  readonly speedBlur: boolean;
  /** Frame-time target for dynamic resolution (0: off) and the lowest render scale. */
  readonly dynamicResolution: { readonly targetMs: number; readonly min: number };
  /** The dressing around the circuit (docs/render.md, World). */
  readonly world: Readonly<WorldQuality>;
}

export const QUALITY_NAMES: readonly QualityName[] = ['ultra', 'high', 'medium', 'mobile', 'lite'];
/** The presets a player can choose, best first. */
export const PLAYER_QUALITIES: readonly QualityName[] = ['ultra', 'high', 'medium', 'mobile'];

function freeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o as object)) freeze(v);
    Object.freeze(o);
  }
  return o;
}

const table = presets as unknown as Record<QualityName, Omit<Quality, 'name'>>;
export const QUALITY: Readonly<Record<QualityName, Quality>> = freeze(
  Object.fromEntries(QUALITY_NAMES.map((n) => [n, { name: n, ...table[n] }])) as Record<
    QualityName,
    Quality
  >,
);

export function isQualityName(v: unknown): v is QualityName {
  return typeof v === 'string' && (QUALITY_NAMES as readonly string[]).includes(v);
}

/** Before any benchmark: Mobile on touch-first or small devices, High elsewhere. */
export function defaultQuality(touchFirst: boolean, shortEdge: number): QualityName {
  return touchFirst || shortEdge < 600 ? 'mobile' : 'high';
}

/** Relative frame cost of each preset (measured on the development laptop, docs/render.md). */
const COST: Record<QualityName, number> = {
  ultra: 1.45,
  high: 1,
  medium: 0.62,
  mobile: 0.4,
  lite: 0.1,
};

/**
 * Pick a preset from a short benchmark run at `measured`. With GPU time, choose the best preset
 * expected to fit 85 % of a 60 fps frame. With only the frame interval (vsync caps it at 16.7 ms
 * however fast the GPU is), a held 60 fps keeps the preset, and anything slower steps down.
 */
export function benchmarkPick(
  measured: QualityName,
  times: { gpuMs: number | null; frameMs: number },
  touchFirst: boolean,
): QualityName {
  const order: QualityName[] = touchFirst
    ? ['medium', 'mobile']
    : ['ultra', 'high', 'medium', 'mobile'];
  const budget = 16.67 * 0.85;
  if (times.gpuMs === null && times.frameMs <= 17.5) {
    return order.includes(measured) ? measured : (order[0] as QualityName);
  }
  const ms = times.gpuMs ?? times.frameMs;
  const base = ms / COST[measured];
  for (const q of order) if (base * COST[q] <= budget) return q;
  return 'mobile';
}

/** What the GPU and browser can do that the presets depend on. */
export interface RenderCapabilities {
  /** Half-float colour targets are renderable (EXT_color_buffer_float or _half_float). */
  floatTargets: boolean;
}

/**
 * The preset as this GPU can run it. Without renderable half-float targets there is no HDR target,
 * no post-processing and no prefiltered environment (PMREM renders into half float): the view
 * takes the direct path (scene straight to the canvas through the renderer's tone map, hemisphere
 * fill), keeping shadows, textures and cars. Otherwise the preset is returned unchanged.
 */
export function effectiveQuality(q: Quality, caps: RenderCapabilities): Quality {
  if (caps.floatTargets) return q;
  return Object.freeze({
    ...q,
    post: false,
    msaa: 0,
    smaa: false,
    envSize: 0,
    ao: { ...q.ao, enabled: false },
    bloom: { ...q.bloom, enabled: false },
    grainVignette: false,
    speedBlur: false,
    contactShadow: true,
  });
}
