# Deploying to Cloudflare

UNDERCUT deploys as one Cloudflare Worker (`wrangler.jsonc` at the repository root) that serves the built client as Workers Static Assets and the rooms API on the same origin under `/rooms`. The client keeps using relative `/rooms` paths, matching `./start.sh`.

No account ID, zone ID, token, or email is stored in the repository. Wrangler reads the target account from `npx wrangler login` or `CLOUDFLARE_ACCOUNT_ID`.

## Prerequisites

- Node 20.19 or newer, with dependencies installed (`npm ci` or `./start.sh`).
- A Cloudflare account (the Workers Free plan is enough; see [Free plan fit](#free-plan-fit)).

## Deploy

1. Log in to Cloudflare once on your machine:

   ```sh
   npx wrangler login
   ```

   Confirm with `npx wrangler whoami`. If your login has access to more than one Cloudflare account, export `CLOUDFLARE_ACCOUNT_ID` before deploying.

2. (Optional) Verify the bundle, asset limits, and local Workers runtime without talking to Cloudflare:

   ```sh
   npm run deploy:check
   npm run test:deploy
   ```

3. Build, stage static assets, and deploy:

   ```sh
   npm run deploy
   ```

   This runs `npm run build`, stages `apps/web/dist` plus `tools/deploy/_headers` into `dist/cloudflare` (without `.br`, `.gz`, `.map`, or `first-race.json`), and runs `wrangler deploy`.

   On the first deploy, Wrangler applies Durable Object SQLite migrations `v1` (`Room`) and `v2` (`CreateLimiter`) and prints the public URL, for example:

   ```text
   https://undercut.<your-subdomain>.workers.dev
   ```

4. Smoke check the printed URL:
   - Open `https://<printed-url>/` and start a solo lap.
   - Open `https://<printed-url>/rooms/health`; it should return `{"ok":true,"service":"rooms","protocol":2}`.

## Roll back or take down

- List deployed versions:

  ```sh
  npx wrangler deployments list
  ```

- Roll back to the previous version:

  ```sh
  npx wrangler rollback
  ```

- Remove the deployment completely (deletes the Worker, its static assets, and its Durable Object state):

  ```sh
  npx wrangler delete
  ```

- Pause new online rooms while keeping solo Time Trial online: deploy with `GLOBAL_CREATE_LIMIT` set to `0/60000` in `wrangler.jsonc` (new `POST /rooms` requests return HTTP 429).

## What is public

Once deployed, the `*.workers.dev` URL is reachable on the public internet without a login:

- All staged static assets in `dist/cloudflare` (client HTML/JS/CSS, track data, textures, car models, Draco decoder) are publicly readable. Source maps (`.map`) and local build-budget reports (`first-race.json`) are excluded by `tools/deploy/stage.mjs`.
- `GET /rooms/health` and `GET /rooms/<code>` are public. `POST /rooms` and `GET /rooms/<code>/ws` accept same-origin browser requests and non-browser clients within the rate limits.
- No user accounts, emails, or secrets are stored. Room state and rate-limit timestamps live in Durable Object SQLite storage and are deleted automatically when a room expires or a rate-limit window clears.

## Free plan fit

Yes: UNDERCUT fits the Cloudflare Workers Free plan for solo driving and playtesting online rooms with friends. Solo Time Trial has no daily request limit; online rooms have room for roughly 11 to 33 ten-minute races per day depending on player count.

Measured build numbers against current Workers Free plan limits:

| Resource | UNDERCUT | Workers Free limit | Source |
| --- | --- | --- | --- |
| Static asset files | 84 files (11.41 MiB total) | 20,000 files per version | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Largest single static asset | `assets/car/car_high.glb` (1.24 MiB) | 25 MiB per file | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| First-race client transfer | ~7.8 MiB High, ~2.9 MiB Mobile | Static asset requests & storage free, unlimited | [Static Assets Billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| Worker bundle size | 70.3 KiB uncompressed (19.4 KiB gzip) | 64 MiB uncompressed | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker HTTP requests | Only `/rooms/*` (and 404s); static assets = 0 | 100,000 / day | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Durable Objects backend | SQLite (`Room` v1, `CreateLimiter` v2) | SQLite-backed DOs included on Free | [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects requests | ~3,030 per 10-min 2p race; ~8,520 per 10-min 8p race | 100,000 / day (incoming WS billed 20:1; outgoing WS free; alarms = 1) | [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects duration | ~76.8 GB-s per 10-min active race (hibernates when idle) | 13,000 GB-s / day (~28.2 active object-hours) | [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects SQLite storage | Transient room & limiter records; deleted on expiry | 5M rows read / day, 100k rows written / day, 5 GB total (1 GB/object) | [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/) |

Online race request estimate: each human sends 30 Hz binary car snapshots plus 0.5 Hz pings (30.5 incoming messages/s ÷ 20 = ~91.5 billed Durable Object requests/min per player), and the room runs a 500 ms race alarm (120 requests/min). Outgoing broadcasts are free. That gives roughly 33 ten-minute 2-player races/day or 11 ten-minute 8-player races/day before hitting the 100,000 Durable Object requests/day limit.

## What happens when Free quotas run out

- The Workers Free plan does not charge overages.
- Daily quotas for Worker requests and Durable Objects reset at **00:00 UTC**.
- Once the daily Worker request limit is reached, `/rooms/*` fails with Cloudflare Error 1027 (HTTP 429). Once a daily Durable Object quota (requests, duration, or SQLite rows) is reached, room creation and room traffic fail until 00:00 UTC.
- Static asset requests do not consume Worker or Durable Object quotas, so `/` and solo Time Trial continue working even if the daily `/rooms` quota is exhausted.

## Abuse and cost guards

Production defaults are set in `wrangler.jsonc`:

- **Per-address room creation limit**: `CREATE_LIMIT = "10/600000"` (10 rooms per 10 minutes per `CF-Connecting-IP`). Timestamps are persisted in the `CreateLimiter` SQLite Durable Object so object eviction cannot reset the window, and an alarm deletes the object's storage once the window expires.
- **Global room creation cap**: `GLOBAL_CREATE_LIMIT = "60/3600000"` (60 rooms per hour across all addresses).
- **Same-origin enforcement**: `SAME_ORIGIN_ONLY = "true"` rejects cross-origin browser `POST /rooms` and `GET /rooms/<code>/ws` requests with HTTP 403 and omits wildcard CORS headers.
- **Room lifetime and idle expiry**: `ROOM_TIMINGS = '{"maxRoomAgeMs":14400000}'` caps any single room at 4 hours. Empty lobbies expire after 10 minutes and abandoned rooms after 30 seconds; expired rooms close sockets and call `storage.deleteAll()`.
- **Per-room socket and flood limits**: at most 32 sockets per room, 16 unjoined, 4 unjoined per address, WebSocket admission capped at 5/s after a burst of 30, plus message size, control-rate, and strike limits.

## Caching, compression, and headers

- **Compression**: Cloudflare compresses compressible static assets automatically at the edge (Brotli preferred, Gzip fallback) based on `Accept-Encoding` and `Content-Type` ([Cloudflare Compression](https://developers.cloudflare.com/speed/optimization/content/compression/)). Local `.br` and `.gz` files from `npm run build` are left in `apps/web/dist` for `./start.sh` and omitted from `dist/cloudflare`.
- **Caching (`tools/deploy/_headers`)**:
  - `/` and `/*.html`: `Cache-Control: no-cache`
  - Hashed Vite outputs under `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`
  - Unhashed `/assets/index.json`: `Cache-Control: no-cache`
  - Unhashed asset directories (`/assets/car/*`, `/assets/tex/*`, `/assets/env/*`, `/assets/draco/*`): `Cache-Control: public, max-age=86400`
  - `/rooms/*` API JSON responses: `Cache-Control: no-store`
- **Offline app (service worker)**: `sw.js` (generated by `tools/serve/pwa.mjs`) precaches the shell under `./` and the Mobile first-circuit files, never `network-info` or `/rooms`. The shell is stored under `./` because Cloudflare answers `/index.html` with a 307 to `/`, and a redirected response cannot answer a page load. A deploy changes the cache name; open pages show a "new version" bar and switch when the player picks Reload. `tests/browser/pwa.spec.ts` runs against a proxy that redirects `/index.html` the same way.
- **Phone over `./start.sh`**: the worker registers only on a secure origin. Over the Wi-Fi HTTP address there is no install or offline play, and over the Wi-Fi HTTPS address the self-signed certificate makes registration fail (the game still runs). Install and offline need the deployed HTTPS site, or a phone that trusts the local certificate.
- **Routing**: `assets.not_found_handling` is `"none"` (the game lives at `/` with query parameters, so missing assets return 404 rather than HTML) and `assets.run_worker_first` is `["/rooms", "/rooms/*"]` so API routes always reach the Worker even on direct browser navigation.
- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` blocking camera/microphone/geolocation/payment/usb (leaving gamepad and fullscreen allowed), and a Content Security Policy that keeps `script-src` free of `'unsafe-inline'`/`'unsafe-eval'` while allowing `'wasm-unsafe-eval'` and `blob:` workers for Draco decoding, `'self'` for the AudioWorklet module, `'unsafe-inline'` in `style-src` for the touch-controls overlay, and `ws:`/`wss:` for same-origin room sockets.
