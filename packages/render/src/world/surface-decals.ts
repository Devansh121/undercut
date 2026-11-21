import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
  type Texture,
} from 'three';
import { createVec3, type Track } from '@undercut/track';

/** Procedural start/finish chequer band texture (tiling across the track width). */
function chequerTexture(anisotropy: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const cols = 8;
  const rows = 4;
  const cw = c.width / cols;
  const rh = c.height / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const white = (r + col) % 2 === 0;
      ctx.fillStyle = white ? 'rgba(235, 232, 224, 0.88)' : 'rgba(18, 20, 24, 0.85)';
      ctx.fillRect(col * cw, r * rh, cw, rh);
    }
  }
  // Subtle rubber tyre scuffing across the chequer strip.
  ctx.fillStyle = 'rgba(22, 22, 24, 0.18)';
  ctx.fillRect(0, 18, c.width, 16);
  ctx.fillRect(0, 86, c.width, 18);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  return t;
}

/** 5 × 4 atlas of painted grid slot numbers 1..20 (stencil white paint on transparent asphalt). */
function gridNumberAtlas(anisotropy: number): CanvasTexture {
  const tw = 128;
  const th = 128;
  const c = document.createElement('canvas');
  c.width = tw * 5;
  c.height = th * 4;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = 'rgba(235, 232, 224, 0.86)';
  ctx.font = '700 84px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 20; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    ctx.fillText(String(i + 1), col * tw + tw / 2, row * th + th / 2 + 2);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  return t;
}

/** Painted high-grip run-off chevron texture in invented circuit colours (slate blue + stone). */
function runoffPatternTexture(anisotropy: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(38, 72, 110, 0.65)';
  ctx.fillRect(0, 0, 256, 256);
  // Diagonal off-white safety stripes.
  ctx.fillStyle = 'rgba(222, 218, 208, 0.72)';
  for (let i = -256; i < 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 24, 0);
    ctx.lineTo(i + 24 + 256, 256);
    ctx.lineTo(i + 256, 256);
    ctx.closePath();
    ctx.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  return t;
}

/** Builds a track-conforming decal quad at (s0..s1, d0..d1) slightly lifted with polygon offset. */
function pushTrackQuad(
  track: Track,
  s0: number,
  s1: number,
  d0: number,
  d1: number,
  pos: number[],
  nor: number[],
  uv: number[],
  idx: number[],
  u0 = 0,
  v0 = 0,
  u1 = 1,
  v1 = 1,
): void {
  const p = createVec3();
  const base = pos.length / 3;
  const corners: [number, number, number, number][] = [
    [s0, d0, u0, v0],
    [s1, d0, u0, v1],
    [s1, d1, u1, v1],
    [s0, d1, u1, v0],
  ];
  for (const [s, d, u, v] of corners) {
    const sw = ((s % track.length) + track.length) % track.length;
    track.lap.pointAt(sw, d, p);
    const y = track.groundHeightAt(p.x, p.z) + 0.015;
    pos.push(p.x, y, p.z);
    nor.push(0, 1, 0);
    uv.push(u, v);
  }
  // Ensure upward winding (+Y).
  const ax = pos[base * 3]!;
  const az = pos[base * 3 + 2]!;
  const bx = pos[(base + 1) * 3]!;
  const bz = pos[(base + 1) * 3 + 2]!;
  const cx = pos[(base + 2) * 3]!;
  const cz = pos[(base + 2) * 3 + 2]!;
  const cy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  if (cy >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/**
 * Place-dependent track surface decals:
 * - Start/finish chequer band across the racing surface at s = 0
 * - Painted grid slot numbers 1..20 beside each grid slot
 * - Pit-lane fast/working lane divider line and pit-box stall numbers
 * - Painted high-grip chevron aprons on major corner run-offs
 */
export function buildSurfaceDecals(
  track: Track,
  anisotropy: number,
): { group: Group; geometries: BufferGeometry[]; materials: Material[]; textures: Texture[] } {
  const group = new Group();
  group.name = 'world:surface-decals';
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];

  const decalMat = (tex: Texture, name: string, opacity = 0.92): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity,
      roughness: 0.72,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    m.name = name;
    materials.push(m);
    return m;
  };

  // 1. Start/finish chequer band at s = 0.
  {
    const tex = chequerTexture(anisotropy);
    textures.push(tex);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const hwL = track.halfWidth[0][0] ?? 6;
    const hwR = track.halfWidth[1][0] ?? 6;
    const width = hwL + hwR;
    pushTrackQuad(track, -0.9, 0.9, -hwR, hwL, pos, nor, uv, idx, 0, 0, width / 2.4, 1);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    geometries.push(g);
    const mesh = new Mesh(g, decalMat(tex, 'start-chequer', 0.95));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 2. Painted grid slot numbers (1..20) ahead of each grid box.
  // Track +d is LEFT and -d is RIGHT when facing +s, so pass d0 = slot.d + 0.8 (left -> u0)
  // and d1 = slot.d - 0.8 (right -> u1) so digits read left-to-right from behind the car.
  if (track.gridSlots.length > 0) {
    const tex = gridNumberAtlas(anisotropy);
    textures.push(tex);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    track.gridSlots.slice(0, 20).forEach((slot, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      const u0 = col / 5;
      const u1 = (col + 1) / 5;
      const v1 = 1 - row / 4;
      const v0 = 1 - (row + 1) / 4;
      // Paint 1.6 m × 1.6 m stencil number just ahead of the grid box front line.
      pushTrackQuad(
        track,
        slot.s + 0.55,
        slot.s + 2.15,
        slot.d + 0.8,
        slot.d - 0.8,
        pos,
        nor,
        uv,
        idx,
        u0,
        v0,
        u1,
        v1,
      );
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    geometries.push(g);
    const mesh = new Mesh(g, decalMat(tex, 'grid-numbers', 0.88));
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 2b. Rubbered twin-tyre braking zones before corners and subtle burnout marks on the grid.
  {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 256);
    // Longitudinal feathered tyre-rubber tracks (two wheel tracks + subtle rubber dusting).
    const gradY = ctx.createLinearGradient(0, 0, 0, 256);
    gradY.addColorStop(0, 'rgba(12, 13, 16, 0.0)');
    gradY.addColorStop(0.22, 'rgba(12, 13, 16, 0.34)');
    gradY.addColorStop(0.78, 'rgba(12, 13, 16, 0.42)');
    gradY.addColorStop(1, 'rgba(12, 13, 16, 0.0)');
    for (const [cx, rx] of [
      [82, 34],
      [174, 34],
      [128, 74],
    ] as const) {
      ctx.save();
      ctx.globalAlpha = rx > 50 ? 0.28 : 0.72;
      ctx.fillStyle = gradY;
      ctx.fillRect(cx - rx * 0.5, 0, rx, 256);
      ctx.restore();
    }
    const rubberTex = new CanvasTexture(c);
    rubberTex.colorSpace = SRGBColorSpace;
    rubberTex.minFilter = LinearMipmapLinearFilter;
    rubberTex.magFilter = LinearFilter;
    rubberTex.anisotropy = anisotropy;
    textures.push(rubberTex);

    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    // Braking-zone rubber approaching each corner along the outside braking entry line.
    let lastZoneS = -999;
    for (const corner of track.corners) {
      if (corner.end - corner.start > 450) continue;
      if (corner.start - lastZoneS < 220) continue;
      lastZoneS = corner.start;
      const outSide: 0 | 1 = corner.direction === 'right' ? 0 : 1;
      const sign = outSide === 0 ? 1 : -1;
      const s0 = corner.start - 115;
      const s1 = corner.start + 15;
      const segs = 10;
      for (let k = 0; k < segs; k++) {
        const sa = s0 + ((s1 - s0) * k) / segs;
        const sb = s0 + ((s1 - s0) * (k + 1)) / segs;
        const idxS = Math.min(
          track.lap.count - 1,
          Math.round((((sa % track.length) + track.length) % track.length) / track.lap.step),
        );
        const hw = track.halfWidth[outSide][idxS] ?? 6;
        const dCenter = sign * Math.max(1.2, hw - 2.6);
        pushTrackQuad(
          track,
          sa,
          sb,
          dCenter + 1.85,
          dCenter - 1.85,
          pos,
          nor,
          uv,
          idx,
          0,
          k / segs,
          1,
          (k + 1) / segs,
        );
      }
    }
    // Subtle launch burnout strips behind the top 14 grid slots.
    for (const slot of track.gridSlots.slice(0, 14)) {
      pushTrackQuad(
        track,
        slot.s - 4.4,
        slot.s + 0.3,
        slot.d + 1.15,
        slot.d - 1.15,
        pos,
        nor,
        uv,
        idx,
        0,
        0,
        1,
        1,
      );
    }

    if (pos.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      geometries.push(g);
      const mesh = new Mesh(g, decalMat(rubberTex, 'track-rubber-marks', 0.78));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  // 3. Pit-lane fast/working lane dividing line & garage apron boundary line.
  {
    const pit = track.pit;
    const gs = pit.side === 'left' ? 1 : -1;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const p = createVec3();
    const s0 = pit.limitStart;
    const s1 = pit.limitEnd;
    const step = 4;
    // Two painted lines: fast-lane outer edge (d = gs * 2.2 m) and working-lane garage line (d = gs * 7.6 m).
    for (const laneD of [gs * 2.2, gs * 7.6]) {
      const halfW = 0.08;
      for (let s = s0; s < s1; s += step) {
        const sn = Math.min(s + step, s1);
        const base = pos.length / 3;
        const pts: [number, number][] = [
          [s, laneD - halfW],
          [sn, laneD - halfW],
          [sn, laneD + halfW],
          [s, laneD + halfW],
        ];
        for (const [sp, dp] of pts) {
          pit.path.pointAt(sp, dp, p);
          pos.push(p.x, track.groundHeightAt(p.x, p.z) + 0.015, p.z);
          nor.push(0, 1, 0);
        }
        const ax = pos[base * 3]!;
        const az = pos[base * 3 + 2]!;
        const bx = pos[(base + 1) * 3]!;
        const bz = pos[(base + 1) * 3 + 2]!;
        const cx = pos[(base + 2) * 3]!;
        const cz = pos[(base + 2) * 3 + 2]!;
        const cy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        if (cy >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    geometries.push(g);
    const m = new MeshStandardMaterial({
      color: 0xd8d5cc,
      roughness: 0.78,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    m.name = 'pit-lane-lines';
    materials.push(m);
    const mesh = new Mesh(g, m);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 4. Painted high-grip chevron aprons outside tight chicane exits (where asphalt run-off exists).
  {
    const tex = runoffPatternTexture(anisotropy);
    textures.push(tex);
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const c of track.corners) {
      if (c.end - c.start > 350) continue;
      const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
      const sign = outSide === 0 ? 1 : -1;
      const s0 = c.start;
      const s1 = c.end + 18;
      const step = 6;
      for (let s = s0; s < s1; s += step) {
        const sn = Math.min(s + step, s1);
        const idxS = Math.min(
          track.lap.count - 1,
          Math.round((((s % track.length) + track.length) % track.length) / track.lap.step),
        );
        const hw = track.halfWidth[outSide][idxS] ?? 6;
        const bar = Math.abs(track.barrier[outSide][idxS] ?? 10);
        if (bar - hw < 4.5) continue;
        const dIn = sign * (hw + 1.4);
        const dOut = sign * Math.min(bar - 1.2, hw + 5.2);
        pushTrackQuad(
          track,
          s,
          sn,
          Math.min(dIn, dOut),
          Math.max(dIn, dOut),
          pos,
          nor,
          uv,
          idx,
          0,
          (s - s0) / 6,
          1,
          (sn - s0) / 6,
        );
      }
    }
    if (pos.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
      g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
      g.setIndex(idx);
      g.computeBoundingSphere();
      geometries.push(g);
      const mesh = new Mesh(g, decalMat(tex, 'runoff-paint', 0.72));
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  return { group, geometries, materials, textures };
}
