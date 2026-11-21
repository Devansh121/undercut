import { defineConfig } from 'vitest/config';

// Projects map onto CI jobs: `unit`, `physics` and `rooms` (with `rooms-soak-short` after
// it), and the nightly `soak` and `rooms-soak` (`npm run test:soak` runs both). Names
// must be unique.
// Run one with `vitest run --project <name>` (see the npm scripts).
export default defineConfig({
  test: {
    maxWorkers: 4,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['{apps,packages,tools}/**/*.test.{ts,mjs}'],
          exclude: [
            '**/node_modules/**',
            'packages/input/validation/**',
            'packages/sim/validation/**',
            'packages/ai/validation/**',
            'packages/race/validation/**',
            '**/*.runtime.test.*',
          ],
        },
      },
      {
        test: {
          name: 'physics',
          environment: 'node',
          // Validation runs drive the sim for whole laps; a shared CI runner can take a
          // few seconds over vitest's 5 s default. A limit on run time, not on results.
          testTimeout: 60_000,
          include: [
            'packages/input/validation/**/*.test.ts',
            'packages/sim/validation/**/*.test.ts',
            'packages/ai/validation/**/*.test.ts',
            'packages/race/validation/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.soak.test.ts'],
        },
      },
      {
        // Nightly only (npm run test:soak:sim): long runs of the reference driver.
        test: {
          name: 'soak',
          environment: 'node',
          include: ['packages/**/*.soak.test.ts'],
          testTimeout: 600_000,
          hookTimeout: 600_000,
        },
      },
      {
        // The real Workers runtime: the rooms service and the local server's lifecycle.
        // Protocol logic is unit-tested in `unit`.
        test: {
          name: 'rooms',
          environment: 'node',
          include: ['services/rooms/test/**/*.test.ts', 'tools/serve/**/*.runtime.test.mjs'],
          globalSetup: ['services/rooms/test/global-setup.ts'],
          testTimeout: 90_000,
          hookTimeout: 60_000,
        },
      },
      {
        // The short soak, run on its own after `rooms` (`npm run test:rooms`): it measures
        // remote-car error to the centimetre, which needs the service not to be starved
        // by other races running beside it on a small CI runner.
        test: {
          name: 'rooms-soak-short',
          environment: 'node',
          include: ['tools/netsim/**/*.runtime.test.ts'],
          globalSetup: ['services/rooms/test/global-setup.ts'],
          env: { SOAK: 'short' },
          testTimeout: 5 * 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        // Nightly: the rooms soak at full length (`npm run test:soak:rooms`).
        test: {
          name: 'rooms-soak',
          environment: 'node',
          include: ['tools/netsim/**/*.runtime.test.ts'],
          globalSetup: ['services/rooms/test/global-setup.ts'],
          env: { SOAK: 'long' },
          testTimeout: 50 * 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
