// Build app-owned install icons and an atomic, versioned Mobile time-trial cache.
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const GAME_NAME = /export const GAME_NAME = ['"]([^'"]+)/.exec(
  fs.readFileSync('packages/core/src/name.ts', 'utf8'),
)[1];
const dir = 'apps/web/dist';
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
for (const size of [192, 512]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      // Two offset racing stripes, comfortably inside the maskable safe circle.
      const stripe =
        x > size * 0.3 &&
        x < size * 0.7 &&
        y > size * 0.25 &&
        y < size * 0.75 &&
        Math.floor((x + y) / (size * 0.12)) % 2 === 0;
      pixels.set(stripe ? [224, 83, 49, 255] : [13, 15, 18, 255], i);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(
    `${dir}/icon-${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(pixels)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
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
    display: 'standalone',
    orientation: 'landscape',
    background_color: '#0d0f12',
    theme_color: '#0d0f12',
    icons: [192, 512].map((size) => ({
      src: `icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any maskable',
    })),
  }),
);
if (process.argv.includes('--icons')) process.exit(0);
const inventory = JSON.parse(fs.readFileSync(`${dir}/first-race.json`));
const files = [
  ...new Set([
    'index.html',
    'manifest.webmanifest',
    'icon-192.png',
    'icon-512.png',
    ...Object.keys(inventory.presets.mobile.files),
  ]),
];
const version = crypto.createHash('sha256');
for (const file of files) version.update(fs.readFileSync(`${dir}/${file}`));
const name = `race-shell-${version.digest('hex').slice(0, 16)}`;
fs.writeFileSync(
  `${dir}/sw.js`,
  `
const NAME=${JSON.stringify(name)};
const FILES=${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil((async () => {
  try { const cache=await caches.open(NAME); await cache.addAll(FILES); }
  catch(error) { await caches.delete(NAME); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for(const name of await caches.keys()) if(name.startsWith('race-shell-') && name!==NAME) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url), base=new URL(self.registration.scope);
  if(request.method!=='GET' || url.origin!==base.origin || !url.pathname.startsWith(base.pathname) || url.pathname.startsWith(base.pathname+'rooms')) return;
  if(request.mode==='navigate') {
    if(url.pathname!==base.pathname && url.pathname!==base.pathname+'index.html') return;
    event.respondWith(fetch(request).catch(()=>caches.open(NAME).then(c=>c.match('index.html')))); return;
  }
  if(!FILES.some(file=>new URL(file,base).pathname===url.pathname)) return;
  event.respondWith(caches.open(NAME).then(async cache => (await cache.match(request, {ignoreSearch:true})) || fetch(request)));
});
`,
);
console.log(`Offline cache ${name}: ${files.length} files`);
