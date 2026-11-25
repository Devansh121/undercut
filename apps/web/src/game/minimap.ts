import type { Track } from '@undercut/track';

/** A track plan fitted into an SVG viewBox, north up (world +X east is right, +Z south is down). */
export interface MinimapPlan {
  width: number;
  height: number;
  /** Closed SVG path of the centreline. */
  path: string;
  /** Open SVG paths for each marshalling sector from `track.timingLine` (yellow-flag highlights). */
  sectorPaths: readonly string[];
  /** Map position of a world point; writes into `out` when given (no allocation per call). */
  project(x: number, z: number, out?: [number, number]): [number, number];
  /** Start/finish line as a short segment across the track. */
  startLine: [number, number, number, number];
}

/**
 * Fit the lap's centreline into `width` x `height` with `padding`, keeping the aspect ratio.
 * Uses every `stride`-th sample: a map needs far fewer points than the 2 m samples.
 */
export function buildMinimap(
  track: Track,
  width: number,
  height: number,
  padding = 8,
  stride = 6,
  sectorCount = 0,
  timingLine = track.timingLine,
): MinimapPlan {
  const lap = track.lap;
  const n = lap.count;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = lap.x[i] as number;
    const z = lap.z[i] as number;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const scale = Math.min(
    (width - 2 * padding) / (maxX - minX),
    (height - 2 * padding) / (maxZ - minZ),
  );
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxZ - minZ) * scale) / 2;
  const project = (x: number, z: number, out: [number, number] = [0, 0]): [number, number] => {
    out[0] = ox + (x - minX) * scale;
    out[1] = oy + (z - minZ) * scale;
    return out;
  };
  const parts: string[] = [];
  for (let i = 0; i < n; i += stride) {
    const [px, py] = project(lap.x[i] as number, lap.z[i] as number);
    parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  const sectorPaths: string[] = [];
  if (sectorCount > 0) {
    const sectorLen = track.length / sectorCount;
    const steps = Math.max(8, Math.ceil(sectorLen / 20));
    const tmp = { x: 0, y: 0, z: 0 };
    const xy: [number, number] = [0, 0];
    for (let k = 0; k < sectorCount; k++) {
      const seg: string[] = [];
      const base = timingLine + k * sectorLen;
      for (let j = 0; j <= steps; j++) {
        const s = track.wrap(base + (sectorLen * j) / steps);
        lap.pointAt(s, 0, tmp);
        project(tmp.x, tmp.z, xy);
        seg.push(`${j === 0 ? 'M' : 'L'}${xy[0].toFixed(1)} ${xy[1].toFixed(1)}`);
      }
      sectorPaths.push(seg.join(''));
    }
  }
  const [sx, sy] = project(lap.x[0] as number, lap.z[0] as number);
  const nx = lap.nx[0] as number;
  const nz = lap.nz[0] as number;
  const half = 5;
  return {
    width,
    height,
    path: `${parts.join('')}Z`,
    sectorPaths,
    project,
    startLine: [sx - nx * half, sy - nz * half, sx + nx * half, sy + nz * half],
  };
}
