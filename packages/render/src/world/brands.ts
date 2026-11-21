import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/** One invented trackside sponsor from design/brands.json. */
export interface BrandSpec {
  id: string;
  name: string;
  sub?: string;
  bg: string;
  fg: string;
  accent: string;
  style?: string;
}

export const BRAND_ATLAS_COLS = 4;
export const BRAND_ATLAS_ROWS = 5;

/** Draw one brand wordmark + emblem cleanly into a rectangular slot. */
function paintBrand(
  ctx: CanvasRenderingContext2D,
  b: BrandSpec,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // Solid base plus subtle vertical sheen so boards do not look flat.
  ctx.fillStyle = b.bg;
  ctx.fillRect(x, y, w, h);
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.06)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Subtle dark border seam between boards.
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = Math.max(2, h * 0.025);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

  const pad = Math.round(h * 0.14);
  const style = b.style ?? 'clean';
  let textLeft = x + pad;
  let centered = false;

  if (style === 'stripe') {
    ctx.fillStyle = b.accent;
    ctx.fillRect(x, y + h - Math.round(h * 0.14), w, Math.round(h * 0.14));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + h * 0.65, y);
    ctx.lineTo(x + h * 0.35, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
    textLeft = x + Math.round(h * 0.72);
  } else if (style === 'chevron') {
    ctx.fillStyle = b.accent;
    const cx = x + pad + h * 0.3;
    const cy = y + h * 0.5;
    const s = h * 0.32;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.6, cy - s);
    ctx.lineTo(cx + s * 0.2, cy - s);
    ctx.lineTo(cx + s * 0.8, cy);
    ctx.lineTo(cx + s * 0.2, cy + s);
    ctx.lineTo(cx - s * 0.6, cy + s);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    textLeft = x + Math.round(h * 0.92);
  } else if (style === 'boxed') {
    ctx.fillStyle = b.accent;
    ctx.fillRect(x + pad, y + Math.round(h * 0.2), Math.round(h * 0.18), Math.round(h * 0.6));
    ctx.fillRect(
      x + w - pad - Math.round(h * 0.18),
      y + Math.round(h * 0.2),
      Math.round(h * 0.18),
      Math.round(h * 0.6),
    );
    centered = true;
  } else if (style === 'horology' || style === 'serif') {
    ctx.strokeStyle = b.accent;
    ctx.lineWidth = Math.max(2, h * 0.025);
    ctx.beginPath();
    ctx.moveTo(x + w * 0.14, y + h * 0.18);
    ctx.lineTo(x + w * 0.86, y + h * 0.18);
    ctx.moveTo(x + w * 0.14, y + h * 0.82);
    ctx.lineTo(x + w * 0.86, y + h * 0.82);
    ctx.stroke();
    centered = true;
  } else if (style === 'tech') {
    ctx.strokeStyle = b.accent;
    ctx.lineWidth = Math.max(3, h * 0.045);
    const r = h * 0.24;
    const cx = x + pad + r;
    const cy = y + h * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = b.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    ctx.fill();
    textLeft = x + pad + Math.round(r * 2.5);
  } else if (style === 'industrial') {
    ctx.fillStyle = b.accent;
    ctx.fillRect(x, y, w, Math.round(h * 0.12));
    ctx.fillRect(x, y + h - Math.round(h * 0.12), w, Math.round(h * 0.12));
    centered = true;
  } else if (style === 'wing') {
    ctx.fillStyle = b.accent;
    for (let k = 0; k < 3; k++) {
      const y0 = y + h * (0.28 + k * 0.17);
      const len = h * (0.68 - k * 0.14);
      ctx.fillRect(x + pad, y0, len, h * 0.09);
    }
    textLeft = x + pad + Math.round(h * 0.84);
  } else if (style === 'minimal') {
    ctx.fillStyle = b.accent;
    ctx.fillRect(x + pad, y + Math.round(h * 0.72), w - pad * 2, Math.max(2, Math.round(h * 0.04)));
    centered = true;
  } else {
    ctx.fillStyle = b.accent;
    ctx.fillRect(x, y, Math.round(h * 0.15), h);
    textLeft = x + Math.round(h * 0.34);
  }

  // Primary wordmark.
  const mainSize = Math.round(h * (b.sub ? 0.44 : 0.52));
  const family =
    style === 'serif' || style === 'horology'
      ? 'Georgia, "Times New Roman", serif'
      : '"Barlow Semi Condensed", Archivo, "Helvetica Neue", Arial, sans-serif';
  const weight = style === 'horology' ? '400' : style === 'minimal' ? '600' : '700';
  ctx.fillStyle = b.fg;
  ctx.font = `${weight} ${mainSize}px ${family}`;
  ctx.textBaseline = 'middle';
  const mainY = b.sub ? y + h * 0.43 : y + h * 0.52;
  if (centered) {
    ctx.textAlign = 'center';
    ctx.fillText(b.name, x + w * 0.5, mainY, w - pad * 3);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(b.name, textLeft, mainY, w - (textLeft - x) - pad);
  }

  // Subtitle line.
  if (b.sub) {
    const subSize = Math.max(10, Math.round(h * 0.14));
    ctx.fillStyle = style === 'minimal' ? b.fg : b.accent;
    ctx.font = `600 ${subSize}px Archivo, "Helvetica Neue", Arial, sans-serif`;
    const subY = y + h * 0.73;
    if (centered) {
      ctx.textAlign = 'center';
      ctx.fillText(b.sub, x + w * 0.5, subY, w - pad * 3);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(b.sub, textLeft, subY, w - (textLeft - x) - pad);
    }
  }
  ctx.restore();
}

/**
 * Generates a 4 × 5 texture atlas of all invented brands at load time (zero network bytes).
 * Slot k lives at column `k % 4`, row `floor(k / 4)` from the top.
 */
export function brandAtlas(
  brands: readonly BrandSpec[],
  tileW = 512,
  tileH = 128,
  anisotropy = 8,
): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = BRAND_ATLAS_COLS * tileW;
  c.height = BRAND_ATLAS_ROWS * tileH;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, c.width, c.height);
  const count = BRAND_ATLAS_COLS * BRAND_ATLAS_ROWS;
  for (let i = 0; i < count; i++) {
    const b = brands[i % Math.max(1, brands.length)];
    if (!b) continue;
    const col = i % BRAND_ATLAS_COLS;
    const row = Math.floor(i / BRAND_ATLAS_COLS);
    paintBrand(ctx, b, col * tileW, row * tileH, tileW, tileH);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Generates a 4 × 2 signage atlas for trackside boards:
 * 0: 150 m braking board   1: 100 m braking board   2: 50 m braking board   3: 200 m braking board
 * 4: DRS activation board  5: DRS detection board   6: Marshal sector post  7: Big-screen live timing
 */
export function signageAtlas(anisotropy = 8): CanvasTexture {
  const tw = 256;
  const th = 256;
  const c = document.createElement('canvas');
  c.width = tw * 4;
  c.height = th * 2;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#181a1e';
  ctx.fillRect(0, 0, c.width, c.height);

  // Row 0: Braking distance boards (150, 100, 50, 200).
  const distances = ['150', '100', '50', '200'];
  distances.forEach((label, idx) => {
    const x = idx * tw;
    const y = 0;
    ctx.fillStyle = '#ebe9e1';
    ctx.fillRect(x + 4, y + 4, tw - 8, th - 8);
    // Top & bottom black reference bands.
    ctx.fillStyle = '#14161a';
    ctx.fillRect(x + 4, y + 4, tw - 8, 28);
    ctx.fillRect(x + 4, y + th - 32, tw - 8, 28);
    // Subtle dark frame border.
    ctx.strokeStyle = '#1e2126';
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 7, y + 7, tw - 14, th - 14);
    // Bold numeral.
    ctx.fillStyle = '#111316';
    ctx.font = '700 132px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + tw / 2, y + th / 2 + 4, tw - 28);
  });

  // Row 1, slot 0: DRS Activation board.
  {
    const x = 0;
    const y = th;
    ctx.fillStyle = '#14181e';
    ctx.fillRect(x + 4, y + 4, tw - 8, th - 8);
    ctx.fillStyle = '#1ea86a';
    ctx.fillRect(x + 4, y + 4, tw - 8, 36);
    ctx.fillRect(x + 4, y + th - 40, tw - 8, 36);
    ctx.fillStyle = '#f2f4f0';
    ctx.font = '700 110px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DRS', x + tw / 2, y + th / 2 + 4);
  }

  // Row 1, slot 1: DRS Detection board.
  {
    const x = tw;
    const y = th;
    ctx.fillStyle = '#14181e';
    ctx.fillRect(x + 4, y + 4, tw - 8, th - 8);
    ctx.fillStyle = '#d99a26';
    ctx.fillRect(x + 4, y + 4, tw - 8, 28);
    ctx.fillRect(x + 4, y + th - 32, tw - 8, 28);
    ctx.fillStyle = '#f2f4f0';
    ctx.font = '700 76px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DRS', x + tw / 2, y + th * 0.42);
    ctx.fillStyle = '#d99a26';
    ctx.font = '600 32px Archivo, Arial, sans-serif';
    ctx.fillText('DETECTION', x + tw / 2, y + th * 0.72);
  }

  // Row 1, slot 2: Marshal post panel (orange + white diagonal stripes).
  {
    const x = tw * 2;
    const y = th;
    ctx.fillStyle = '#d85c1e';
    ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = '#f0eee8';
    ctx.fillRect(x + 16, y + th * 0.34, tw - 32, th * 0.32);
    ctx.fillStyle = '#181a1e';
    ctx.font = '700 54px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POST', x + tw / 2, y + th * 0.51);
  }

  // Row 1, slot 3: Big-screen live timing broadcast board (invented codes from teams.json).
  {
    const x = tw * 3;
    const y = th;
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(x, y, tw, th);
    ctx.fillStyle = '#1d2430';
    ctx.fillRect(x + 8, y + 8, tw - 16, 32);
    ctx.fillStyle = '#e0642b';
    ctx.fillRect(x + 8, y + 8, 8, 32);
    ctx.fillStyle = '#f0f1ec';
    ctx.font = '700 18px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('LIVE TIMING', x + 24, y + 24);
    const rows: [string, string, string][] = [
      ['1', 'VEL', '#3D6FE0'],
      ['2', 'ASH', '#B23A4A'],
      ['3', 'COR', '#DE6A42'],
      ['4', 'HOL', '#8C72E0'],
      ['5', 'CAS', '#C98549'],
      ['6', 'MEN', '#E8AE45'],
      ['7', 'TAI', '#13A1AD'],
    ];
    rows.forEach(([pos, code, col], i) => {
      const ry = y + 52 + i * 28;
      ctx.fillStyle = i % 2 === 0 ? '#151a22' : '#11151c';
      ctx.fillRect(x + 8, ry, tw - 16, 24);
      ctx.fillStyle = col;
      ctx.fillRect(x + 36, ry + 3, 5, 18);
      ctx.fillStyle = '#cfd4dc';
      ctx.font = '700 17px "Barlow Semi Condensed", Archivo, Arial, sans-serif';
      ctx.fillText(pos, x + 16, ry + 13);
      ctx.fillStyle = '#f4f5f2';
      ctx.fillText(code, x + 50, ry + 13);
      ctx.fillStyle = '#8fa0b5';
      ctx.fillText(i === 0 ? '1:20.412' : `+0.${18 + i * 13}${i}`, x + 132, ry + 13);
    });
  }

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = anisotropy;
  return tex;
}

/**
 * Generates a clean alpha-tested wire catch-fence texture (vertical & horizontal cables + subtle
 * diagonal diamond mesh that mipmaps cleanly without heavy moiré).
 */
export function catchFenceTexture(anisotropy = 8): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);

  // Fine galvanized steel wire diamond grid (mipmaps cleanly into light translucent mesh).
  ctx.strokeStyle = 'rgba(130, 136, 144, 0.72)';
  ctx.lineWidth = 1.5;
  const step = 16;
  ctx.beginPath();
  for (let i = -size; i <= size * 2; i += step) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.moveTo(i, 0);
    ctx.lineTo(i - size, size);
  }
  ctx.stroke();

  // Horizontal high-tension retaining cables (6 crisp dark-steel wires per panel height).
  ctx.strokeStyle = 'rgba(62, 68, 76, 0.88)';
  ctx.lineWidth = 1.9;
  for (const frac of [0.1, 0.26, 0.42, 0.58, 0.74, 0.9]) {
    ctx.beginPath();
    ctx.moveTo(0, size * frac);
    ctx.lineTo(size, size * frac);
    ctx.stroke();
  }

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = anisotropy;
  return tex;
}
