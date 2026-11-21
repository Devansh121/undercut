/** A 3×5 pixel font for axis labels on generated images. Upper case, digits, a few symbols. */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001010010',
  '8': '111101111101111',
  '9': '111101111001111',
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '.': '000000000000010',
  ',': '000000000010100',
  '-': '000000111000000',
  '+': '000010111010000',
  '=': '000111000111000',
  ':': '000010000010000',
  '/': '001001010100100',
  '(': '010100100100010',
  ')': '010001001001010',
  '%': '101001010100101',
  ' ': '000000000000000',
};

/** Width in pixels of `text` at `scale`. */
export function textWidth(text: string, scale: number): number {
  return text.length * 4 * scale - scale;
}

/** Draw `text` into a one-byte-per-pixel image with its top-left corner at (x, y). */
export function drawText(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  text: string,
  colour: number,
  scale = 2,
): void {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '] ?? '';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (g[row * 3 + col] !== '1') continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = cx + col * scale + dx;
            const py = y + row * scale + dy;
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            pixels[py * width + px] = colour;
          }
        }
      }
    }
    cx += 4 * scale;
  }
}
