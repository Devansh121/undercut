import { defineConfig, devices } from '@playwright/test';

// Browser tests run against the production build served by tools/serve/start.mjs, with
// the rooms service on the local Workers runtime behind /rooms. Build first:
//   npm run build && npm run test:browser
// Ports differ from ./start.sh defaults so a running game does not collide with tests.
const port = Number(process.env.TEST_PORT ?? 4173);
const httpsPort = Number(process.env.TEST_HTTPS_PORT ?? 4174);
const roomsPort = Number(process.env.TEST_ROOMS_PORT ?? 4787);

// Software WebGL (SwiftShader): identical on CI and on a laptop, and it keeps tests
// off the shared GPU.
/**
 * The two longest scenarios (five Mobile sessions on one page, and a context loss with a full
 * Mobile rebake) form their own project. CI runs it in the `build` job, in parallel with the
 * `browser` job that runs desktop and phone; a plain `playwright test` runs all three.
 */
const LIFECYCLE = /\/(lifecycle|context-loss)\.spec\.ts$/;
/**
 * The phone layout sweep also runs on WebKit, the engine of every iPhone browser. DOM only (no
 * WebGL), so it is quick; CI runs it in the `build` job beside the lifecycle project.
 */
const PHONE_FIT = /\/phone-fit\.spec\.ts$/;
/**
 * Real-phone readiness on emulated devices: an iPhone 15 on WebKit and a Pixel 8 on Chromium
 * (home-screen launch, safe areas, touch gestures, audio from a tap, vibration). Runs in the
 * `build` job with the WebKit sweep.
 */
const PHONE_DEVICE = /\/phone-device\.spec\.ts$/;
/** The opt-in ten-minute phone soak (PHONE_SOAK=1), on the Pixel 8 only. */
const PHONE_SOAK = /\/phone-soak\.spec\.ts$/;

// Muted: the game's audio still runs (the audio tests read its state and cost), but nothing
// plays out of the shared laptop's speakers.
const launchOptions = {
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
  ],
};

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Two workers on CI as on a laptop. Timed twice on one CI runner (4 vCPUs) each, the desktop
  // and phone suite took the same wall time at 2 and 3 workers (4.2 and 3.5 min), and every
  // long test ran slower at 3 (cold start up to 60 s of its 90 s limit): SwiftShader already
  // uses several threads per browser.
  workers: 2,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  metadata: { httpsPort },
  projects: [
    {
      name: 'desktop',
      testIgnore: [LIFECYCLE, PHONE_DEVICE, PHONE_SOAK],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        launchOptions,
      },
    },
    {
      name: 'phone',
      testIgnore: [LIFECYCLE, PHONE_DEVICE, PHONE_SOAK],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions,
      },
    },
    {
      name: 'webkit-phone',
      testMatch: [PHONE_FIT, PHONE_DEVICE],
      use: {
        ...devices['iPhone 15'],
      },
    },
    {
      name: 'pixel-phone',
      testMatch: [PHONE_DEVICE, PHONE_SOAK],
      use: {
        ...devices['Pixel 8'],
        launchOptions,
      },
    },
    {
      name: 'lifecycle',
      testMatch: LIFECYCLE,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        launchOptions,
      },
    },
  ],
  webServer: {
    command: 'node tools/serve/start.mjs',
    url: `http://127.0.0.1:${port}/rooms/health`,
    reuseExistingServer: false,
    // SIGTERM lets the server stop the rooms service it started; the default SIGKILL
    // would leave the Workers runtime running.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    timeout: 120_000,
    stdout: 'pipe',
    env: {
      PORT: String(port),
      HTTPS_PORT: String(httpsPort),
      ROOMS_PORT: String(roomsPort),
      ROOM_TIMINGS: JSON.stringify({
        readyCountdownMs: 500,
        formationMs: 600,
        lightIntervalMs: 700,
        holdMinMs: 100,
        holdMaxMs: 300,
      }),
    },
  },
});
