import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  Vector4,
} from 'three';
import type { DressingFile, MappedFeature } from './dressing';

/** Ground the map describes, drawn into a texture over the dressed area. */
export interface CoverMap {
  texture: CanvasTexture;
  /** x0, z0, 1 / width, 1 / depth: world x-z to texture uv. */
  transform: Vector4;
  /** Whether a tree may stand at (x, z): not on a road, path, building, water or car park. */
  treeAllowed: (x: number, z: number) => boolean;
  dispose: () => void;
}

/** Widths of mapped lines on the ground, m. */
const LINE_WIDTH: Record<string, number> = {
  road: 7,
  service: 4,
  path: 2.4,
  raceway: 12,
  bridge: 6,
  tunnel: 6,
  waterway: 4,
};

/**
 * Rasterise the dressing's ground classes into an RGBA texture over the area around the circuit
 * (`metresPerPixel` resolution): R woodland floor, G unpaved (paths, service tracks), B paved
 * (roads, car parks, building aprons), A unused (opaque, the canvas premultiplies alpha). A second,
 * CPU-only raster of the same area marks where trees may not stand.
 */
export function buildCoverMap(
  dressing: DressingFile,
  area: { x0: number; z0: number; x1: number; z1: number },
  metresPerPixel: number,
): CoverMap {
  const w = Math.ceil((area.x1 - area.x0) / metresPerPixel);
  const h = Math.ceil((area.z1 - area.z0) / metresPerPixel);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const k = 1 / metresPerPixel;
  const path = (f: MappedFeature): void => {
    ctx.beginPath();
    for (let i = 0; i + 1 < f.p.length; i += 2) {
      const x = ((f.p[i] as number) - area.x0) * k;
      const y = ((f.p[i + 1] as number) - area.z0) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  const fillAreas = (list: readonly MappedFeature[], style: string): void => {
    ctx.fillStyle = style;
    for (const f of list) {
      path(f);
      ctx.closePath();
      ctx.fill();
    }
  };
  const strokeLines = (list: readonly MappedFeature[], style: string, width: number): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width * k;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const f of list) {
      path(f);
      ctx.stroke();
    }
  };
  const m = dressing.mapped;
  ctx.filter = `blur(${Math.max(0.6, 3 * k).toFixed(2)}px)`;
  fillAreas(m.wood, 'rgb(230,0,0)');
  fillAreas(m.scrub, 'rgb(110,0,0)');
  ctx.filter = 'none';
  // Paved and unpaved replace the woodland floor where they cross it.
  ctx.globalCompositeOperation = 'source-over';
  const unpaved = (f: MappedFeature): boolean => {
    const s = f.t?.surface ?? '';
    return /gravel|dirt|ground|earth|unpaved|compacted|grass|fine_gravel|sand/.test(s);
  };
  strokeLines(
    m.path.filter((f) => !unpaved(f)),
    'rgb(0,200,0)',
    LINE_WIDTH.path as number,
  );
  strokeLines(m.path.filter(unpaved), 'rgb(0,255,0)', LINE_WIDTH.path as number);
  strokeLines(m.service.filter(unpaved), 'rgb(0,255,0)', LINE_WIDTH.service as number);
  strokeLines(
    m.service.filter((f) => !unpaved(f)),
    'rgb(0,0,255)',
    LINE_WIDTH.service as number,
  );
  strokeLines(m.road, 'rgb(0,0,255)', LINE_WIDTH.road as number);
  fillAreas(m.parking, 'rgb(0,40,230)');
  ctx.strokeStyle = 'rgb(0,0,200)';
  ctx.lineWidth = 3 * k;
  for (const f of [...m.building, ...m.grandstand]) {
    path(f);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.flipY = false;

  // Where trees may not stand: everything paved, built or wet, with a margin.
  const bc = document.createElement('canvas');
  bc.width = w;
  bc.height = h;
  const b = bc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  b.fillStyle = '#000';
  b.fillRect(0, 0, w, h);
  b.strokeStyle = b.fillStyle = '#fff';
  b.lineCap = 'round';
  b.lineJoin = 'round';
  const bpath = (f: MappedFeature): void => {
    b.beginPath();
    for (let i = 0; i + 1 < f.p.length; i += 2) {
      const x = ((f.p[i] as number) - area.x0) * k;
      const y = ((f.p[i + 1] as number) - area.z0) * k;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
  };
  for (const [cls, width] of Object.entries(LINE_WIDTH)) {
    b.lineWidth = (width + 5) * k;
    for (const f of m[cls as keyof typeof m] as MappedFeature[]) {
      bpath(f);
      b.stroke();
    }
  }
  b.lineWidth = 6 * k;
  for (const f of [...m.building, ...m.grandstand, ...m.parking, ...m.water]) {
    bpath(f);
    b.closePath();
    b.fill();
    b.stroke();
  }
  const blocked = b.getImageData(0, 0, w, h).data;
  const treeAllowed = (x: number, z: number): boolean => {
    const px = Math.floor((x - area.x0) * k);
    const py = Math.floor((z - area.z0) * k);
    if (px < 0 || py < 0 || px >= w || py >= h) return true;
    return (blocked[(py * w + px) * 4] as number) < 128;
  };
  return {
    texture,
    transform: new Vector4(area.x0, area.z0, 1 / (area.x1 - area.x0), 1 / (area.z1 - area.z0)),
    treeAllowed,
    dispose: () => texture.dispose(),
  };
}
