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
const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Public CI runners have 4 vCPUs; 3 workers cuts wall time without starving SwiftShader.
  workers: process.env.CI ? 3 : 2,
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
      testIgnore: /\.nightly\.spec\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        launchOptions,
      },
    },
    {
      name: 'phone',
      testIgnore: /\.nightly\.spec\.ts$/,
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
      name: 'nightly',
      testMatch: /\.nightly\.spec\.ts$/,
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
