import type { Track } from '@undercut/track';

/** A track plan fitted into an SVG viewBox, north up (world +X east is right, +Z south is down). */
export interface MinimapPlan {
  width: number;
  height: number;
  /** Closed SVG path of the centreline. */
  path: string;
  /** Map position of a world point. */
  project(x: number, z: number): [number, number];
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
  const project = (x: number, z: number): [number, number] => [
    ox + (x - minX) * scale,
    oy + (z - minZ) * scale,
  ];
  const parts: string[] = [];
  for (let i = 0; i < n; i += stride) {
    const [px, py] = project(lap.x[i] as number, lap.z[i] as number);
    parts.push(`${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  const [sx, sy] = project(lap.x[0] as number, lap.z[0] as number);
  const nx = lap.nx[0] as number;
  const nz = lap.nz[0] as number;
  const half = 5;
  return {
    width,
    height,
    path: `${parts.join('')}Z`,
    project,
    startLine: [sx - nx * half, sy - nz * half, sx + nx * half, sy + nz * half],
  };
}
