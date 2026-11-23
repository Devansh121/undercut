// Build app-owned install icons and an atomic, versioned Mobile time-trial cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const GAME_NAME = /export const GAME_NAME = ['"]([^'"]+)/.exec(
  fs.readFileSync('packages/core/src/name.ts', 'utf8'),
)[1];
const dir = 'apps/web/dist';
const INK = [13, 15, 18];
const ACCENT = [224, 83, 49];

function crc(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc(body));
  return Buffer.concat([head, body, tail]);
}

/**
 * Two slanted bars, each a whole parallelogram (no clipped slivers), supersampled 4x4 so the
 * edges are smooth. `scale` is the mark's size relative to the square: the maskable icon keeps
 * it well inside the 80 % safe circle.
 */
function icon(size, scale) {
  const SS = 4;
  const half = 0.22 * scale;
  const slant = 0.36;
  const bar = 0.13 * scale;
  const gap = 0.07 * scale;
  const left = 0.5 - bar - gap / 2;
  const inMark = (u, v) => {
    const y = v - 0.5;
    if (Math.abs(y) > half) return false;
    const x = u + y * slant;
    return (x >= left && x <= left + bar) || (x >= left + bar + gap && x <= left + 2 * bar + gap);
  };
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++)
          if (inMark((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size)) hits++;
      const a = hits / (SS * SS);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(INK[c] + (ACCENT[c] - INK[c]) * a);
      pixels[i + 3] = 255;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A launch (splash) image, `width` x `height` device pixels: the ink background with the mark
 * centred, its height a fifth of the short side. Rows outside the mark are flat ink, so the PNG
 * deflates to a few kilobytes. Supersampled like the icons, only where the mark is.
 */
function splash(width, height) {
  const SS = 4;
  const size = Math.min(width, height);
  const half = 0.22 * 0.45;
  const slant = 0.36;
  const bar = 0.13 * 0.45;
  const gap = 0.07 * 0.45;
  const left = 0.5 - bar - gap / 2;
  // The mark in units of `size`, centred on the image.
  const ox = (width - size) / 2;
  const oy = (height - size) / 2;
  const inMark = (u, v) => {
    const y = v - 0.5;
    if (Math.abs(y) > half) return false;
    const x = u + y * slant;
    return (x >= left && x <= left + bar) || (x >= left + bar + gap && x <= left + 2 * bar + gap);
  };
  const stride = width * 4 + 1;
  const pixels = Buffer.alloc(stride * height);
  const x0 = Math.floor(ox + (0.5 - 0.3) * size);
  const x1 = Math.ceil(ox + (0.5 + 0.3) * size);
  const y0 = Math.floor(oy + (0.5 - half) * size) - 1;
  const y1 = Math.ceil(oy + (0.5 + half) * size) + 1;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      let a = 0;
      if (y >= y0 && y <= y1 && x >= x0 && x <= x1) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++)
          for (let sx = 0; sx < SS; sx++)
            if (inMark((x - ox + (sx + 0.5) / SS) / size, (y - oy + (sy + 0.5) / SS) / size))
              hits++;
        a = hits / (SS * SS);
      }
      const i = row + 1 + x * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(INK[c] + (ACCENT[c] - INK[c]) * a);
      pixels[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * iPhone screens in CSS pixels (portrait) and pixel ratio, for the launch images iOS shows while
 * a home-screen launch loads. iOS picks the image whose media query matches the device exactly,
 * so every current size is listed, in both orientations.
 */
const SPLASH_SCREENS = [
  [375, 667, 2], // SE (2nd and 3rd generation), 8
  [414, 896, 2], // XR, 11
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro
  [440, 956, 3], // 16 Pro Max
];

const ICONS = [
  { src: 'icon-192.png', size: 192, scale: 1.3, purpose: 'any' },
  { src: 'icon-512.png', size: 512, scale: 1.3, purpose: 'any' },
  { src: 'icon-maskable-512.png', size: 512, scale: 0.95, purpose: 'maskable' },
];
for (const i of ICONS) fs.writeFileSync(`${dir}/${i.src}`, icon(i.size, i.scale));
// iOS ignores manifest icons for Add to Home Screen and reads this one (index.html links it).
const APPLE_ICON = 'apple-touch-icon.png';
fs.writeFileSync(`${dir}/${APPLE_ICON}`, icon(180, 1.3));
if (process.argv.includes('--icons')) {
  fs.mkdirSync(`${dir}/splash`, { recursive: true });
  const links = [];
  for (const [w, h, ratio] of SPLASH_SCREENS)
    for (const orientation of ['portrait', 'landscape']) {
      const [pw, ph] = orientation === 'portrait' ? [w * ratio, h * ratio] : [h * ratio, w * ratio];
      const file = `splash/launch-${pw}x${ph}.png`;
      fs.writeFileSync(`${dir}/${file}`, splash(pw, ph));
      links.push(
        `<link rel="apple-touch-startup-image" href="./${file}" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})" />`,
      );
    }
  // Into the built page, once (the build writes a fresh index.html each time).
  const page = fs.readFileSync(`${dir}/index.html`, 'utf8');
  if (!page.includes('apple-touch-startup-image'))
    fs.writeFileSync(
      `${dir}/index.html`,
      page.replace('</head>', `${links.join('\n    ')}\n  </head>`),
    );
}
fs.writeFileSync(
  `${dir}/manifest.webmanifest`,
  JSON.stringify({
    id: './',
    name: GAME_NAME,
    short_name: GAME_NAME,
    start_url: './',
    scope: './',
    // A game: no browser bars where the platform allows (Android); iOS treats it as standalone,
    // which with the black-translucent status bar meta is edge to edge.
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: '#0d0f12',
    theme_color: '#0d0f12',
    icons: ICONS.map((i) => ({
      src: i.src,
      sizes: `${i.size}x${i.size}`,
      type: 'image/png',
      purpose: i.purpose,
    })),
  }),
);
if (process.argv.includes('--icons')) process.exit(0);

/*
 * Precache the shell (stored under './', never 'index.html': a static host may answer
 * /index.html with a redirect to /, and a redirected response cannot answer a navigation) and
 * the Mobile first-race files under assets/ (Monza's), with every circuit's own code chunks
 * (track, racing lines, dressing). Endpoints in the inventory such as network-info are dynamic
 * and are never cached.
 */
const inventory = JSON.parse(fs.readFileSync(`${dir}/first-race.json`));
const circuitCode = Object.values(inventory.circuits ?? {})
  .flatMap((c) => Object.keys(c.presets.mobile?.files ?? {}))
  .filter((f) => f.startsWith('assets/') && !/^assets\/(tex|env|car|draco|props)\//.test(f));
const files = [
  ...new Set([
    './',
    'manifest.webmanifest',
    ...ICONS.map((i) => i.src),
    APPLE_ICON,
    ...Object.keys(inventory.presets.mobile.files).filter((f) => f.startsWith('assets/')),
    ...circuitCode,
  ]),
];
const diskPath = (file) => `${dir}/${file === './' ? 'index.html' : file}`;

/*
 * Every servable file feeds the version, not only the precached ones: the worker also keeps
 * other assets/ files as they are fetched (a higher preset), so any change to the build must
 * start a new cache.
 */
const version = crypto.createHash('sha256');
version.update(fs.readFileSync(new URL(import.meta.url)));
for (const file of files) version.update(fs.readFileSync(diskPath(file)));
const walk = (root) =>
  fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(root, e.name)) : [path.join(root, e.name)]));
for (const file of walk(`${dir}/assets`).sort())
  if (!/\.(br|gz|map)$/.test(file)) {
    version.update(file);
    version.update(fs.readFileSync(file));
  }
const name = `race-shell-${version.digest('hex').slice(0, 16)}`;

// Plain ES2017 so it runs in every browser with service workers; built with no bundler.
fs.writeFileSync(
  `${dir}/sw.js`,
  `
const NAME=${JSON.stringify(name)};
const FILES=${JSON.stringify(files)};
// Dynamic or server-owned paths: always the network, never a cache.
const NEVER=['rooms','network-info','sw.js'];
const scope=new URL(self.registration.scope);
const SHELL=new URL('./',scope).href;
async function download(file){
  const response=await fetch(new URL(file,scope),{cache:'no-cache'});
  if(!response.ok) throw new Error(file+' '+response.status);
  // A copy without the redirected flag, so it may answer a navigation.
  return response.redirected
    ? new Response(await response.blob(),{status:response.status,statusText:response.statusText,headers:response.headers})
    : response;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(NAME);
  try { await Promise.all(FILES.map(async file=>cache.put(new URL(file,scope).href,await download(file)))); }
  catch(error){ await caches.delete(NAME); throw error; }
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith('race-shell-')&&key!==NAME) await caches.delete(key);
  await self.clients.claim();
})()));
// The page asks for this when the player accepts the reload prompt.
self.addEventListener('message',event=>{ if(event.data==='skip-waiting') self.skipWaiting(); });
async function answer(key,request,keep){
  const cache=await caches.open(NAME);
  const hit=await cache.match(key,{ignoreSearch:true});
  if(hit) return hit;
  // Revalidate: an unhashed asset may sit in the HTTP cache from the previous build.
  const response=await fetch(request,keep?{cache:'no-cache'}:undefined);
  if(keep&&response.status===200&&response.type==='basic'&&!response.redirected)
    await cache.put(key,response.clone()).catch(()=>{});
  return response;
}
self.addEventListener('fetch',event=>{
  const request=event.request, url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)) return;
  const path=url.pathname.slice(scope.pathname.length);
  if(NEVER.some(p=>path===p||path.startsWith(p+'/'))) return;
  if(request.mode==='navigate'){
    if(path!==''&&path!=='index.html') return;
    event.respondWith(answer(SHELL,request,false)); return;
  }
  const asset=path.startsWith('assets/');
  if(!asset&&!FILES.includes(path)) return;
  event.respondWith(answer(new URL(path,scope).href,request,asset));
});
`,
);
console.log(`Offline cache ${name}: ${files.length} files`);
